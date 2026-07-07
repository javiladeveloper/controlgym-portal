-- Auditoría pre-demo (parte 4, backend): integridad de kardex y planilla.
-- Estos SQL los identificaron los agentes de auditoría y se revisaron a mano
-- antes de aplicar (no se aplicaron a ciegas).

-- ── 1. registrar_mov_inventario: 'ajuste' no debe registrar monto de caja, y
--       venta/compra rechazan totales <= 0 (defensa en profundidad; el front
--       ya valida, pero la API no debía aceptarlo). ────────────────────────
create or replace function public.registrar_mov_inventario(p_sede_id uuid, p_producto_id uuid, p_tipo text, p_cantidad integer, p_monto numeric default null::numeric)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_empresa uuid;
  v_precio numeric(12,2);
  v_nombre text;
  v_stock int;
  v_monto numeric(12,2);
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
            coalesce(v_monto, v_precio * p_cantidad), 'producto', p_producto_id, auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'stock', (select stock from public.inventario_sede where sede_id = p_sede_id and producto_id = p_producto_id));
end;
$function$;

-- ── 2. Idempotencia de planilla MENSUAL: impedir doble pago de sueldo del
--       mismo colaborador en el mismo mes. El personal 'por_clase' SÍ puede
--       cobrar varias veces al mes, así que el candado es PARCIAL y solo aplica
--       a los pagos marcados como sueldo mensual.
--
--       Se marca el movimiento con es_planilla_mensual + un mes_planilla (date
--       al día 1 del mes, calculado en el cliente/trigger). El unique va sobre
--       esa columna concreta — no sobre una expresión de timestamptz, que no
--       es inmutable y no se puede indexar. ───────────────────────────────
alter table public.movimiento_financiero
  add column if not exists es_planilla_mensual boolean not null default false;
alter table public.movimiento_financiero
  add column if not exists mes_planilla date;

create unique index if not exists uq_planilla_mensual_mes
  on public.movimiento_financiero (empresa_id, ref_id, mes_planilla)
  where categoria = 'planilla' and ref_tipo = 'usuario' and es_planilla_mensual = true;
