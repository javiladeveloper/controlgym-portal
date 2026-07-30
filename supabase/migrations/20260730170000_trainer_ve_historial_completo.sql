-- BLOQUE C (spec 2026-07-30-vinculacion-y-rutina-portable-design.md): el
-- trainer ve el historial COMPLETO del socio, incluido el periodo en que
-- entrenaba solo (rutina libre).
--
-- Problema: el historial del socio vive en dos tablas —
-- registro_entreno_ejercicio (mundo gym, por socio_id) y
-- registro_entreno_libre (mundo libre, por usuario_id) — y ambas ya tienen
-- catalogo_id (20260730100000), el eje estable para cruzarlas. Para el propio
-- usuario ya se unen (mi_historial_ejercicio/mi_resumen_progreso,
-- 20260730130000). Pero las RPCs del trainer (progreso_socio,
-- analizar_progresion_socio) solo leían el mundo gym.
--
-- Bonus: como las FK al slot pasaron a "on delete set null" (20260730100000),
-- los registros de rutinas VIEJAS del gym con rutina_ejercicio_id ahora null
-- eran invisibles para analizar_progresion_socio (atada a ese id). Cruzar por
-- catalogo_id también los recupera.
--
-- Ambas RPCs mantienen firma y shape de retorno intactos (el panel las
-- consume en ProgresoRenovarModal / ficha del socio vía useProgresion.js).
-- Solo se amplían las FUENTES del historial de ejercicios.

-- ============================================================
-- progreso_socio(p_socio_id): adherencia_ejercicio ahora une también
-- registro_entreno_libre del usuario dueño del socio (si está vinculado),
-- cruzando por catalogo_id.
-- ============================================================
create or replace function public.progreso_socio(p_socio_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_socio_id uuid;
  v_usuario_id uuid;
  v_rutina_id uuid;
  v_inicio date;
  v_fin date;
  v_semanas numeric;
  v_dias_rutina int;
  v_peso jsonb;
  v_asistencia jsonb;
  v_adherencia_dia jsonb;
  v_adherencia_ejercicio jsonb;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;

  -- aislamiento: el socio debe existir y ser de la empresa del llamante.
  -- usuario_id puede ser null (socio sin cuenta de app) sin que eso sea un
  -- error de acceso: son cosas distintas.
  select id, usuario_id into v_socio_id, v_usuario_id
  from public.socio
  where id = p_socio_id and empresa_id = v_emp and deleted_at is null;
  if v_socio_id is null then
    raise exception 'socio no encontrado o sin acceso';
  end if;

  -- rutina activa del socio (para el periodo y la lista de ejercicios/días)
  select id, vigencia_inicio, vigencia_fin
    into v_rutina_id, v_inicio, v_fin
  from public.rutina
  where socio_id = p_socio_id and empresa_id = v_emp and activa
  order by created_at desc
  limit 1;

  if v_inicio is null then
    v_inicio := current_date - 60;
  end if;
  if v_fin is null then
    v_fin := current_date;
  end if;

  v_semanas := greatest(1, ceil((v_fin - v_inicio + 1) / 7.0));

  -- peso: serie del usuario del socio (medida_personal se liga por usuario_id).
  -- si el socio no tiene usuario_id (sin cuenta de app), no hay datos de peso.
  if v_usuario_id is null then
    v_peso := jsonb_build_object('serie', '[]'::jsonb, 'delta', null, 'meta', null);
  else
    select coalesce(jsonb_agg(jsonb_build_object('fecha', mp.fecha, 'peso_kg', mp.peso_kg) order by mp.fecha), '[]'::jsonb)
      into v_peso
    from public.medida_personal mp
    where mp.usuario_id = v_usuario_id
      and mp.fecha between v_inicio and v_fin;

    v_peso := jsonb_build_object(
      'serie', v_peso,
      'delta', (
        select case when count(*) < 2 then null
          else (array_agg(mp.peso_kg order by mp.fecha desc))[1] - (array_agg(mp.peso_kg order by mp.fecha asc))[1]
        end
        from public.medida_personal mp
        where mp.usuario_id = v_usuario_id and mp.fecha between v_inicio and v_fin
      ),
      'meta', (
        select jsonb_build_object('objetivo_kg', mt.peso_objetivo_kg, 'inicial_kg', mt.peso_inicial_kg)
        from public.meta_peso mt
        where mt.usuario_id = v_usuario_id and mt.activa
        order by mt.fecha_inicio desc nulls last
        limit 1
      )
    );
  end if;

  -- asistencia: días distintos con checkin de entrada permitido, en el periodo
  select jsonb_build_object(
    'dias', coalesce(count(distinct (c.ocurrido_en at time zone 'utc')::date), 0),
    'semanas', v_semanas
  ) into v_asistencia
  from public.checkin c
  where c.socio_id = p_socio_id
    and c.direccion = 'entrada' and c.resultado = 'permitido'
    and (c.ocurrido_en at time zone 'utc')::date between v_inicio and v_fin;

  -- adherencia por día: completados vs (nº de días de la rutina activa) x semanas
  select count(*) into v_dias_rutina from public.rutina_dia where rutina_id = v_rutina_id;

  select jsonb_build_object(
    'completados', coalesce((
      select count(*) from public.registro_entreno re
      where re.socio_id = p_socio_id and re.completado
        and re.fecha between v_inicio and v_fin
    ), 0),
    'esperados', round(coalesce(v_dias_rutina, 0) * v_semanas)
  ) into v_adherencia_dia;

  -- adherencia por ejercicio: ejercicios de la rutina activa con >=1 registro
  -- completado en el periodo, ya sea del mundo gym (registro_entreno_ejercicio
  -- por socio_id) o del mundo libre (registro_entreno_libre por usuario_id del
  -- socio, si está vinculado), cruzando por catalogo_id. Criterio: no listar
  -- ejercicios sin ningún dato, para no ensuciar la vista del trainer con
  -- ceros de series que el socio ni empezó.
  select coalesce(jsonb_agg(jsonb_build_object(
      'ejercicio', x.nombre, 'veces', x.veces, 'carga_prom', x.carga_prom
    ) order by x.veces desc), '[]'::jsonb)
    into v_adherencia_ejercicio
  from (
    select re.nombre,
           count(reg.fecha) as veces,
           avg(reg.carga_usada) as carga_prom
    from public.rutina_ejercicio re
    join public.rutina_dia rd on rd.id = re.rutina_dia_id
    left join public.ejercicio ej on ej.id = re.ejercicio_id
    left join lateral (
      -- mundo gym: por el slot exacto de esta rutina
      select ree.fecha, ree.carga_usada
      from public.registro_entreno_ejercicio ree
      where ree.rutina_ejercicio_id = re.id
        and ree.completado
        and ree.fecha between v_inicio and v_fin
      union all
      -- mundo libre: mismo catalogo_id, del usuario dueño del socio (si vinculado)
      select rel.fecha, rel.carga_usada
      from public.registro_entreno_libre rel
      where v_usuario_id is not null
        and ej.catalogo_id is not null
        and rel.usuario_id = v_usuario_id
        and rel.catalogo_id = ej.catalogo_id
        and rel.completado
        and rel.fecha between v_inicio and v_fin
    ) reg on true
    where rd.rutina_id = v_rutina_id
    group by re.id, re.nombre
    having count(reg.fecha) > 0
  ) x;

  return jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_inicio, 'fin', v_fin),
    'peso', v_peso,
    'asistencia', v_asistencia,
    'adherencia_dia', v_adherencia_dia,
    'adherencia_ejercicio', v_adherencia_ejercicio
  );
end $$;
revoke all on function public.progreso_socio(uuid) from public;
grant execute on function public.progreso_socio(uuid) to authenticated, service_role;

-- ============================================================
-- analizar_progresion_socio(p_socio_id): las "sesiones" de cada ejercicio de
-- la rutina activa ahora se arman cruzando por catalogo_id en vez de atarse
-- solo a rutina_ejercicio_id, e incluyen también el historial libre del
-- usuario del socio (si está vinculado). Esto recupera además, como bonus,
-- las sesiones de rutinas viejas del gym cuyo rutina_ejercicio_id quedó null
-- tras "on delete set null" (20260730100000).
-- ============================================================
create or replace function public.analizar_progresion_socio(p_socio_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_socio_id uuid;
  v_usuario_id uuid;
  v_rutina_id uuid;
  v_inicio date;
  v_fin date;
  v_semanas numeric;
  v_ejercicios jsonb;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;

  select id, usuario_id into v_socio_id, v_usuario_id from public.socio
  where id = p_socio_id and empresa_id = v_emp and deleted_at is null;
  if v_socio_id is null then raise exception 'socio no encontrado o sin acceso'; end if;

  select id, vigencia_inicio, vigencia_fin into v_rutina_id, v_inicio, v_fin
  from public.rutina
  where socio_id = p_socio_id and empresa_id = v_emp and activa
  order by created_at desc limit 1;

  if v_inicio is null then v_inicio := current_date - 60; end if;
  if v_fin is null then v_fin := current_date; end if;
  v_semanas := greatest(1, ceil((v_fin - v_inicio + 1) / 7.0));

  -- por ejercicio de la rutina activa: grupo muscular (del catálogo del gym),
  -- series objetivo, veces_esperado (nº de semanas del periodo, ya que cada
  -- ejercicio de un día toca 1 vez por semana), y la serie de sesiones —
  -- unión de registro_entreno_ejercicio (por catalogo_id, cualquier rutina
  -- del socio, no solo el slot actual) y registro_entreno_libre (por
  -- catalogo_id, del usuario del socio si está vinculado).
  select coalesce(jsonb_agg(jsonb_build_object(
      'ejercicio', t.nombre,
      'grupo_muscular', t.grupo_muscular,
      'dia', t.dia_nombre,
      'dia_id', t.dia_id,
      'series_obj', t.series,
      'veces_esperado', round(v_semanas)::int,
      'sesiones', t.sesiones
    ) order by t.dia_semana nulls last, t.orden nulls last, t.nombre), '[]'::jsonb)
    into v_ejercicios
  from (
    select re.id, re.nombre, re.orden, re.series,
           ej.grupo_muscular,
           ej.catalogo_id,
           rd.id as dia_id,
           rd.dia_semana,
           coalesce(nullif(trim(rd.foco), ''), 'Día ' || rd.dia_semana::text) as dia_nombre,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                 'fecha', s.fecha, 'completado', s.completado, 'carga', s.carga_usada
               ) order by s.fecha)
             from (
               -- mundo gym: por catalogo_id si existe (recupera también
               -- rutinas viejas con rutina_ejercicio_id ya null); si el
               -- ejercicio no tiene catalogo_id (no linkeado al catálogo
               -- maestro), cae al slot exacto para no perder cobertura.
               select ree.fecha, ree.completado, ree.carga_usada
               from public.registro_entreno_ejercicio ree
               where ree.socio_id = p_socio_id
                 and ree.fecha between v_inicio and v_fin
                 and (
                   (ej.catalogo_id is not null and ree.catalogo_id = ej.catalogo_id)
                   or (ej.catalogo_id is null and ree.rutina_ejercicio_id = re.id)
                 )
               union all
               -- mundo libre: mismo catalogo_id, del usuario dueño del socio
               select rel.fecha, rel.completado, rel.carga_usada
               from public.registro_entreno_libre rel
               where v_usuario_id is not null
                 and ej.catalogo_id is not null
                 and rel.usuario_id = v_usuario_id
                 and rel.catalogo_id = ej.catalogo_id
                 and rel.fecha between v_inicio and v_fin
             ) s
           ), '[]'::jsonb) as sesiones
    from public.rutina_ejercicio re
    join public.rutina_dia rd on rd.id = re.rutina_dia_id
    left join public.ejercicio ej on ej.id = re.ejercicio_id
    where rd.rutina_id = v_rutina_id
  ) t;

  return jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_inicio, 'fin', v_fin),
    'ejercicios', v_ejercicios
  );
end $$;

-- Bloqueo por defecto: en este esquema authenticated tiene execute por default
-- privilege, así que hay que revocar a public Y authenticated y regrantear
-- explícitamente. La RPC valida empresa internamente (security definer).
revoke all on function public.analizar_progresion_socio(uuid) from public, authenticated;
grant execute on function public.analizar_progresion_socio(uuid) to authenticated;
