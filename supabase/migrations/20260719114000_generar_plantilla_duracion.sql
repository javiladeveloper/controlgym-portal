-- Generar plantilla: duración sugerida + FIX del DELETE sin WHERE.
--
-- 1) Nuevo parámetro OPCIONAL p_duracion_semanas (4/8/12/16 o null): al generar,
--    el admin ya fija la duración sugerida del plan (antes solo desde el editor).
--    Se elimina la firma vieja de 4 args para que no haya ambigüedad ni llamadas
--    que se salten la duración.
--
-- 2) FIX IMPORTANTE: `delete from tmp_dias_def;` (sin WHERE) hacía fallar TODA la
--    generación desde el panel con "DELETE requires a WHERE clause" — la
--    protección safeupdate de PostgREST lo bloquea. Se cambia por `truncate`.
--    Este bug existía desde antes de este cambio y dejaba "✨ Generar plantilla"
--    inservible desde el panel (por SQL directo sí funcionaba, por eso pasó
--    desapercibido).
create or replace function public.generar_plantilla_rutina(
  p_empresa_id uuid, p_sede_id uuid, p_objetivo_codigo text,
  p_dias integer default 3, p_duracion_semanas integer default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_objetivo_id uuid; v_plantilla uuid; v_dia uuid;
  v_series int; v_reps text; v_descanso text;
  v_nombre text; v_es_split boolean; v_dia_num int; v_i int;
  v_foco text; v_targets text[]; v_target text; v_j int;
  v_num_targets int; v_por_target int; v_usados text[]; v_orden int;
  rec record; rec_ej record;
begin
  -- Seguridad: el caller solo puede generar para SU empresa (SECURITY DEFINER
  -- salta RLS, así que validamos explícitamente contra el JWT).
  if auth_empresa_id() is not null and p_empresa_id is distinct from auth_empresa_id() then
    raise exception 'no autorizado para esta empresa';
  end if;
  if not exists (select 1 from public.sede where id = p_sede_id and empresa_id = p_empresa_id) then
    raise exception 'sede no pertenece a la empresa';
  end if;
  if p_duracion_semanas is not null and p_duracion_semanas not in (4,8,12,16) then
    raise exception 'Duración inválida (usa 4, 8, 12 o 16 semanas)';
  end if;

  select id into v_objetivo_id from public.objetivo_entrenamiento where codigo = p_objetivo_codigo;
  if v_objetivo_id is null then raise exception 'objetivo inválido'; end if;

  -- Parámetros por objetivo (enfoque del entrenamiento).
  case p_objetivo_codigo
    when 'ganar_masa' then v_series:=4; v_reps:='8-12'; v_descanso:='90s';
    when 'fuerza'     then v_series:=5; v_reps:='3-5';  v_descanso:='2-3 min';
    when 'resistencia'then v_series:=3; v_reps:='15-20';v_descanso:='30s';
    when 'bajar_peso' then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    when 'tonificar'  then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    else v_series:=3; v_reps:='10-12'; v_descanso:='60s';
  end case;

  v_es_split := p_objetivo_codigo in ('ganar_masa', 'fuerza');
  v_nombre := 'Rutina ' || initcap(replace(p_objetivo_codigo,'_',' ')) || ' (' || p_dias || ' días)';

  -- Upsert por objetivo (único por objetivo_id + empresa_id).
  select id into v_plantilla from public.plantilla_rutina
  where objetivo_id = v_objetivo_id
    and coalesce(empresa_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_empresa_id,'00000000-0000-0000-0000-000000000000'::uuid)
  limit 1;

  if v_plantilla is not null then
    delete from public.plantilla_rutina_ejercicio
    where plantilla_rutina_dia_id in (
      select id from public.plantilla_rutina_dia where plantilla_rutina_id = v_plantilla);
    delete from public.plantilla_rutina_dia where plantilla_rutina_id = v_plantilla;
    -- la duración solo se pisa si el admin mandó una (si no, conserva la suya)
    update public.plantilla_rutina
       set nombre = v_nombre, duracion_semanas = coalesce(p_duracion_semanas, duracion_semanas)
     where id = v_plantilla;
  else
    insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, duracion_semanas)
    values (p_empresa_id, v_objetivo_id, v_nombre, p_duracion_semanas)
    returning id into v_plantilla;
  end if;

  create temporary table if not exists tmp_dias_def (
    orden int, foco text, targets text[]
  ) on commit drop;
  truncate tmp_dias_def;   -- ← antes: delete sin WHERE (bloqueado por safeupdate)

  if v_es_split then
    if p_dias >= 6 then
      insert into tmp_dias_def (orden, foco, targets) values
        (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (5, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (6, 'Pierna',                        array['glutes','quads','hamstrings','calves']);
    elsif p_dias = 5 then
      insert into tmp_dias_def (orden, foco, targets) values
        (1, 'Pecho',   array['pectorals','serratus anterior']),
        (2, 'Espalda', array['lats','upper back','traps']),
        (3, 'Pierna',  array['glutes','quads','hamstrings','calves']),
        (4, 'Hombro',  array['delts']),
        (5, 'Brazo',   array['biceps','triceps','forearms']);
    elsif p_dias = 4 then
      insert into tmp_dias_def (orden, foco, targets) values
        (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Hombro + Brazo',                array['delts','biceps','triceps']);
    else
      for v_i in 1..greatest(p_dias,1) loop
        v_j := 1 + ((v_i - 1) % 3);
        if v_j = 1 then
          insert into tmp_dias_def (orden, foco, targets)
          values (v_i, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']);
        elsif v_j = 2 then
          insert into tmp_dias_def (orden, foco, targets)
          values (v_i, 'Tirón (espalda/bíceps)', array['lats','upper back','biceps']);
        else
          insert into tmp_dias_def (orden, foco, targets)
          values (v_i, 'Pierna', array['glutes','quads','hamstrings','calves']);
        end if;
      end loop;
    end if;
  else
    -- FULL-BODY: 3 combinaciones A/B/C que se ciclan si p_dias > 3.
    for v_i in 1..greatest(p_dias,1) loop
      v_j := 1 + ((v_i - 1) % 3);
      if v_j = 1 then
        insert into tmp_dias_def (orden, foco, targets)
        values (v_i, 'Full body A', array['pectorals','lats','quads','glutes','abs']);
      elsif v_j = 2 then
        insert into tmp_dias_def (orden, foco, targets)
        values (v_i, 'Full body B', array['upper back','delts','hamstrings','glutes','abs']);
      else
        insert into tmp_dias_def (orden, foco, targets)
        values (v_i, 'Full body C', array['pectorals','biceps','triceps','quads','abs']);
      end if;
    end loop;
  end if;

  -- No crear días vacíos: si ningún ejercicio pasa el filtro de equipo de la
  -- sede, se omite el día. Los días creados se numeran secuencialmente.
  v_dia_num := 0;
  for rec in select orden, foco, targets from tmp_dias_def order by orden loop
    v_foco := rec.foco; v_targets := rec.targets;
    v_num_targets := array_length(v_targets, 1);
    v_por_target := greatest(1, (6 / greatest(v_num_targets,1)));
    v_usados := array[]::text[]; v_orden := 0;

    for v_j in 1..v_num_targets loop
      v_target := v_targets[v_j];
      for rec_ej in
        select coalesce(c.nombre_es, c.nombre) as nombre
        from public.ejercicio_catalogo c
        where c.activo and c.target = v_target
          and (c.equipment = 'body weight'
               or c.equipment in (select public.equipo_de_sede(p_sede_id)))
          and coalesce(c.nombre_es, c.nombre) <> all (v_usados)
        order by random() limit v_por_target
      loop
        v_usados := v_usados || rec_ej.nombre;
      end loop;
    end loop;

    if array_length(v_usados, 1) is null or array_length(v_usados, 1) = 0 then continue; end if;

    v_dia_num := v_dia_num + 1;
    insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
    values (v_plantilla, v_dia_num, v_foco) returning id into v_dia;

    v_orden := 0;
    for v_j in 1..array_length(v_usados,1) loop
      v_orden := v_orden + 1;
      insert into public.plantilla_rutina_ejercicio
        (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, orden)
      values (v_dia, null, v_usados[v_j], v_series, v_reps, v_descanso, v_orden);
    end loop;
  end loop;

  drop table if exists tmp_dias_def;
  return v_plantilla;
end $function$;

drop function if exists public.generar_plantilla_rutina(uuid, uuid, text, integer);

revoke all on function public.generar_plantilla_rutina(uuid, uuid, text, integer, integer) from public, authenticated;
grant execute on function public.generar_plantilla_rutina(uuid, uuid, text, integer, integer) to authenticated;
