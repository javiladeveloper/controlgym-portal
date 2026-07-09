-- PEDIDO 15 Fase 1.d — "Pagos por activar".
--
-- Cuando un socio NUEVO paga una membresía desde la app, el webhook de MP crea
-- el pago_app con estado_pago='aprobado' y estado_activacion='pendiente_activacion'
-- (aún no existe como socio del gym; solo tenemos sus datos: nuevo_nombre, etc.).
-- Recepción los ve en esta lista y los activa: se crea el socio + su membresía.
--
-- Clave: el ingreso EN CAJA ya lo registró el webhook al aprobarse el pago, así
-- que aquí NO se crea otro movimiento_financiero (evita el doble conteo). Solo
-- se materializa el socio y su membresía, y se enlaza el pago_app.

-- 1. Lista de pagos aprobados que esperan activación (empresa activa, solo admin/recepción).
create or replace function public.pagos_por_activar()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.pagado_at desc), '[]'::jsonb)
  from (
    select p.id, p.tipo, p.concepto, p.monto, p.moneda,
           p.nuevo_nombre, p.nuevo_documento, p.nuevo_email, p.nuevo_telefono,
           p.fecha_inicio, p.ref_id as plan_id, p.sede_id, p.pagado_at,
           pl.nombre as plan_nombre
      from public.pago_app p
      left join public.plan pl on pl.id = p.ref_id
     where p.empresa_id = public.auth_empresa_id()
       and p.estado_pago = 'aprobado'
       and p.estado_activacion = 'pendiente_activacion'
  ) t;
$function$;

grant execute on function public.pagos_por_activar() to authenticated;

-- 2. Activar un pago: crea el socio + su membresía y enlaza el pago.
--    p_sede_id/p_plan_id permiten corregir la sede o el plan si hiciera falta;
--    por defecto usa los del pago.
create or replace function public.activar_pago_app(
  p_pago_id uuid,
  p_sede_id uuid default null,
  p_plan_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_pago    public.pago_app;
  v_sede    uuid;
  v_plan    public.plan;
  v_codigo  text;
  v_socio   uuid;
  v_fin     date;
  v_inicio  date;
begin
  if v_empresa is null or not (public.auth_is_admin()
      or public.auth_rol() in ('admin','recepcion')) then
    raise exception 'No autorizado para activar pagos';
  end if;

  select * into v_pago from public.pago_app
   where id = p_pago_id and empresa_id = v_empresa
   for update;
  if v_pago.id is null then raise exception 'Pago no encontrado'; end if;
  if v_pago.estado_pago <> 'aprobado' then
    raise exception 'El pago no está aprobado (estado: %)', v_pago.estado_pago;
  end if;
  if v_pago.estado_activacion = 'activado' then
    raise exception 'Este pago ya fue activado';
  end if;
  if v_pago.tipo <> 'membresia' then
    raise exception 'Solo se activan pagos de membresía';
  end if;

  v_sede := coalesce(p_sede_id, v_pago.sede_id);
  if v_sede is null then raise exception 'Falta la sede para activar'; end if;

  select * into v_plan from public.plan
   where id = coalesce(p_plan_id, v_pago.ref_id) and empresa_id = v_empresa;
  if v_plan.id is null then raise exception 'Plan no válido'; end if;

  -- Si el documento ya existe en el gym, NO creamos un duplicado: reusamos ese
  -- socio (fue un "socio nuevo" desde la app, pero ya estaba registrado). Le
  -- renovamos la membresía en lugar de inscribirlo otra vez.
  if nullif(trim(v_pago.nuevo_documento), '') is not null then
    select id, codigo into v_socio, v_codigo
      from public.socio
     where empresa_id = v_empresa and documento = trim(v_pago.nuevo_documento)
       and deleted_at is null
     limit 1;
  end if;

  if v_socio is null then
    -- Socio realmente nuevo: código correlativo (mismo esquema que inscribir_socio)
    select lpad((coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
      into v_codigo
    from public.socio where empresa_id = v_empresa;

    insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, email, documento, estado, created_by)
    values (v_empresa, v_sede, v_codigo,
            coalesce(nullif(trim(v_pago.nuevo_nombre), ''), 'Socio app'),
            nullif(trim(v_pago.nuevo_telefono), ''),
            nullif(trim(v_pago.nuevo_email), ''),
            nullif(trim(v_pago.nuevo_documento), ''),
            'activo', auth.uid())
    returning id into v_socio;
  else
    -- Socio existente: lo reactivamos si estaba inactivo/moroso.
    update public.socio set estado = 'activo', updated_at = now()
     where id = v_socio and estado <> 'activo';
  end if;

  -- Punto de partida de la vigencia: si el socio ya tiene una membresía vigente
  -- (caso "socio existente"), extendemos desde su fecha_fin; si no, desde hoy o
  -- la fecha_inicio que traía el pago.
  select max(fecha_fin) into v_inicio
    from public.membresia
   where socio_id = v_socio and estado = 'activa' and fecha_fin >= current_date;
  v_inicio := greatest(coalesce(v_inicio, current_date), coalesce(v_pago.fecha_inicio, current_date));

  v_fin := v_inicio + case v_plan.unidad
    when 'dia' then interval '1 day' when 'mes' then interval '1 month'
    when 'trimestre' then interval '3 months' when 'anual' then interval '1 year'
    else interval '1 month' end;

  -- Membresía ya pagada (el monto entró por MP; monto_pagado = lo que pagó).
  insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, monto_pagado)
  values (v_empresa, v_sede, v_socio, v_plan.id, v_inicio, v_fin, 'activa', v_pago.monto, v_pago.monto);

  -- NO se crea movimiento_financiero: el webhook ya registró el ingreso al
  -- aprobarse el pago. Aquí solo materializamos socio + membresía.

  update public.pago_app
     set socio_id = v_socio,
         estado_activacion = 'activado',
         activado_at = now(),
         activado_por = auth.uid()
   where id = p_pago_id;

  return jsonb_build_object('socio_id', v_socio, 'codigo', v_codigo, 'vence', v_fin);
end;
$function$;

grant execute on function public.activar_pago_app(uuid, uuid, uuid) to authenticated;

comment on function public.pagos_por_activar is
  'Pagos de app aprobados que esperan activación (socio nuevo). PEDIDO 15 Fase 1.d.';
comment on function public.activar_pago_app is
  'Crea el socio + membresía de un pago_app aprobado (socio nuevo) y lo marca activado. NO duplica el ingreso en caja (ya lo registró el webhook). PEDIDO 15 Fase 1.d.';
