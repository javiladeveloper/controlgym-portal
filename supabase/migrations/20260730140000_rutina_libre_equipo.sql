-- La rutina libre RECUERDA con qué equipo se armó.
--
-- PROBLEMA (reportado por el owner probando en el emulador): con una rutina
-- "en casa (peso corporal)", al pedir alternativas de un ejercicio la app
-- ofrecía ejercicios CON PESAS. Causa raíz: `rutina_libre` no guardaba el
-- equipo — se elegía en el wizard, se usaba para generar y se perdía. Sin ese
-- dato, las alternativas (buscar_ejercicios_catalogo por target) no tenían
-- forma de filtrar por equipo disponible.
--
-- FIX: columna `equipo` en rutina_libre + persistirla en los 3 caminos que
-- crean una rutina (generar / crear vacía / adoptar prediseñada), y exponerla
-- en el detalle para que la app filtre las alternativas.

alter table public.rutina_libre
  add column if not exists equipo text
  check (equipo is null or equipo in ('peso_corporal','mancuernas','gym_completo'));

comment on column public.rutina_libre.equipo is
  'Equipo con el que se armó la rutina. Filtra las alternativas de ejercicio: una rutina de casa no debe sugerir ejercicios con pesas.';

-- Backfill: deducir el equipo de las rutinas existentes según el equipment real
-- de sus ejercicios. Si TODOS son body weight → peso_corporal; si hay de gym
-- (máquinas/barra) → gym_completo; el resto (mancuerna/banda/kettlebell) →
-- mancuernas. Sin ejercicios → se deja null (sin filtro, como hoy).
update public.rutina_libre rl
set equipo = sub.equipo_deducido
from (
  select d.rutina_libre_id,
         case
           when count(*) filter (where c.equipment is distinct from 'body weight') = 0
             then 'peso_corporal'
           when count(*) filter (where c.equipment not in
                ('body weight','dumbbell','band','resistance band','kettlebell')) > 0
             then 'gym_completo'
           else 'mancuernas'
         end as equipo_deducido
  from public.rutina_libre_dia d
  join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
  left join public.ejercicio_catalogo c on c.id = e.catalogo_id
  group by d.rutina_libre_id
) sub
where sub.rutina_libre_id = rl.id and rl.equipo is null;

-- ── 1. generar_rutina_libre: guardar el equipo elegido en el wizard ─────────
-- Se re-crea con el mismo cuerpo vigente (20260721100000) + el insert del equipo.
-- Solo cambia la línea del insert into rutina_libre.
create or replace function public.generar_rutina_libre(
  p_objetivo text,
  p_nivel text,
  p_dias_semana int,
  p_equipo text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_usuario uuid; v_rutina uuid; v_dia uuid;
  v_series int; v_reps text; v_descanso text; v_nombre text;
  v_dia_num int; v_i int; v_foco text; v_targets text[]; v_target text;
  v_j int; v_num_targets int; v_por_target int;
  v_usados_nombre text[]; v_usados_id uuid[]; v_orden int;
  v_equipo_filtro text[];
  v_peso numeric; v_talla numeric; v_imc numeric;
  v_evitar_impacto boolean := false;
  v_carga_previa text; v_es_cardio boolean;
  rec record; rec_ej record;
begin
  v_usuario := auth.uid();
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;
  if p_dias_semana is null or p_dias_semana < 1 or p_dias_semana > 6 then
    raise exception 'dias_semana debe estar entre 1 y 6';
  end if;
  if not exists (select 1 from public.objetivo_entrenamiento where codigo = p_objetivo) then
    raise exception 'objetivo inválido';
  end if;
  if p_nivel not in ('principiante','intermedio','avanzado') then
    raise exception 'nivel inválido';
  end if;

  select u.peso_kg, u.talla_m into v_peso, v_talla
  from public.usuario u where u.id = v_usuario;
  if v_peso is null or v_talla is null then
    select m.peso_kg, m.talla_m into v_peso, v_talla
    from public.medida_personal m
    where m.usuario_id = v_usuario and m.peso_kg is not null and m.talla_m is not null
    order by m.fecha desc limit 1;
  end if;
  if v_peso is not null and v_talla is not null and v_talla > 0 then
    v_imc := v_peso / (v_talla * v_talla);
    v_evitar_impacto := v_imc >= 30;
  end if;

  case p_equipo
    when 'peso_corporal' then v_equipo_filtro := array['body weight'];
    when 'mancuernas'    then v_equipo_filtro := array['body weight','dumbbell','band','resistance band','kettlebell'];
    when 'gym_completo'  then v_equipo_filtro := null;
    else raise exception 'equipo inválido';
  end case;

  case p_objetivo
    when 'ganar_masa' then v_series:=4; v_reps:='8-12'; v_descanso:='90s';
    when 'fuerza'     then v_series:=5; v_reps:='3-5';  v_descanso:='2-3 min';
    when 'resistencia'then v_series:=3; v_reps:='15-20';v_descanso:='30s';
    when 'bajar_peso' then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    when 'tonificar'  then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    else v_series:=3; v_reps:='10-12'; v_descanso:='60s';
  end case;

  if p_nivel = 'principiante' then
    v_series := greatest(2, v_series - 1);
    case v_reps
      when '3-5'   then v_reps := '6-8';
      when '8-12'  then v_reps := '10-14';
      when '12-15' then v_reps := '14-18';
      when '15-20' then v_reps := '18-22';
      else v_reps := '12-15';
    end case;
  elsif p_nivel = 'avanzado' then
    v_series := v_series + 1;
  end if;

  v_es_cardio := p_objetivo in ('resistencia');
  v_nombre := 'Rutina ' || initcap(replace(p_objetivo,'_',' ')) || ' (' || p_dias_semana || ' días)';

  delete from public.rutina_libre where usuario_id = v_usuario and activa;

  -- AQUÍ el cambio: se guarda el equipo elegido.
  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa, equipo)
  values (v_usuario, v_nombre, p_objetivo, true, p_equipo)
  returning id into v_rutina;

  create temporary table if not exists tmp_dias_def_libre (
    orden int, foco text, targets text[]
  ) on commit drop;
  -- TRUNCATE, no DELETE: PostgREST corre con `safeupdate` activo y rechaza
  -- cualquier DELETE sin WHERE con "DELETE requires a WHERE clause" — aunque
  -- sea sobre una tabla TEMPORAL interna. Por psql no falla (sin esa
  -- protección), por eso el bug solo se veía desde la app. Mismo problema que
  -- ya tuvo `tmp_dias_def` en el generador de plantillas del panel.
  truncate tmp_dias_def_libre;

  if v_es_cardio then
    for v_i in 1..p_dias_semana loop
      v_j := 1 + ((v_i - 1) % 3);
      if v_j = 1 then
        insert into tmp_dias_def_libre values (v_i, 'Cardio + tren superior',
          array['cardiovascular system','pectorals','lats','abs']);
      elsif v_j = 2 then
        insert into tmp_dias_def_libre values (v_i, 'Cardio + tren inferior',
          array['cardiovascular system','quads','glutes','hamstrings']);
      else
        insert into tmp_dias_def_libre values (v_i, 'Circuito full body',
          array['cardiovascular system','delts','upper back','abs','calves']);
      end if;
    end loop;
  elsif p_dias_semana <= 2 then
    insert into tmp_dias_def_libre values
      (1, 'Full body A', array['pectorals','lats','quads','glutes','abs']);
    if p_dias_semana = 2 then
      insert into tmp_dias_def_libre values
        (2, 'Full body B', array['delts','upper back','hamstrings','triceps','biceps']);
    end if;
  elsif p_dias_semana = 3 then
    insert into tmp_dias_def_libre values
      (1, 'Full body A', array['pectorals','lats','quads','abs']),
      (2, 'Full body B', array['delts','upper back','hamstrings','glutes']),
      (3, 'Full body C', array['pectorals','biceps','triceps','quads','calves']);
  elsif p_dias_semana = 4 then
    insert into tmp_dias_def_libre values
      (1, 'Torso (pecho, espalda, hombro)', array['pectorals','lats','delts','triceps','biceps']),
      (2, 'Pierna',                         array['quads','glutes','hamstrings','calves','abs']),
      (3, 'Torso (pecho, espalda, hombro)', array['pectorals','upper back','delts','triceps','biceps']),
      (4, 'Pierna',                         array['quads','glutes','hamstrings','calves','abs']);
  elsif p_dias_semana = 5 then
    insert into tmp_dias_def_libre values
      (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
      (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
      (3, 'Pierna',                        array['quads','glutes','hamstrings','calves']),
      (4, 'Empuje + tirón',                array['pectorals','delts','lats','triceps','biceps']),
      (5, 'Pierna + core',                 array['quads','hamstrings','glutes','abs','calves']);
  else
    insert into tmp_dias_def_libre values
      (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
      (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
      (3, 'Pierna',                        array['quads','glutes','hamstrings','calves']),
      (4, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
      (5, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
      (6, 'Pierna + core',                 array['quads','glutes','hamstrings','abs']);
  end if;

  v_dia_num := 0;
  for rec in select orden, foco, targets from tmp_dias_def_libre order by orden loop
    v_foco := rec.foco; v_targets := rec.targets;
    v_num_targets := array_length(v_targets, 1);
    v_por_target := greatest(1, (6 / greatest(v_num_targets,1)));
    v_usados_nombre := array[]::text[]; v_usados_id := array[]::uuid[];

    for v_j in 1..v_num_targets loop
      v_target := v_targets[v_j];
      for rec_ej in
        select c.id, coalesce(c.nombre_es, c.nombre) as nombre
        from public.ejercicio_catalogo c
        where c.activo and c.target = v_target
          and (v_equipo_filtro is null or c.equipment = any (v_equipo_filtro))
          and coalesce(c.nombre_es, c.nombre) <> all (v_usados_nombre)
          and (
            not v_evitar_impacto
            or lower(coalesce(c.nombre_es,'') || ' ' || coalesce(c.nombre,''))
               !~ '(jump|salto|saltar|hop|plyo|pliom|burpee|skater|bound)'
          )
        order by random()
        limit v_por_target
      loop
        v_usados_nombre := v_usados_nombre || rec_ej.nombre;
        v_usados_id := v_usados_id || rec_ej.id;
      end loop;
    end loop;

    if array_length(v_usados_nombre, 1) is null or array_length(v_usados_nombre, 1) = 0 then
      continue;
    end if;

    v_dia_num := v_dia_num + 1;
    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
    values (v_rutina, v_dia_num, v_foco)
    returning id into v_dia;

    v_orden := 0;
    for v_j in 1..array_length(v_usados_nombre,1) loop
      v_orden := v_orden + 1;
      select r.carga_usada::text into v_carga_previa
      from public.registro_entreno_libre r
      join public.rutina_libre_ejercicio e on e.id = r.rutina_libre_ejercicio_id
      where r.usuario_id = v_usuario
        and e.catalogo_id = v_usados_id[v_j]
        and r.carga_usada is not null
      order by r.fecha desc limit 1;

      insert into public.rutina_libre_ejercicio
        (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden, carga)
      values (v_dia, v_usados_id[v_j], v_usados_nombre[v_j], v_series, v_reps, v_descanso, v_orden,
              case when v_carga_previa is not null then v_carga_previa || ' kg' else null end);
      v_carga_previa := null;
    end loop;
  end loop;

  drop table if exists tmp_dias_def_libre;
  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.generar_rutina_libre(text, text, int, text) from public;
grant execute on function public.generar_rutina_libre(text, text, int, text) to authenticated;

-- ── 2. crear_rutina_libre_vacia: acepta y guarda el equipo ──────────────────
-- Firma nueva con p_equipo opcional (default 'peso_corporal': el armador nace
-- del camino "en casa").
--
-- OJO (bug real que rompió "Arma tu rutina" en el emulador): al agregar el
-- parámetro se creó una SOBRECARGA — quedaban las dos firmas, (text) y
-- (text,text). Como el nuevo parámetro tiene DEFAULT, una llamada con un solo
-- argumento se vuelve ambigua y Postgres responde
-- "function ... is not unique" → la app mostraba "No se pudo crear tu rutina".
-- Por eso se DROPEA la firma vieja: la nueva ya cubre el caso de 1 argumento.
drop function if exists public.crear_rutina_libre_vacia(text);

create or replace function public.crear_rutina_libre_vacia(
  p_nombre text,
  p_equipo text default 'peso_corporal'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_rutina uuid;
begin
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;
  if p_equipo is not null and p_equipo not in ('peso_corporal','mancuernas','gym_completo') then
    raise exception 'equipo inválido';
  end if;

  delete from public.rutina_libre where usuario_id = v_usuario and activa;

  insert into public.rutina_libre (usuario_id, nombre, activa, equipo)
  values (v_usuario, coalesce(nullif(trim(p_nombre), ''), 'Mi rutina'), true, p_equipo)
  returning id into v_rutina;

  insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
  values (v_rutina, 1, 'Día 1');

  return public._rutina_libre_detalle(v_rutina);
end;
$$;
revoke all on function public.crear_rutina_libre_vacia(text, text) from public;
grant execute on function public.crear_rutina_libre_vacia(text, text) to authenticated, service_role;

-- ── 3. adoptar_rutina_predisenada: hereda el equipo de la prediseñada ───────
create or replace function public.adoptar_rutina_predisenada(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_rutina uuid; v_dia uuid; v_p record; r_dia record; r_ej record;
begin
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;
  select * into v_p from public.rutina_predisenada where id = p_id and activa;
  if not found then raise exception 'rutina prediseñada no encontrada'; end if;

  delete from public.rutina_libre where usuario_id = v_usuario and activa;
  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa, equipo)
    values (v_usuario, v_p.nombre, v_p.categoria, true, v_p.equipo)
    returning id into v_rutina;

  for r_dia in select * from public.rutina_predisenada_dia
               where predisenada_id = p_id order by dia_semana loop
    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
      values (v_rutina, r_dia.dia_semana, r_dia.foco) returning id into v_dia;
    for r_ej in select * from public.rutina_predisenada_ejercicio
                where predisenada_dia_id = r_dia.id order by orden loop
      insert into public.rutina_libre_ejercicio
        (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
        values (v_dia, r_ej.catalogo_id, r_ej.nombre, r_ej.series, r_ej.reps, r_ej.descanso, r_ej.orden);
    end loop;
  end loop;

  return public._rutina_libre_detalle(v_rutina);
end;
$$;
revoke all on function public.adoptar_rutina_predisenada(uuid) from public;
grant execute on function public.adoptar_rutina_predisenada(uuid) to authenticated, service_role;

-- ── 4. _rutina_libre_detalle: exponer `equipo` para que la app filtre ───────
create or replace function public._rutina_libre_detalle(p_rutina_libre_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select rl.* from public.rutina_libre rl where rl.id = p_rutina_libre_id
  )
  select case when not exists (select 1 from r) then null else
    jsonb_build_object(
      'rutina_id', (select id from r),
      'nombre', (select nombre from r),
      'objetivo', (select objetivo from r),
      'notas', (select notas from r),
      'equipo', (select equipo from r),
      'dias', coalesce((
        select jsonb_agg(dia order by dia->>'dia_semana')
        from (
          select jsonb_build_object(
            'id', d.id,
            'dia_semana', d.dia_semana,
            'foco', d.foco,
            'ejercicios', coalesce((
              select jsonb_agg(ej order by (ej->>'orden')::int)
              from (
                select jsonb_build_object(
                  'id', re.id,
                  'nombre', re.nombre,
                  'series', re.series,
                  'reps', re.reps,
                  'descanso', re.descanso,
                  'carga', re.carga,
                  'orden', re.orden,
                  'notas', re.notas,
                  'video_url', case when c.gif_url is not null and c.gif_url not like '%.gif' then c.gif_url end,
                  'gif_url', case when c.gif_url like '%.gif' then c.gif_url end,
                  'foto_url', c.foto_url,
                  'descripcion', coalesce(c.instrucciones->>'es', c.instrucciones->>'en'),
                  'catalogo_id', c.id,
                  'target', c.target,
                  'body_part', c.body_part,
                  'grupo_muscular', c.grupo_muscular,
                  'secondary', c.secondary,
                  'equipment', c.equipment
                ) as ej
                from public.rutina_libre_ejercicio re
                left join public.ejercicio_catalogo c on c.id = re.catalogo_id
                where re.rutina_libre_dia_id = d.id
              ) x
            ), '[]'::jsonb)
          ) as dia
          from public.rutina_libre_dia d where d.rutina_libre_id = (select id from r)
        ) y
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public._rutina_libre_detalle(uuid) from public;
grant execute on function public._rutina_libre_detalle(uuid) to authenticated, service_role;
