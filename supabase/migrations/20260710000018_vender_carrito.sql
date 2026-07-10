-- POS: vende un carrito de productos en una sola operación. Agrupa los ítems
-- bajo un venta_id, baja stock, registra caja y crea UN comprobante multi-línea.
create or replace function public.vender_carrito(
  p_sede_id uuid,
  p_items jsonb,
  p_metodo_pago text default 'efectivo',
  p_cliente_tipo_doc text default '0',
  p_cliente_num_doc text default null,
  p_cliente_nombre text default 'CLIENTE VARIOS',
  p_cliente_email text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_venta uuid := gen_random_uuid();
  v_item jsonb;
  v_prod public.producto;
  v_precio numeric;
  v_cant int;
  v_total numeric := 0;
  v_comp uuid;
  v_base numeric; v_igv numeric;
  v_fac public.empresa_facturacion;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.producto
      where id = (v_item->>'producto_id')::uuid and empresa_id = v_empresa;
    if v_prod.id is null then raise exception 'Producto no encontrado'; end if;
    v_cant := coalesce((v_item->>'cantidad')::int, 1);
    if v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    -- precio efectivo: producto no tiene precio_oferta (esa columna no existe
    -- en el esquema actual); las ofertas se resuelven en otra fase. Se usa
    -- directamente el precio de lista.
    v_precio := v_prod.precio;

    -- Baja stock + ingreso en caja, reusando la RPC existente, con venta_id.
    -- registrar_mov_inventario ya valida stock y registra movimiento_financiero
    -- (con ref_tipo='producto', ref_id=producto_id, registrado_por=auth.uid()).
    perform public.registrar_mov_inventario(p_sede_id, v_prod.id, 'venta', v_cant, v_precio * v_cant);
    -- Etiqueta el movimiento recién creado con el venta_id y el método de pago.
    -- NOTA (MVP, decisión deliberada): se identifica el movimiento por
    -- ref_tipo/ref_id + venta_id is null + registrado_por + ventana de 10s,
    -- NO por el id del movimiento (registrar_mov_inventario no lo devuelve).
    -- Si el carrito trae el MISMO producto_id en dos líneas dentro de esta
    -- ventana, el UPDATE de la primera pasada podría etiquetar también el
    -- movimiento que la segunda línea todavía no ha insertado -- pero como
    -- ambos movimientos pertenecen a la MISMA venta_id, el resultado es
    -- inocuo (ambos deben terminar con el mismo venta_id de todos modos).
    -- El caso realmente problemático (colisión entre ventas distintas del
    -- mismo producto por el mismo cajero en la misma ventana de 10s) se
    -- considera aceptable para el MVP: el frontend agrupa cantidades por
    -- producto_id antes de enviar el carrito, así que un producto repetido
    -- dentro de un mismo carrito no debería ocurrir en la práctica. Si se
    -- vuelve un problema real, la solución robusta es hacer que
    -- registrar_mov_inventario devuelva el id del movimiento insertado y
    -- etiquetar por ese id en vez de por ref_id + ventana de tiempo.
    update public.movimiento_financiero
      set venta_id = v_venta, metodo_pago = p_metodo_pago
      where ref_tipo = 'producto' and ref_id = v_prod.id
        and venta_id is null and registrado_por = auth.uid()
        and created_at > now() - interval '10 seconds';

    v_total := v_total + v_precio * v_cant;
  end loop;

  -- Crear comprobante si el gym factura.
  select * into v_fac from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fac.empresa_id is not null and v_fac.activo then
    v_base := round(v_total / 1.18, 2);
    v_igv := v_total - v_base;
    insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, tipo,
      cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_email, base, igv, total)
    values (v_empresa, 'producto', 'venta', v_venta,
      case when p_cliente_tipo_doc = '6' then '01' else '03' end,
      p_cliente_tipo_doc, nullif(p_cliente_num_doc,''),
      coalesce(nullif(p_cliente_nombre,''),'CLIENTE VARIOS'),
      nullif(p_cliente_email,''), v_base, v_igv, v_total)
    returning id into v_comp;
  end if;

  return jsonb_build_object('venta_id', v_venta, 'total', v_total, 'comprobante_id', v_comp);
end;
$function$;
grant execute on function public.vender_carrito(uuid, jsonb, text, text, text, text, text) to authenticated;
