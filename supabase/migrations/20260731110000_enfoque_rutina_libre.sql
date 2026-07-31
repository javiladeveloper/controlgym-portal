-- Enfoque muscular en la rutina libre: equilibrado / tren superior / tren inferior.
--
-- POR QUÉ (owner): quien arma su rutina quiere poder decir en qué se enfoca.
-- Se descartó pedir el GÉNERO para inferirlo ("hoy hay mucha sensibilidad con
-- ese tema", y además "mujer=inferior / hombre=superior" es un estereotipo que
-- le daría la rutina equivocada a mucha gente). Preguntar el enfoque acierta
-- siempre porque lo elige la persona.
--
-- Cómo funciona: el esquema de días sigue mandándolo la frecuencia (nº de días),
-- pero al elegir los ejercicios de cada día se PONDERA hacia el tren elegido.
-- 'equilibrado' = comportamiento actual, sin cambios.

alter table public.rutina_libre
  add column if not exists enfoque text
  check (enfoque is null or enfoque in ('equilibrado','tren_superior','tren_inferior'));

comment on column public.rutina_libre.enfoque is
  'Énfasis muscular elegido al generar: equilibrado (default) | tren_superior | tren_inferior.';

-- Helper: ¿este target pertenece al tren inferior?
create or replace function public.es_tren_inferior(p_target text)
returns boolean language sql immutable as $$
  select coalesce(p_target, '') in (
    'glutes','quads','hamstrings','calves','adductors','abductors'
  );
$$;

comment on function public.es_tren_inferior(text) is
  'Clasifica un target del catálogo como tren inferior. El resto (pectorals, lats, delts, biceps, triceps, upper back, traps, forearms, abs, spine…) es superior/core.';

-- ── generar_rutina_libre con p_enfoque ─────────────────────────────────────
-- Firma nueva con el parámetro al final y DEFAULT, para no romper a los
-- clientes que aún llaman con 4 argumentos.
-- OJO: se DROPEA la firma vieja de 4 args — si conviven, una llamada de 4
-- argumentos queda ambigua ("function is not unique") y la app falla. Mismo
-- problema que ya rompió `crear_rutina_libre_vacia` en el emulador.
drop function if exists public.generar_rutina_libre(text, text, int, text);

create or replace function public.generar_rutina_libre(
  p_objetivo text,
  p_nivel text,
  p_dias_semana int,
  p_equipo text,
  p_enfoque text default 'equilibrado'
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
  v_enfoque text;
  v_cupo int;
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

  v_enfoque := coalesce(nullif(trim(p_enfoque), ''), 'equilibrado');
  if v_enfoque not in ('equilibrado','tren_superior','tren_inferior') then
    raise exception 'enfoque inválido';
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

  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa, equipo, enfoque)
  values (v_usuario, v_nombre, p_objetivo, true, p_equipo, v_enfoque)
  returning id into v_rutina;

  create temporary table if not exists tmp_dias_def_libre (
    orden int, foco text, targets text[]
  ) on commit drop;
  -- TRUNCATE, no DELETE: PostgREST (safeupdate) rechaza DELETE sin WHERE.
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

      -- ENFOQUE: se pondera cuánto se saca de cada músculo. El tren elegido
      -- recibe más ejercicios; el otro conserva al menos 1 (nunca se abandona
      -- un tren entero: eso desbalancea y lesiona a la larga).
      v_cupo := v_por_target;
      if v_enfoque = 'tren_inferior' then
        v_cupo := case when public.es_tren_inferior(v_target)
                       then v_por_target + 1 else greatest(1, v_por_target - 1) end;
      elsif v_enfoque = 'tren_superior' then
        v_cupo := case when public.es_tren_inferior(v_target)
                       then greatest(1, v_por_target - 1) else v_por_target + 1 end;
      end if;

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
        limit v_cupo
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

revoke all on function public.generar_rutina_libre(text, text, int, text, text) from public;
grant execute on function public.generar_rutina_libre(text, text, int, text, text) to authenticated;

-- Exponer el enfoque en el detalle (la app lo lee para mostrarlo/recordarlo).
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
      'enfoque', (select enfoque from r),
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
                  'video_url', c.video_url,
                  'gif_url', c.gif_url,
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
