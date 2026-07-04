-- 049: Anulaciones con rastro contable (nada se borra de la caja).
--  · anular_membresia: estado 'cancelada' (+ opcional contra-asiento de devolución)
--  · anular_movimiento_financiero: contra-asiento (ingreso↔gasto) que neutraliza
--  · anular_mov_inventario: revierte stock y genera contra-asiento en caja

create or replace function public.anular_membresia(p_membresia_id uuid, p_devolver boolean default false)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_m public.membresia;
  v_socio text;
begin
  select * into v_m from public.membresia where id = p_membresia_id; -- RLS aplica
  if v_m.id is null then raise exception 'Membresía no encontrada o sin acceso'; end if;
  if v_m.estado = 'cancelada' then raise exception 'La membresía ya está anulada'; end if;

  select nombre into v_socio from public.socio where id = v_m.socio_id;

  update public.membresia set estado = 'cancelada' where id = p_membresia_id;
  update public.congelamiento set estado = 'finalizado', fecha_fin = current_date
   where membresia_id = p_membresia_id and estado = 'aprobado';

  if p_devolver and coalesce(v_m.precio_pagado, 0) + coalesce(v_m.matricula_pagada, 0) > 0 then
    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
    values (v_m.empresa_id, v_m.sede_id, 'gasto', 'membresia',
            'Devolución por anulación de membresía · ' || coalesce(v_socio, ''),
            coalesce(v_m.precio_pagado, 0) + coalesce(v_m.matricula_pagada, 0),
            'efectivo', 'membresia', p_membresia_id, auth.uid());
  end if;

  return jsonb_build_object('estado', 'cancelada', 'devolucion', p_devolver);
end;
$$;

grant execute on function public.anular_membresia(uuid, boolean) to authenticated;

create or replace function public.anular_movimiento_financiero(p_id uuid)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v public.movimiento_financiero;
begin
  select * into v from public.movimiento_financiero where id = p_id; -- RLS aplica
  if v.id is null then raise exception 'Movimiento no encontrado o sin acceso'; end if;
  if v.descripcion like 'ANULACIÓN:%' then raise exception 'No se puede anular una anulación'; end if;
  if exists (select 1 from public.movimiento_financiero
             where ref_tipo = 'anulacion' and ref_id = p_id) then
    raise exception 'Este movimiento ya fue anulado';
  end if;

  insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
  values (v.empresa_id, v.sede_id,
          case v.tipo when 'ingreso' then 'gasto' else 'ingreso' end,
          v.categoria, 'ANULACIÓN: ' || coalesce(v.descripcion, ''), v.monto,
          v.metodo_pago, 'anulacion', p_id, auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.anular_movimiento_financiero(uuid) to authenticated;

create or replace function public.anular_mov_inventario(p_id uuid)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v public.movimiento_inventario;
  v_stock int;
begin
  select * into v from public.movimiento_inventario where id = p_id; -- RLS aplica
  if v.id is null then raise exception 'Movimiento no encontrado o sin acceso'; end if;

  select stock into v_stock from public.inventario_sede
   where sede_id = v.sede_id and producto_id = v.producto_id for update;

  if v.tipo = 'venta' then
    -- Anular venta: el producto vuelve al stock, el dinero sale de caja
    update public.inventario_sede set stock = coalesce(v_stock, 0) + v.cantidad
     where sede_id = v.sede_id and producto_id = v.producto_id;
  else
    -- Anular compra: el producto sale del stock (si alcanza), el dinero vuelve
    if coalesce(v_stock, 0) < v.cantidad then
      raise exception 'No se puede anular: ya se vendieron unidades de esta compra (stock actual %)', coalesce(v_stock, 0);
    end if;
    update public.inventario_sede set stock = v_stock - v.cantidad
     where sede_id = v.sede_id and producto_id = v.producto_id;
  end if;

  if coalesce(v.monto, 0) > 0 then
    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
    values (v.empresa_id, v.sede_id,
            case v.tipo when 'venta' then 'gasto' else 'ingreso' end,
            'kardex', 'ANULACIÓN: ' || v.tipo || ' de inventario', v.monto, 'efectivo', 'anulacion', p_id, auth.uid());
  end if;

  delete from public.movimiento_inventario where id = p_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.anular_mov_inventario(uuid) to authenticated;

-- Áreas de acceso libre (musculación, cardio): son servicios del gym pero sin
-- horario ni cupos — se muestran como área, no como clase programada.
alter table public.tipo_clase
  add column if not exists acceso_libre boolean not null default false;
