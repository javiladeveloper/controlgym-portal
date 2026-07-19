-- BUG D1: progreso_socio confundía "socio no encontrado o sin acceso" con
-- "socio existe pero no tiene usuario_id" (socio sin cuenta de app). El 92%
-- de los socios reales (69/75) no tienen usuario_id, así que la RPC rompía
-- para casi todos con un falso error de aislamiento.
--
-- Fix: separar el chequeo de existencia/empresa (aislamiento) del uso de
-- usuario_id. El raise de aislamiento solo dispara si la fila no existe o
-- no es de la empresa del llamante. Si usuario_id es null, la sección de
-- peso queda vacía (serie [], delta null, meta null) sin abortar la RPC;
-- asistencia y adherencia siguen funcionando porque se ligan por socio_id.
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

  -- adherencia por ejercicio: solo ejercicios de la rutina activa con >=1 registro
  -- completado en el periodo (criterio: no listar ejercicios sin ningún dato, para
  -- no ensuciar la vista del trainer con ceros de series que el socio ni empezó).
  select coalesce(jsonb_agg(jsonb_build_object(
      'ejercicio', x.nombre, 'veces', x.veces, 'carga_prom', x.carga_prom
    ) order by x.veces desc), '[]'::jsonb)
    into v_adherencia_ejercicio
  from (
    select re.nombre, count(ree.id) as veces, avg(ree.carga_usada) as carga_prom
    from public.rutina_ejercicio re
    join public.rutina_dia rd on rd.id = re.rutina_dia_id
    join public.registro_entreno_ejercicio ree
      on ree.rutina_ejercicio_id = re.id and ree.completado
     and ree.fecha between v_inicio and v_fin
    where rd.rutina_id = v_rutina_id
    group by re.id, re.nombre
    having count(ree.id) > 0
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
