-- Actualiza el recojo para órdenes con VARIOS productos (carrito). Una orden se
-- entrega/cancela completa; al cancelar se repone el stock de TODOS sus items.

-- 1. Lista de órdenes por entregar, cada una con sus items (productos + cantidad).
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
           se.nombre as sede_nombre,
           -- Items de la orden (carrito). Si no hay items (orden vieja de 1
           -- producto), caemos al producto de ref_id para no perder nada.
           coalesce(
             (select jsonb_agg(jsonb_build_object(
                'producto_id', it.producto_id, 'nombre', pr.nombre,
                'cantidad', it.cantidad, 'subtotal', it.subtotal, 'imagen_url', pr.imagen_url)
                order by pr.nombre)
              from public.pago_app_item it
              join public.producto pr on pr.id = it.producto_id
              where it.pago_id = p.id),
             (select jsonb_build_array(jsonb_build_object(
                'producto_id', pr.id, 'nombre', pr.nombre, 'cantidad', 1,
                'subtotal', p.monto, 'imagen_url', pr.imagen_url))
              from public.producto pr where pr.id = p.ref_id)
           ) as items
      from public.pago_app p
      left join public.socio s on s.id = p.socio_id
      left join public.sede se on se.id = p.sede_id
     where p.empresa_id = public.auth_empresa_id()
       and p.tipo = 'producto'
       and p.estado_pago = 'aprobado'
       and p.estado_activacion = 'pendiente_activacion'
  ) t;
$function$;

grant execute on function public.productos_por_entregar() to authenticated;

-- 2. Cancelar la orden completa: repone el stock de TODOS los items y revierte
--    el ingreso. Solo si NO fue entregada. El reembolso en MP se hace aparte.
create or replace function public.cancelar_compra_producto(p_pago_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_pago public.pago_app;
  v_item record;
  v_repuestos int := 0;
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

  -- Reponer el stock de cada item (o del ref_id si es orden vieja de 1 producto).
  for v_item in
    select producto_id, cantidad from public.pago_app_item where pago_id = p_pago_id
  loop
    perform public.registrar_mov_inventario(v_pago.sede_id, v_item.producto_id, 'ajuste', v_item.cantidad, null);
    v_repuestos := v_repuestos + 1;
  end loop;
  if v_repuestos = 0 and v_pago.ref_id is not null then
    perform public.registrar_mov_inventario(v_pago.sede_id, v_pago.ref_id, 'ajuste', 1, null);
  end if;

  -- Revertir el ingreso (gasto de compensación por el total de la orden).
  insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, ref_tipo, ref_id, registrado_por)
  values (v_empresa, v_pago.sede_id, 'gasto', 'reembolso',
          'Reembolso compra app: ' || coalesce(v_pago.concepto, 'productos') ||
            case when p_motivo is not null then ' · ' || p_motivo else '' end,
          v_pago.monto, 'producto', v_pago.ref_id, auth.uid());

  update public.pago_app
     set estado_pago = 'reembolsado', estado_activacion = 'no_aplica'
   where id = p_pago_id;

  return jsonb_build_object('ok', true, 'stock_repuesto', true);
end;
$function$;

grant execute on function public.cancelar_compra_producto(uuid, text) to authenticated;

comment on function public.productos_por_entregar is 'Órdenes de productos compradas por app, pendientes de recojo, cada una con sus items (carrito). Compra-app/kardex.';
comment on function public.cancelar_compra_producto is 'Cancela una orden no entregada: repone el stock de TODOS sus items y revierte el ingreso (reembolso). El dinero se devuelve en MP aparte.';
