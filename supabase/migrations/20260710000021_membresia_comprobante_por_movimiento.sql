-- Fix CRITICAL: cobrar_membresia_pos usaba ref_tipo='membresia', ref_id=p_membresia_id
-- para el comprobante. Como una membresía se renueva múltiples veces (enero, febrero...)
-- y hay un índice único uq_comprobante_ref sobre (ref_tipo, ref_id) where estado<>'anulado'
-- con "on conflict do nothing", la 2ª renovación en adelante NO emitía comprobante
-- (chocaba con el comprobante de la 1ª). Viola el spec "cada pago emite su boleta".
--
-- Fix: usar el id del movimiento_financiero de ESA renovación (único por cobro) como
-- ref_id del comprobante. Para eso, renew_membership debe devolver ese id.

-- 1) renew_membership: MISMA lógica que la versión anterior, solo se agrega la captura
--    del id del movimiento_financiero insertado (v_mov_id) y la clave 'mov_id' en el
--    jsonb de retorno. No cambia firma ni comportamiento de cobro/caja.
--    Es retrocompatible: agregar una clave al jsonb no rompe a quien ya lo consume
--    (p.ej. api/mp/webhook.js llama `select public.renew_membership($1,'mercadopago')`
--    sin leer el jsonb devuelto).
create or replace function public.renew_membership(
  p_membresia_id uuid,
  p_metodo_pago text default 'efectivo',
  p_precio_acordado numeric default null,
  p_monto_inicial numeric default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_m public.membresia;
  v_precio numeric(12,2);
  v_unidad text;
  v_nombre_plan text;
  v_nueva_fin date;
  v_cobra_ahora numeric(12,2);
  v_socio text;
  v_mov_id uuid;
begin
  select * into v_m from public.membresia where id = p_membresia_id;
  if v_m.id is null then raise exception 'Membresía no encontrada o sin acceso'; end if;

  select precio, unidad, nombre into v_precio, v_unidad, v_nombre_plan
  from public.plan where id = v_m.plan_id;

  -- Precio de esta renovación: el acordado si viene, si no el de lista.
  if p_precio_acordado is not null and p_precio_acordado >= 0 then
    v_precio := round(p_precio_acordado, 2);
  end if;

  -- Cuánto entra ahora: por defecto el precio completo; si mandan un inicial,
  -- se acota a [0, precio] (pago en partes).
  v_cobra_ahora := coalesce(p_monto_inicial, v_precio);
  if v_cobra_ahora < 0 then v_cobra_ahora := 0; end if;
  if v_cobra_ahora > v_precio then v_cobra_ahora := v_precio; end if;

  v_nueva_fin := greatest(v_m.fecha_fin, current_date) +
    case v_unidad
      when 'dia' then interval '1 day'
      when 'mes' then interval '1 month'
      when 'trimestre' then interval '3 months'
      when 'anual' then interval '1 year'
      else interval '1 month'
    end;

  update public.membresia
     set fecha_fin       = v_nueva_fin,
         estado          = 'activa',
         precio_pagado   = v_precio,
         matricula_pagada = 0,          -- la matrícula no se recobra al renovar
         monto_pagado    = v_cobra_ahora  -- reinicia el ciclo de pago
   where id = p_membresia_id;

  -- Si estaba de baja, vuelve a ser socio activo
  update public.socio set estado = 'activo'
   where id = v_m.socio_id and estado <> 'activo' and deleted_at is null;

  select nombre into v_socio from public.socio where id = v_m.socio_id;

  -- En caja entra SOLO lo cobrado ahora (0 si renovó sin pagar todavía).
  if v_cobra_ahora > 0 then
    insert into public.movimiento_financiero
      (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
    values (v_m.empresa_id, v_m.sede_id, 'ingreso', 'membresia',
            'Renovación ' || coalesce(v_nombre_plan, 'membresía')
              || case when v_cobra_ahora < v_precio
                      then ' · abono ' || trim(to_char(v_cobra_ahora,'FM999990.00')) || ' de ' || trim(to_char(v_precio,'FM999990.00'))
                      else '' end,
            v_cobra_ahora, coalesce(p_metodo_pago, 'efectivo'),
            'membresia', p_membresia_id, auth.uid())
    returning id into v_mov_id;
  end if;

  return jsonb_build_object(
    'estado', 'activa',
    'fecha_fin', v_nueva_fin,
    'precio', v_precio,
    'pagado', v_cobra_ahora,
    'saldo', v_precio - v_cobra_ahora,
    'mov_id', v_mov_id
  );
end;
$function$;

-- 2) cobrar_membresia_pos: el comprobante ahora referencia el movimiento_financiero
--    de ESTA renovación (único por cobro), no la membresía (que se repite en cada
--    renovación). Así cada renovación tiene su propio ref_id único y cada una emite
--    su boleta. Si mov_id es null (no se cobró nada), no se crea comprobante.
--    Se conserva "on conflict do nothing" por idempotencia real: dos llamadas con el
--    mismo movimiento no duplican el comprobante.
create or replace function public.cobrar_membresia_pos(
  p_membresia_id uuid,
  p_metodo_pago text default 'efectivo',
  p_monto numeric default null,
  p_cliente_tipo_doc text default '0',
  p_cliente_num_doc text default null,
  p_cliente_nombre text default 'CLIENTE VARIOS',
  p_cliente_email text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_res jsonb;
  v_cobrado numeric;
  v_mov_id uuid;
  v_comp uuid;
  v_base numeric; v_igv numeric;
  v_fac public.empresa_facturacion;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  -- renew_membership devuelve jsonb: {estado, fecha_fin, precio, pagado, saldo, mov_id}
  v_res := public.renew_membership(p_membresia_id, p_metodo_pago, null, p_monto);
  v_cobrado := coalesce((v_res->>'pagado')::numeric, p_monto);
  v_mov_id := nullif(v_res->>'mov_id','')::uuid;
  if v_cobrado is null or v_cobrado <= 0 or v_mov_id is null then
    return jsonb_build_object('cobrado', 0, 'comprobante_id', null);
  end if;

  select * into v_fac from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fac.empresa_id is not null and v_fac.activo then
    v_base := round(v_cobrado / 1.18, 2);
    v_igv := v_cobrado - v_base;
    insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, tipo,
      cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_email, base, igv, total)
    values (v_empresa, 'membresia', 'movimiento', v_mov_id,
      case when p_cliente_tipo_doc = '6' then '01' else '03' end,
      p_cliente_tipo_doc, nullif(p_cliente_num_doc,''),
      coalesce(nullif(p_cliente_nombre,''),'CLIENTE VARIOS'),
      nullif(p_cliente_email,''), v_base, v_igv, v_cobrado)
    on conflict (ref_tipo, ref_id) where estado <> 'anulado' do nothing
    returning id into v_comp;
  end if;

  return jsonb_build_object('cobrado', v_cobrado, 'comprobante_id', v_comp, 'renovacion', v_res);
end;
$function$;
