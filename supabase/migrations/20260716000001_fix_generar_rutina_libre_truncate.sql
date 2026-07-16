-- FIX: generar_rutina_libre fallaba desde la APP (PostgREST) con
-- "DELETE requires a WHERE clause". La causa: la RPC hacía
-- `delete from tmp_dias_def_libre;` (sin WHERE) sobre su tabla temporal.
-- PostgREST rechaza cualquier DELETE sin WHERE en la request; por conexión
-- directa (psql/MCP) funcionaba, pero por la app no. Fix: TRUNCATE en vez de
-- DELETE (no es un DELETE, no cae en la protección). Ya aplicado en Supabase.
-- Diagnosticado en vivo (emulador + logcat) — la app NO necesitó cambios.
create or replace function public.generar_rutina_libre(p_objetivo text, p_nivel text, p_dias_semana integer, p_equipo text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
  v_dia uuid;
  v_series int; v_reps text; v_descanso text;
  v_nombre text;
  v_es_split boolean;
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
  rec record;
  rec_ej record;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  if p_dias_semana is null or p_dias_semana < 3 or p_dias_semana > 6 then
    raise exception 'dias_semana debe estar entre 3 y 6';
  end if;

  if not exists (select 1 from public.objetivo_entrenamiento where codigo = p_objetivo) then
    raise exception 'objetivo inválido';
  end if;

  if p_nivel not in ('principiante','intermedio','avanzado') then
    raise exception 'nivel inválido';
  end if;

  case p_equipo
    when 'peso_corporal' then v_equipo_filtro := array['body weight'];
    when 'mancuernas'    then v_equipo_filtro := array['body weight','dumbbell'];
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

  v_es_split := p_objetivo in ('ganar_masa', 'fuerza');
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
  truncate table tmp_dias_def_libre;  -- FIX: era `delete from ...` (sin WHERE), que PostgREST rechaza.

  if v_es_split then
    if p_dias_semana >= 6 then
      insert into tmp_dias_def_libre (orden, foco, targets) values
        (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (5, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (6, 'Pierna',                        array['glutes','quads','hamstrings','calves']);
    elsif p_dias_semana = 5 then
      insert into tmp_dias_def_libre (orden, foco, targets) values
        (1, 'Pecho',                         array['pectorals','serratus anterior']),
        (2, 'Espalda',                       array['lats','upper back','traps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Hombro',                        array['delts']),
        (5, 'Brazo',                         array['biceps','triceps','forearms']);
    elsif p_dias_semana = 4 then
      insert into tmp_dias_def_libre (orden, foco, targets) values
        (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Hombro + Brazo',                array['delts','biceps','triceps']);
    else
      for v_i in 1..greatest(p_dias_semana,1) loop
        v_j := 1 + ((v_i - 1) % 3);
        if v_j = 1 then
          insert into tmp_dias_def_libre (orden, foco, targets)
          values (v_i, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']);
        elsif v_j = 2 then
          insert into tmp_dias_def_libre (orden, foco, targets)
          values (v_i, 'Tirón (espalda/bíceps)', array['lats','upper back','biceps']);
        else
          insert into tmp_dias_def_libre (orden, foco, targets)
          values (v_i, 'Pierna', array['glutes','quads','hamstrings','calves']);
        end if;
      end loop;
    end if;
  else
    for v_i in 1..greatest(p_dias_semana,1) loop
      v_j := 1 + ((v_i - 1) % 3);
      if v_j = 1 then
        insert into tmp_dias_def_libre (orden, foco, targets)
        values (v_i, 'Full body A', array['pectorals','lats','quads','glutes','abs']);
      elsif v_j = 2 then
        insert into tmp_dias_def_libre (orden, foco, targets)
        values (v_i, 'Full body B', array['upper back','delts','hamstrings','glutes','abs']);
      else
        insert into tmp_dias_def_libre (orden, foco, targets)
        values (v_i, 'Full body C', array['pectorals','biceps','triceps','quads','abs']);
      end if;
    end loop;
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
      insert into public.rutina_libre_ejercicio
        (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
      values (v_dia, v_usados_id[v_j], v_usados_nombre[v_j], v_series, v_reps, v_descanso, v_orden);
    end loop;
  end loop;

  drop table if exists tmp_dias_def_libre;

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;
