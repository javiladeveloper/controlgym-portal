-- "Tu rutina te acompaña" (PEDIDO 51): la rutina es del SOCIO, no del gym.
-- El gym aporta valor optimizándola, pero el socio se la lleva.
--
-- Regla del owner:
--   ¿tiene rutina propia?  NO → la del gym se adopta como suya
--                          SÍ → puede importarla al gym
-- Consecuencia: después del primer gym, todo socio tiene rutina propia.
--
-- Decisiones acordadas con el owner:
-- · entrenador_id NULL al importar. La rutina NO se amarra a un trainer: "hoy me
--   ayuda Pedrito, mañana Menganito, en otro horario Fernandito". `reporte_atenciones`
--   ya cuenta EVENTOS con fecha (quién la envió ese día), no propiedad — así una
--   rutina importada no infla las atenciones de nadie, y cuando un trainer la
--   optimice y la envíe, el flujo normal le acredita ESE día.
-- · enviado_at = now(): es su rutina, la ve de inmediato; el trainer ajusta luego.
-- · Vigencia: hereda la duración sugerida de la plantilla del gym para su objetivo
--   (8 semanas si no hay), para que entre al ciclo de "por vencer". Sin esto la
--   rutina quedaría huérfana, fuera del flujo del gym.
-- · Cargas: NO se tocan. Se devuelven SUGERENCIAS de reducción por inactividad.
--   Es seguridad, no cosmética: volver tras meses e intentar levantar lo de antes
--   es vía directa a lesión (se pierde adaptación neuromuscular). Pero el socio
--   decide y el trainer corrige — ahí es donde el gym aporta valor.

-- ── Cuánto bajar la carga tras una pausa (SUGERENCIA, no imposición) ──
create or replace function public.factor_carga_por_pausa(p_dias_inactivo int)
returns jsonb
language sql immutable
as $$
  select case
    when p_dias_inactivo is null then jsonb_build_object('factor', null, 'motivo', 'sin registro previo de este ejercicio')
    when p_dias_inactivo < 30   then jsonb_build_object('factor', 1.0,  'motivo', 'entrenaste hace poco: mantén tu carga')
    when p_dias_inactivo < 90   then jsonb_build_object('factor', 0.85, 'motivo', 'llevabas más de 1 mes sin este ejercicio: empieza ~15% más suave')
    when p_dias_inactivo < 365  then jsonb_build_object('factor', 0.6,  'motivo', 'llevabas varios meses sin este ejercicio: empieza ~40% más suave')
    else jsonb_build_object('factor', null, 'motivo', 'más de un año sin este ejercicio: arranca sin carga fija y sube rápido')
  end;
$$;

-- ── adoptar_rutina_del_gym(): la que el gym asignó pasa a ser MÍA ──
-- Para el socio que aún no tenía rutina propia. Idempotente: si ya tiene, no pisa.
create or replace function public.adoptar_rutina_del_gym()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_rutina uuid;
  v_nombre text;
  v_objetivo text;
  v_nueva uuid;
  v_dia record;
  v_nuevo_dia uuid;
  v_n int := 0;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  if exists (select 1 from public.rutina_libre where usuario_id = v_uid and activa) then
    return jsonb_build_object('ok', true, 'adoptada', false, 'motivo', 'ya tenías una rutina propia');
  end if;

  select r.id, r.nombre, coalesce(o.codigo, 'salud_general')
    into v_rutina, v_nombre, v_objetivo
  from public.rutina r
  join public.socio s on s.id = r.socio_id
  left join public.objetivo_entrenamiento o on o.id = r.objetivo_id
  where s.usuario_id = v_uid and s.deleted_at is null and r.activa
  order by r.created_at desc limit 1;

  if v_rutina is null then
    return jsonb_build_object('ok', true, 'adoptada', false, 'motivo', 'no tienes rutina asignada en ningún gym');
  end if;

  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa)
  values (v_uid, coalesce(v_nombre, 'Mi rutina'), v_objetivo, true)
  returning id into v_nueva;

  for v_dia in
    select id, dia_semana, foco from public.rutina_dia where rutina_id = v_rutina order by dia_semana
  loop
    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
    values (v_nueva, v_dia.dia_semana, v_dia.foco)
    returning id into v_nuevo_dia;

    insert into public.rutina_libre_ejercicio
      (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, carga, orden, notas)
    select v_nuevo_dia, ej.catalogo_id, re.nombre, re.series, re.reps, re.descanso, re.carga, re.orden, re.notas
    from public.rutina_ejercicio re
    left join public.ejercicio ej on ej.id = re.ejercicio_id
    where re.rutina_dia_id = v_dia.id
    order by re.orden;
    get diagnostics v_n = row_count;
  end loop;

  return jsonb_build_object('ok', true, 'adoptada', true, 'rutina_libre_id', v_nueva);
end $$;

-- ── llevar_rutina_del_gym(): me llevo la versión MEJORADA por el trainer ──
create or replace function public.llevar_rutina_del_gym()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  update public.rutina_libre set activa = false where usuario_id = v_uid and activa;
  return public.adoptar_rutina_del_gym();
end $$;

-- ── importar_mi_rutina_al_gym(): el socio trae SU rutina al gimnasio ──
create or replace function public.importar_mi_rutina_al_gym(p_empresa_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_socio uuid;
  v_libre uuid;
  v_objetivo_cod text;
  v_objetivo_id uuid;
  v_nombre text;
  v_sede uuid;
  v_nueva uuid;
  v_anterior uuid;
  v_semanas int;
  v_dia record;
  v_ej record;
  v_nuevo_dia uuid;
  v_ej_gym uuid;
  v_sug jsonb := '[]'::jsonb;
  v_dias_inact int;
  v_factor jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select id into v_socio from public.socio
  where usuario_id = v_uid and empresa_id = p_empresa_id and deleted_at is null limit 1;
  if v_socio is null then raise exception 'No eres socio de este gimnasio'; end if;

  select id, nombre, objetivo into v_libre, v_nombre, v_objetivo_cod
  from public.rutina_libre where usuario_id = v_uid and activa limit 1;
  if v_libre is null then raise exception 'No tienes una rutina propia para importar'; end if;

  select id into v_objetivo_id from public.objetivo_entrenamiento where codigo = v_objetivo_cod;
  select id into v_sede from public.sede where empresa_id = p_empresa_id and deleted_at is null
  order by created_at limit 1;

  -- duración sugerida de la plantilla del gym para ese objetivo (prioriza la del gym)
  select coalesce(
    (select duracion_semanas from public.plantilla_rutina
      where empresa_id = p_empresa_id and objetivo_id = v_objetivo_id and duracion_semanas is not null limit 1),
    (select duracion_semanas from public.plantilla_rutina
      where empresa_id is null and objetivo_id = v_objetivo_id and duracion_semanas is not null limit 1),
    8) into v_semanas;

  -- la rutina anterior del gym se desactiva (queda como historial)
  select id into v_anterior from public.rutina
  where socio_id = v_socio and empresa_id = p_empresa_id and activa
  order by created_at desc limit 1;
  update public.rutina set activa = false where id = v_anterior;

  insert into public.rutina (empresa_id, socio_id, nombre, objetivo_id, activa,
    entrenador_id, enviado_at, rutina_anterior_id,
    vigencia_inicio, vigencia_fin, duracion_semanas)
  values (p_empresa_id, v_socio, coalesce(v_nombre,'Mi rutina'), v_objetivo_id, true,
    null, now(), v_anterior,
    current_date, current_date + (v_semanas * 7), v_semanas)
  returning id into v_nueva;

  for v_dia in
    select id, dia_semana, foco from public.rutina_libre_dia
    where rutina_libre_id = v_libre order by dia_semana
  loop
    insert into public.rutina_dia (empresa_id, rutina_id, dia_semana, foco)
    values (p_empresa_id, v_nueva, v_dia.dia_semana, v_dia.foco)
    returning id into v_nuevo_dia;

    for v_ej in
      select id, catalogo_id, nombre, series, reps, descanso, carga, orden, notas
      from public.rutina_libre_ejercicio where rutina_libre_dia_id = v_dia.id order by orden
    loop
      -- puente de catálogos: conserva GIF del gym y permite casar la progresión
      v_ej_gym := public.ejercicio_del_gym_desde_catalogo(p_empresa_id, v_ej.catalogo_id, v_ej.nombre);

      insert into public.rutina_ejercicio
        (empresa_id, rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden, notas)
      values (p_empresa_id, v_nuevo_dia, v_ej_gym, v_ej.nombre, v_ej.series, v_ej.reps,
              v_ej.descanso, v_ej.carga, v_ej.orden, v_ej.notas);

      -- ¿hace cuánto no registra ESTE ejercicio?
      select (current_date - max(rel.fecha))::int into v_dias_inact
      from public.registro_entreno_libre rel
      where rel.rutina_libre_ejercicio_id = v_ej.id and rel.completado;

      v_factor := public.factor_carga_por_pausa(v_dias_inact);

      -- sugerencia SOLO informativa: la carga guardada queda intacta
      if v_ej.carga is not null and trim(v_ej.carga) <> '' then
        v_sug := v_sug || jsonb_build_object(
          'ejercicio', v_ej.nombre,
          'carga_actual', v_ej.carga,
          'dias_sin_hacerlo', v_dias_inact,
          'factor', v_factor->'factor',
          'motivo', v_factor->>'motivo');
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true, 'rutina_id', v_nueva, 'vigencia_semanas', v_semanas,
    'sugerencias_carga', v_sug);
end $$;

revoke all on function public.factor_carga_por_pausa(int) from public, authenticated;
revoke all on function public.adoptar_rutina_del_gym() from public, authenticated;
revoke all on function public.llevar_rutina_del_gym() from public, authenticated;
revoke all on function public.importar_mi_rutina_al_gym(uuid) from public, authenticated;
grant execute on function public.factor_carga_por_pausa(int) to authenticated;
grant execute on function public.adoptar_rutina_del_gym() to authenticated;
grant execute on function public.llevar_rutina_del_gym() to authenticated;
grant execute on function public.importar_mi_rutina_al_gym(uuid) to authenticated;
