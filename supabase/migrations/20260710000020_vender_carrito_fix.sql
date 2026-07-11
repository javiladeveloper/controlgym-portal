-- Fix de concurrencia en vender_carrito: el UPDATE que etiquetaba el
-- movimiento_financiero con venta_id usaba una heurística por
-- ref_tipo/ref_id + registrado_por + ventana de 10s. En un POS real, un
-- mismo cajero puede vender el MISMO producto en dos ventas distintas
-- dentro de esa ventana (dos clientes seguidos) y el UPDATE de la segunda
-- venta podía re-etiquetar (o cruzar) el movimiento de la primera.
--
-- Fix: registrar_mov_inventario ahora devuelve también el id de la fila de
-- movimiento_financiero que insertó (mov_id, null para 'ajuste' que no
-- toca caja). vender_carrito etiqueta esa fila por id exacto, sin
-- heurística de tiempo. El cambio de registrar_mov_inventario es
-- retrocompatible: seguía y sigue devolviendo jsonb; solo se agrega una
-- clave nueva. Todos los callers existentes (Kardex.jsx, api/mp/webhook.js,
-- revertir_activacion en 20260706000026) ignoran el valor de retorno.

-- ── registrar_mov_inventario: ahora devuelve también mov_id ─────────────────
create or replace function public.registrar_mov_inventario(
  p_sede_id uuid,
  p_producto_id uuid,
  p_tipo text,
  p_cantidad integer,
  p_monto numeric default null::numeric
) returns jsonb
language plpgsql set search_path to 'public' as $function$
declare
  v_empresa uuid;
  v_precio numeric(12,2);
  v_nombre text;
  v_stock int;
  v_monto numeric(12,2);
  v_mov_id uuid;
begin
  select empresa_id into v_empresa from public.sede where id = p_sede_id;
  if v_empresa is null then raise exception 'Sede no encontrada'; end if;
  if p_tipo not in ('venta','compra','ajuste') then raise exception 'Tipo inválido'; end if;
  if coalesce(p_cantidad,0) <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
  -- Rechazar totales no positivos en operaciones que sí mueven dinero.
  if p_tipo in ('venta','compra') and p_monto is not null and p_monto <= 0 then
    raise exception 'El total de la operación debe ser mayor a 0';
  end if;

  select precio, nombre into v_precio, v_nombre from public.producto
   where id = p_producto_id and empresa_id = v_empresa;
  if v_nombre is null then raise exception 'Producto no válido'; end if;

  select stock into v_stock from public.inventario_sede
   where sede_id = p_sede_id and producto_id = p_producto_id;
  v_stock := coalesce(v_stock, 0);

  if p_tipo = 'venta' and v_stock < p_cantidad then
    raise exception 'Stock insuficiente: quedan % unidades', v_stock;
  end if;

  insert into public.inventario_sede (empresa_id, sede_id, producto_id, stock)
  values (v_empresa, p_sede_id, p_producto_id,
          case when p_tipo = 'venta' then -p_cantidad else p_cantidad end)
  on conflict (sede_id, producto_id) do update
    set stock = public.inventario_sede.stock + case when p_tipo = 'venta' then -p_cantidad else p_cantidad end;

  -- El ajuste solo corrige stock; su "monto" es lo que el usuario ponga (o
  -- nada), NO precio×cantidad, porque no representa una venta/compra.
  v_monto := case when p_tipo = 'ajuste' then p_monto
                  else coalesce(p_monto, v_precio * p_cantidad) end;

  insert into public.movimiento_inventario (empresa_id, sede_id, producto_id, tipo, cantidad, monto, registrado_por)
  values (v_empresa, p_sede_id, p_producto_id, p_tipo, p_cantidad, v_monto, auth.uid());

  if p_tipo in ('venta','compra') then
    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, ref_tipo, ref_id, registrado_por)
    values (v_empresa, p_sede_id,
            case when p_tipo = 'venta' then 'ingreso' else 'gasto' end,
            case when p_tipo = 'venta' then 'venta_kardex' else 'compra' end,
            initcap(p_tipo) || ' ' || v_nombre || ' × ' || p_cantidad,
            coalesce(v_monto, v_precio * p_cantidad), 'producto', p_producto_id, auth.uid())
    returning id into v_mov_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'stock', (select stock from public.inventario_sede where sede_id = p_sede_id and producto_id = p_producto_id),
    'mov_id', v_mov_id
  );
end;
$function$;

grant execute on function public.registrar_mov_inventario(uuid, uuid, text, integer, numeric) to authenticated;

-- ── vender_carrito: etiqueta el movimiento_financiero por id exacto ─────────
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
  v_mov jsonb;
  v_mov_id uuid;
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
    -- (con ref_tipo='producto', ref_id=producto_id, registrado_por=auth.uid()),
    -- y ahora devuelve el id exacto de esa fila (mov_id) en su jsonb.
    v_mov := public.registrar_mov_inventario(p_sede_id, v_prod.id, 'venta', v_cant, v_precio * v_cant);
    v_mov_id := (v_mov->>'mov_id')::uuid;
    if v_mov_id is null then
      raise exception 'No se pudo registrar el movimiento de caja para el producto %', v_prod.nombre;
    end if;

    -- Etiqueta ÚNICAMENTE la fila recién creada (por id exacto), evitando
    -- cruzar movimientos de otra venta concurrente del mismo cajero/producto.
    update public.movimiento_financiero
      set venta_id = v_venta, metodo_pago = p_metodo_pago
      where id = v_mov_id;

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
