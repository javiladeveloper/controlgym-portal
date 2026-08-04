-- Rutinas guiadas: el enfoque ahora decide QUÉ días se arman.
--
-- Reporte del 2026-08-03: una usuaria eligió enfoque "tren inferior" y la
-- rutina le dio días enteros de pecho, espalda y brazos.
--
-- Causa: el reparto de la semana dependía sólo de CUÁNTOS días entrena, y el
-- enfoque se aplicaba después reordenando los músculos dentro de cada día. Si
-- el día era "Empuje (pecho, hombro, tríceps)", no había ningún músculo de
-- pierna que poner primero — el reorden era un no-op. Con 5 días, 3 salían
-- íntegros de tren superior pese a haber pedido pierna.
--
-- Además se agregan dos opciones que pidió el usuario, para separar dos
-- intenciones que antes se mezclaban en una sola:
--   tren_inferior  → ÉNFASIS en pierna, conserva días de torso
--   full_inferior  → SOLO pierna
--   tren_superior  → ÉNFASIS en torso, conserva días de pierna
--   full_superior  → SOLO torso
--   equilibrado    → sin cambios, sigue siendo el reparto clásico
--
-- Las rutinas ya generadas no se tocan: quedan guardadas como están.
-- La app vieja sigue funcionando — manda 'tren_inferior'/'tren_superior', que
-- siguen siendo válidos y ahora sí respetan lo que se pide.

-- ── La columna tiene que aceptar los valores nuevos ─────────────────────────
-- Sin esto la función genera bien pero el insert falla: el check de la tabla
-- seguía limitado a los tres valores viejos. (Lo detectó la prueba de
-- generación antes de que llegara a nadie.)
alter table public.rutina_libre
  drop constraint if exists rutina_libre_enfoque_check;
alter table public.rutina_libre
  add constraint rutina_libre_enfoque_check
  check (enfoque is null or enfoque in (
    'equilibrado','tren_superior','tren_inferior','full_inferior','full_superior'));

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
  v_j int; v_num_targets int;
  v_usados_nombre text[]; v_usados_id uuid[]; v_orden int;
  v_equipo_filtro text[];
  v_peso numeric; v_talla numeric; v_imc numeric;
  v_evitar_impacto boolean := false;
  v_carga_previa text; v_es_cardio boolean;
  v_enfoque text;
  v_tope_dia int;        -- máximo de ejercicios por sesión
  v_cupo int;            -- cuántos sacar del músculo actual
  v_restante int;        -- cupo que queda del día
  v_prioritarios text[]; -- músculos del tren enfatizado (van primero)
  v_secundarios text[];
  v_orden_targets text[];
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
  if v_enfoque not in ('equilibrado','tren_superior','tren_inferior',
                       'full_inferior','full_superior') then
    raise exception 'enfoque inválido';
  end if;

  -- Techo de ejercicios por sesión según nivel. Es lo que evita los días de 9.
  v_tope_dia := case p_nivel
    when 'principiante' then 4
    when 'avanzado'     then 6
    else 5 end;

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

  -- NO se borra la rutina anterior: se archiva. Antes, crear una rutina nueva
  -- destruía la que tenías, así que era imposible guardar varias.
  update public.rutina_libre set activa = false
   where usuario_id = v_usuario and activa;

  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa, equipo, enfoque)
  values (v_usuario, v_nombre, p_objetivo, true, p_equipo, v_enfoque)
  returning id into v_rutina;

  create temporary table if not exists tmp_dias_def_libre (
    orden int, foco text, targets text[]
  ) on commit drop;
  truncate tmp_dias_def_libre;

  -- ── REPARTO DE DÍAS ─────────────────────────────────────────────────────
  --
  -- Bug reportado el 2026-08-03: alguien elegía "tren inferior" y le salían
  -- días enteros de pecho, espalda y brazos.
  --
  -- La causa: hasta acá el reparto de la semana dependía SÓLO de cuántos días
  -- entrena la persona, y el enfoque se aplicaba después reordenando los
  -- músculos DENTRO de cada día. Pero si el día es "Empuje (pecho, hombro,
  -- tríceps)", no hay ningún músculo de pierna que poner primero: reordenar no
  -- cambia nada. Con 5 días, 3 salían íntegros de tren superior.
  --
  -- Ahora el enfoque decide QUÉ días se arman. Cinco opciones:
  --
  --   equilibrado    reparto clásico, todo el cuerpo
  --   tren_inferior  ÉNFASIS en pierna, conserva días de torso
  --   full_inferior  SOLO pierna
  --   tren_superior  ÉNFASIS en torso, conserva días de pierna
  --   full_superior  SOLO torso
  --
  -- "Énfasis" vs "full" es la diferencia que pidió el usuario: quien quiere
  -- solo pierna lo pide explícitamente, y quien quiere priorizarla sin
  -- descompensarse elige la otra.
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

  -- ── SOLO PIERNA ─────────────────────────────────────────────────────────
  -- Se rota el foco (cuádriceps / glúteo e isquios / completa) para no repetir
  -- los mismos ejercicios y dar tiempo de recuperación entre sesiones.
  elsif v_enfoque = 'full_inferior' then
    for v_i in 1..p_dias_semana loop
      v_j := 1 + ((v_i - 1) % 3);
      if v_j = 1 then
        insert into tmp_dias_def_libre values (v_i, 'Pierna — cuádriceps',
          array['quads','glutes','calves']);
      elsif v_j = 2 then
        insert into tmp_dias_def_libre values (v_i, 'Pierna — glúteo e isquios',
          array['glutes','hamstrings','adductors']);
      else
        insert into tmp_dias_def_libre values (v_i, 'Pierna completa + core',
          array['quads','hamstrings','glutes','abs','calves']);
      end if;
    end loop;

  -- ── SOLO TORSO ──────────────────────────────────────────────────────────
  elsif v_enfoque = 'full_superior' then
    for v_i in 1..p_dias_semana loop
      v_j := 1 + ((v_i - 1) % 3);
      if v_j = 1 then
        insert into tmp_dias_def_libre values (v_i, 'Empuje (pecho, hombro, tríceps)',
          array['pectorals','delts','triceps']);
      elsif v_j = 2 then
        insert into tmp_dias_def_libre values (v_i, 'Tirón (espalda, bíceps)',
          array['lats','upper back','biceps']);
      else
        insert into tmp_dias_def_libre values (v_i, 'Torso completo + core',
          array['pectorals','lats','delts','biceps','abs']);
      end if;
    end loop;

  -- ── ÉNFASIS EN PIERNA (conserva torso) ──────────────────────────────────
  -- Mayoría de días de pierna, pero se mantiene al menos uno de torso para no
  -- descompensar. Con 1 día no hay margen: se hace pierna completa.
  elsif v_enfoque = 'tren_inferior' then
    if p_dias_semana = 1 then
      insert into tmp_dias_def_libre values
        (1, 'Pierna completa', array['quads','glutes','hamstrings','calves']);
    elsif p_dias_semana = 2 then
      insert into tmp_dias_def_libre values
        (1, 'Pierna — cuádriceps y glúteo', array['quads','glutes','calves']),
        (2, 'Pierna — isquios + torso',     array['hamstrings','glutes','lats','delts']);
    elsif p_dias_semana = 3 then
      insert into tmp_dias_def_libre values
        (1, 'Pierna — cuádriceps',        array['quads','glutes','calves']),
        (2, 'Torso',                      array['pectorals','lats','delts']),
        (3, 'Pierna — glúteo e isquios',  array['glutes','hamstrings','abs']);
    elsif p_dias_semana = 4 then
      insert into tmp_dias_def_libre values
        (1, 'Pierna — cuádriceps',        array['quads','glutes','calves']),
        (2, 'Torso',                      array['pectorals','lats','delts','biceps']),
        (3, 'Pierna — glúteo e isquios',  array['glutes','hamstrings','adductors']),
        (4, 'Pierna completa + core',     array['quads','hamstrings','glutes','abs']);
    elsif p_dias_semana = 5 then
      insert into tmp_dias_def_libre values
        (1, 'Pierna — cuádriceps',        array['quads','glutes','calves']),
        (2, 'Torso',                      array['pectorals','lats','delts']),
        (3, 'Pierna — glúteo e isquios',  array['glutes','hamstrings','adductors']),
        (4, 'Torso (tirón) + core',       array['lats','upper back','biceps','abs']),
        (5, 'Pierna completa',            array['quads','hamstrings','glutes','calves']);
    else
      insert into tmp_dias_def_libre values
        (1, 'Pierna — cuádriceps',        array['quads','glutes','calves']),
        (2, 'Torso (empuje)',             array['pectorals','delts','triceps']),
        (3, 'Pierna — glúteo e isquios',  array['glutes','hamstrings','adductors']),
        (4, 'Torso (tirón)',              array['lats','upper back','biceps']),
        (5, 'Pierna completa',            array['quads','hamstrings','glutes','calves']),
        (6, 'Glúteo + core',              array['glutes','adductors','abs']);
    end if;

  -- ── ÉNFASIS EN TORSO (conserva pierna) ──────────────────────────────────
  elsif v_enfoque = 'tren_superior' then
    if p_dias_semana = 1 then
      insert into tmp_dias_def_libre values
        (1, 'Torso completo', array['pectorals','lats','delts','biceps','triceps']);
    elsif p_dias_semana = 2 then
      insert into tmp_dias_def_libre values
        (1, 'Empuje (pecho, hombro, tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda, bíceps) + pierna', array['lats','upper back','biceps','quads']);
    elsif p_dias_semana = 3 then
      insert into tmp_dias_def_libre values
        (1, 'Empuje (pecho, hombro, tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda, bíceps)',         array['lats','upper back','biceps']),
        (3, 'Pierna',                          array['quads','glutes','hamstrings']);
    elsif p_dias_semana = 4 then
      insert into tmp_dias_def_libre values
        (1, 'Empuje (pecho, hombro, tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda, bíceps)',         array['lats','upper back','biceps']),
        (3, 'Torso completo + core',           array['pectorals','lats','delts','abs']),
        (4, 'Pierna',                          array['quads','glutes','hamstrings','calves']);
    elsif p_dias_semana = 5 then
      insert into tmp_dias_def_libre values
        (1, 'Empuje (pecho, hombro, tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda, bíceps)',         array['lats','upper back','biceps']),
        (3, 'Pierna',                          array['quads','glutes','hamstrings']),
        (4, 'Hombro y brazos',                 array['delts','biceps','triceps']),
        (5, 'Torso completo + core',           array['pectorals','lats','delts','abs']);
    else
      insert into tmp_dias_def_libre values
        (1, 'Empuje (pecho, hombro, tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda, bíceps)',         array['lats','upper back','biceps']),
        (3, 'Pierna',                          array['quads','glutes','hamstrings']),
        (4, 'Hombro y brazos',                 array['delts','biceps','triceps']),
        (5, 'Pecho y espalda',                 array['pectorals','lats','upper back']),
        (6, 'Torso completo + core',           array['pectorals','delts','lats','abs']);
    end if;

  -- ── EQUILIBRADO (el reparto de siempre) ─────────────────────────────────
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
    v_usados_nombre := array[]::text[]; v_usados_id := array[]::uuid[];

    -- ENFOQUE: en vez de sumar ejercicios (que disparaba el total), se ORDENAN
    -- los músculos poniendo primero los del tren enfatizado. Como el cupo del
    -- día es fijo, los primeros se llevan más ejercicios y los últimos menos —
    -- el énfasis se logra sin inflar la sesión.
    v_prioritarios := array[]::text[];
    v_secundarios := array[]::text[];
    for v_j in 1..v_num_targets loop
      v_target := v_targets[v_j];
      if (v_enfoque = 'tren_inferior' and public.es_tren_inferior(v_target))
         or (v_enfoque = 'tren_superior' and not public.es_tren_inferior(v_target)) then
        v_prioritarios := v_prioritarios || v_target;
      else
        v_secundarios := v_secundarios || v_target;
      end if;
    end loop;
    if v_enfoque = 'equilibrado' then
      v_orden_targets := v_targets;                       -- sin reordenar
    else
      v_orden_targets := v_prioritarios || v_secundarios; -- enfatizados primero
    end if;

    v_restante := v_tope_dia;

    for v_j in 1..array_length(v_orden_targets, 1) loop
      exit when v_restante <= 0;
      v_target := v_orden_targets[v_j];

      -- Reparto del cupo restante entre los músculos que faltan. Los primeros
      -- (los enfatizados) se llevan el redondeo hacia arriba.
      v_cupo := greatest(1, ceil(v_restante::numeric
                / greatest(array_length(v_orden_targets,1) - v_j + 1, 1))::int);
      v_cupo := least(v_cupo, v_restante);

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
        v_restante := v_restante - 1;
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
