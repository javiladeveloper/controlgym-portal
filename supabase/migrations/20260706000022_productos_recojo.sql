-- Compra de productos por la app + recojo en el gym.
--
-- Flujo: el socio compra un producto en la app (MercadoPago split). El webhook
-- YA registra la venta con registrar_mov_inventario('venta') → descuenta stock
-- al pagar (lo reserva) y registra el ingreso en caja. Falta la parte de
-- RECOJO: dejar el producto "por entregar" y que recepción lo entregue o lo
-- cancele (reponiendo stock si se reembolsa).
--
-- Reutilizamos pago_app (tipo='producto'): estado_activacion sirve de estado de
-- recojo → 'pendiente_activacion' = por entregar, 'activado' = entregado.
-- Agregamos 'entregado_por'/'entregado_at' vía las columnas activado_* que ya
-- existen, y un estado 'reembolsado' en estado_pago para la cancelación.

-- 1. Los productos comprados por app deben quedar "por entregar". El webhook
--    marca estado_activacion='pendiente_activacion' para tipo='producto' (hoy
--    solo lo hacía para socios nuevos). Esto se ajusta en el webhook (JS); aquí
--    dejamos las RPCs que el panel usa.

-- 2. Lista de productos comprados por app pendientes de entregar (por sede/empresa).
create or replace function public.productos_por_entregar()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.pagado_at desc), '[]'::jsonb)
  from (
    select p.id, p.concepto, p.monto, p.moneda, p.sede_id, p.pagado_at,
           p.socio_id, s.nombre as socio_nombre, s.codigo as socio_codigo,
           pr.nombre as producto_nombre, p.ref_id as producto_id, pr.imagen_url,
           se.nombre as sede_nombre
      from public.pago_app p
      left join public.socio s  on s.id = p.socio_id
      left join public.producto pr on pr.id = p.ref_id
      left join public.sede se on se.id = p.sede_id
     where p.empresa_id = public.auth_empresa_id()
       and p.tipo = 'producto'
       and p.estado_pago = 'aprobado'
       and p.estado_activacion = 'pendiente_activacion'
  ) t;
$function$;

grant execute on function public.productos_por_entregar() to authenticated;

-- 3. Entregar el producto: solo marca la entrega (el stock ya se descontó al
--    pagar; la venta y el ingreso ya están registrados). Idempotente.
create or replace function public.entregar_producto(p_pago_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_pago public.pago_app;
begin
  if v_empresa is null or not (public.auth_is_admin() or public.auth_rol() in ('admin','recepcion')) then
    raise exception 'No autorizado para entregar productos';
  end if;

  select * into v_pago from public.pago_app
   where id = p_pago_id and empresa_id = v_empresa and tipo = 'producto' for update;
  if v_pago.id is null then raise exception 'Compra no encontrada'; end if;
  if v_pago.estado_activacion = 'activado' then raise exception 'Este producto ya fue entregado'; end if;
  if v_pago.estado_pago <> 'aprobado' then raise exception 'La compra no está aprobada'; end if;

  update public.pago_app
     set estado_activacion = 'activado', activado_at = now(), activado_por = auth.uid()
   where id = p_pago_id;

  return jsonb_build_object('ok', true);
end;
$function$;

grant execute on function public.entregar_producto(uuid) to authenticated;

-- 4. Cancelar la compra y REPONER stock (reembolso / socio no recogió / gym no
--    tiene el producto). Solo si NO fue entregado. Repone el stock que se había
--    reservado al pagar y marca el pago 'reembolsado'. El reembolso del dinero
--    en MercadoPago se hace aparte (esta RPC deja la contabilidad correcta).
create or replace function public.cancelar_compra_producto(p_pago_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_pago public.pago_app;
begin
  if v_empresa is null or not (public.auth_is_admin() or public.auth_rol() in ('admin','recepcion')) then
    raise exception 'No autorizado para cancelar compras';
  end if;

  select * into v_pago from public.pago_app
   where id = p_pago_id and empresa_id = v_empresa and tipo = 'producto' for update;
  if v_pago.id is null then raise exception 'Compra no encontrada'; end if;
  if v_pago.estado_activacion = 'activado' then
    raise exception 'El producto ya fue entregado; una devolución física se registra como ajuste de kardex';
  end if;
  if v_pago.estado_pago = 'reembolsado' then raise exception 'Esta compra ya fue cancelada'; end if;

  -- Reponer el stock reservado: un 'ajuste' de +1 (no toca caja; el reembolso
  -- del dinero se maneja aparte y se contabiliza como gasto si aplica).
  perform public.registrar_mov_inventario(v_pago.sede_id, v_pago.ref_id, 'ajuste', 1, null);

  -- Revertir el ingreso que registró la venta: gasto de compensación en caja,
  -- para que el cuadre no muestre un ingreso por algo que se reembolsó.
  insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, ref_tipo, ref_id, registrado_por)
  values (v_empresa, v_pago.sede_id, 'gasto', 'reembolso',
          'Reembolso compra app: ' || coalesce(v_pago.concepto, 'producto') ||
            case when p_motivo is not null then ' · ' || p_motivo else '' end,
          v_pago.monto, 'producto', v_pago.ref_id, auth.uid());

  update public.pago_app
     set estado_pago = 'reembolsado', estado_activacion = 'no_aplica'
   where id = p_pago_id;

  return jsonb_build_object('ok', true, 'stock_repuesto', true);
end;
$function$;

grant execute on function public.cancelar_compra_producto(uuid, text) to authenticated;

comment on function public.productos_por_entregar is 'Productos comprados por app aprobados y pendientes de recojo. Compra-app/kardex.';
comment on function public.entregar_producto is 'Marca un producto comprado por app como entregado (el stock ya se descontó al pagar). Idempotente.';
comment on function public.cancelar_compra_producto is 'Cancela una compra de producto no entregada: repone el stock reservado y revierte el ingreso (reembolso). El dinero se devuelve en MP aparte.';
