-- Rediseño del motor de rutinas libres: frecuencia sana, días 1-6, adaptación
-- por IMC y herencia de cargas al regenerar.
--
-- POR QUÉ (hallazgos verificados sobre la versión anterior):
--
-- 1. FRECUENCIA. El split de 5 días era "bro split" (Pecho/Espalda/Pierna/
--    Hombro/Brazo) = cada músculo 1 vez por semana. Con 4 días la propia RPC ya
--    usaba push/pull y con 6 repetía 2 vueltas: entrenando MÁS días se entrenaba
--    cada músculo MENOS veces. Ahora todos los esquemas dan ~2 sesiones por
--    músculo por semana, que es lo que respalda la literatura de entrenamiento a
--    igual volumen semanal.
--
-- 2. DÍAS 1-2. Antes se rechazaba (<3 días → excepción): quien solo puede
--    entrenar 2 veces por semana no podía generar rutina. Ahora 1..6, y con 1-2
--    días se usa full-body (con 2 sesiones full-body cada músculo sale 2×).
--
-- 3. SPLIT PARA TODOS LOS OBJETIVOS. Antes solo ganar_masa/fuerza; el resto iba
--    full-body aunque entrenara 6 días. Ahora la ESTRUCTURA la manda la
--    frecuencia y el OBJETIVO manda el contenido (series/reps/descanso/cardio).
--    Excepción: 'resistencia' y 'rehabilitacion' conservan su lógica propia.
--
-- 4. IMC. La RPC lo lee del perfil (usuario.peso_kg/talla_m, o la medida más
--    reciente). IMC >= 30 excluye ejercicios de alto impacto (saltos,
--    pliometría, burpees): el peso corporal absoluto multiplica la carga
--    articular al aterrizar — es mecánica, no juicio de condición física.
--    IMC < 18.5 evita el cardio accesorio (contraproducente si necesita ganar).
--    NO modula el volumen: reducir series por IMC sería paternalista y sin base.
--    Sin datos → sin restricción (no asumir).
--
-- 5. HERENCIA DE CARGA. Antes regenerar borraba la rutina y el socio perdía el
--    hilo de su progresión (los ejercicios nuevos arrancaban sin carga). Ahora,
--    si ya registró carga para ese mismo ejercicio del catálogo, se hereda.
--
-- 6. EQUIPO. 'mancuernas' ahora incluye bandas y kettlebell (equipo casero real).

create or replace function public.generar_rutina_libre(
  p_objetivo text,
  p_nivel text,
  p_dias_semana int,
  p_equipo text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
  v_dia uuid;
  v_series int; v_reps text; v_descanso text;
  v_nombre text;
  v_dia_num int;
  v_i int;
  v_foco text;
  v_targets text[];
  v_target text;
  v_j int;
  v_num_targets int;
  v_por_target int;
  v_usados_nombre text[];
  v_usados_id uuid[];
  v_orden int;
  v_equipo_filtro text[];
  v_peso numeric; v_talla numeric; v_imc numeric;
  v_evitar_impacto boolean := false;
  v_carga_previa text;
  v_es_cardio boolean;
  rec record;
  rec_ej record;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  -- Ahora 1..6 (antes 3..6): no dejar fuera a quien entrena 1-2 días.
  if p_dias_semana is null or p_dias_semana < 1 or p_dias_semana > 6 then
    raise exception 'dias_semana debe estar entre 1 y 6';
  end if;

  if not exists (select 1 from public.objetivo_entrenamiento where codigo = p_objetivo) then
    raise exception 'objetivo inválido';
  end if;

  if p_nivel not in ('principiante','intermedio','avanzado') then
    raise exception 'nivel inválido';
  end if;

  -- ── IMC del perfil (la app no lo manda; se lee acá) ──────────────────
  select u.peso_kg, u.talla_m into v_peso, v_talla
  from public.usuario u where u.id = v_usuario;
  -- Si el perfil no lo tiene, la medida personal más reciente.
  if v_peso is null or v_talla is null then
    select m.peso_kg, m.talla_m into v_peso, v_talla
    from public.medida_personal m
    where m.usuario_id = v_usuario and m.peso_kg is not null and m.talla_m is not null
    order by m.fecha desc limit 1;
  end if;
  if v_peso is not null and v_talla is not null and v_talla > 0 then
    v_imc := v_peso / (v_talla * v_talla);
    -- Solo el extremo alto restringe (impacto articular). Sin datos → sin filtro.
    v_evitar_impacto := v_imc >= 30;
  end if;

  -- Mapeo de equipo -> filtro de equipment del catálogo.
  case p_equipo
    when 'peso_corporal' then v_equipo_filtro := array['body weight'];
    -- Incluye banda y kettlebell: es el equipo casero real, no solo mancuernas.
    when 'mancuernas'    then v_equipo_filtro := array['body weight','dumbbell','band','resistance band','kettlebell'];
    when 'gym_completo'  then v_equipo_filtro := null; -- sin filtro: todo
    else raise exception 'equipo inválido';
  end case;

  -- Series/reps/descanso por objetivo, luego ajustados por nivel.
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

  -- Los objetivos de cardio conservan su estructura full-body + cardio; el
  -- resto usa el esquema por frecuencia.
  v_es_cardio := p_objetivo in ('resistencia');

  v_nombre := 'Rutina ' || initcap(replace(p_objetivo,'_',' ')) || ' (' || p_dias_semana || ' días)';

  delete from public.rutina_libre where usuario_id = v_usuario and activa;

  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa)
  values (v_usuario, v_nombre, p_objetivo, true)
  returning id into v_rutina;

  create temporary table if not exists tmp_dias_def_libre (
    orden int,
    foco text,
    targets text[]
  ) on commit drop;
  delete from tmp_dias_def_libre;

  -- ── Esquemas por días: TODOS buscan ~2 sesiones por músculo ──────────
  if v_es_cardio then
    -- Cardio/resistencia: full-body + cardio, rotando estímulo.
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
    -- 1-2 días: full-body. Con 2 sesiones cada músculo sale 2× por semana.
    insert into tmp_dias_def_libre values
      (1, 'Full body A', array['pectorals','lats','quads','glutes','abs']);
    if p_dias_semana = 2 then
      insert into tmp_dias_def_libre values
        (2, 'Full body B', array['delts','upper back','hamstrings','triceps','biceps']);
    end if;

  elsif p_dias_semana = 3 then
    -- 3 días: full-body A/B/C → cada músculo 3× por semana.
    insert into tmp_dias_def_libre values
      (1, 'Full body A', array['pectorals','lats','quads','abs']),
      (2, 'Full body B', array['delts','upper back','hamstrings','glutes']),
      (3, 'Full body C', array['pectorals','biceps','triceps','quads','calves']);

  elsif p_dias_semana = 4 then
    -- 4 días: torso/pierna ×2 → 2 sesiones por músculo.
    insert into tmp_dias_def_libre values
      (1, 'Torso (pecho, espalda, hombro)', array['pectorals','lats','delts','triceps','biceps']),
      (2, 'Pierna',                         array['quads','glutes','hamstrings','calves','abs']),
      (3, 'Torso (pecho, espalda, hombro)', array['pectorals','upper back','delts','triceps','biceps']),
      (4, 'Pierna',                         array['quads','glutes','hamstrings','calves','abs']);

  elsif p_dias_semana = 5 then
    -- 5 días: el fix central. Antes era bro split (1×/músculo); ahora dos
    -- vueltas de empuje/tirón/pierna con el 5º día cerrando lo que quedó corto.
    insert into tmp_dias_def_libre values
      (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
      (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
      (3, 'Pierna',                        array['quads','glutes','hamstrings','calves']),
      (4, 'Empuje + tirón',                array['pectorals','delts','lats','triceps','biceps']),
      (5, 'Pierna + core',                 array['quads','hamstrings','glutes','abs','calves']);

  else
    -- 6 días: push/pull/pierna ×2.
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
    v_foco := rec.foco;
    v_targets := rec.targets;
    v_num_targets := array_length(v_targets, 1);

    v_por_target := greatest(1, (6 / greatest(v_num_targets,1)));

    v_usados_nombre := array[]::text[];
    v_usados_id := array[]::uuid[];

    for v_j in 1..v_num_targets loop
      v_target := v_targets[v_j];

      for rec_ej in
        select c.id, coalesce(c.nombre_es, c.nombre) as nombre
        from public.ejercicio_catalogo c
        where c.activo and c.target = v_target
          and (v_equipo_filtro is null or c.equipment = any (v_equipo_filtro))
          and coalesce(c.nombre_es, c.nombre) <> all (v_usados_nombre)
          -- IMC >= 30: fuera saltos/pliometría (carga articular al aterrizar).
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

      -- Herencia de carga: si el usuario ya registró peso para ESTE ejercicio
      -- del catálogo (aunque fuera en otra rutina), la nueva arranca ahí. Así
      -- cambiar de 3 a 4 días no borra su progreso.
      select r.carga_usada::text into v_carga_previa
      from public.registro_entreno_libre r
      join public.rutina_libre_ejercicio e on e.id = r.rutina_libre_ejercicio_id
      where r.usuario_id = v_usuario
        and e.catalogo_id = v_usados_id[v_j]
        and r.carga_usada is not null
      order by r.fecha desc
      limit 1;

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
