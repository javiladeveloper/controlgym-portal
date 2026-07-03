-- ============================================================================
-- 33 · RPCs de operación diaria del panel
--   · inscribir_socio: alta de socio (+ membresía + matrícula → caja) y
--     conversión opcional de un lead del CRM.
--   · registrar_mov_inventario: venta/compra de kardex → stock + caja.
--   · checkin_manual: check-in desde recepción (valida membresía).
-- ============================================================================

-- ── Alta de socio (con membresía opcional) ──────────────────────────────────
create or replace function public.inscribir_socio(
  p_sede_id uuid,
  p_nombre text,
  p_telefono text default null,
  p_email text default null,
  p_documento text default null,
  p_fecha_nacimiento date default null,
  p_objetivo text default null,
  p_plan_id uuid default null,
  p_lead_id uuid default null
)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_empresa uuid;
  v_codigo text;
  v_socio uuid;
  v_plan public.plan;
  v_fin date;
  v_total numeric(12,2) := 0;
begin
  select empresa_id into v_empresa from public.sede where id = p_sede_id; -- RLS aplica
  if v_empresa is null then raise exception 'Sede no encontrada'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  -- Código correlativo por empresa (0001, 0002, …)
  select lpad((coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
    into v_codigo
  from public.socio where empresa_id = v_empresa;

  insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, email, documento, fecha_nacimiento, objetivo, estado, created_by)
  values (v_empresa, p_sede_id, v_codigo, trim(p_nombre), nullif(trim(p_telefono),''), nullif(trim(p_email),''),
          nullif(trim(p_documento),''), p_fecha_nacimiento, nullif(trim(p_objetivo),''), 'activo', auth.uid())
  returning id into v_socio;

  -- Membresía + cobro (mensualidad + matrícula si el plan la cobra)
  if p_plan_id is not null then
    select * into v_plan from public.plan where id = p_plan_id and empresa_id = v_empresa;
    if v_plan.id is null then raise exception 'Plan no válido'; end if;

    v_fin := current_date + case v_plan.unidad
      when 'dia' then interval '1 day' when 'mes' then interval '1 month'
      when 'trimestre' then interval '3 months' when 'anual' then interval '1 year'
      else interval '1 month' end;

    v_total := v_plan.precio + case when v_plan.cobra_matricula then coalesce(v_plan.precio_matricula,0) else 0 end;

    insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, matricula_pagada)
    values (v_empresa, p_sede_id, v_socio, p_plan_id, current_date, v_fin, 'activa', v_plan.precio,
            case when v_plan.cobra_matricula then coalesce(v_plan.precio_matricula,0) else 0 end);

    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, ref_tipo, ref_id, registrado_por)
    values (v_empresa, p_sede_id, 'ingreso', 'membresia',
            'Inscripción ' || v_plan.nombre || ' · ' || trim(p_nombre) ||
              case when v_plan.cobra_matricula and coalesce(v_plan.precio_matricula,0) > 0 then ' (incluye matrícula)' else '' end,
            v_total, 'socio', v_socio, auth.uid());
  end if;

  -- Conversión desde el CRM
  if p_lead_id is not null then
    update public.lead set etapa = 'inscrito', socio_id = v_socio where id = p_lead_id;
  end if;

  return jsonb_build_object('socio_id', v_socio, 'codigo', v_codigo, 'total_cobrado', v_total);
end;
$$;

grant execute on function public.inscribir_socio(uuid,text,text,text,text,date,text,uuid,uuid) to authenticated;

-- ── Movimiento de inventario (kardex) ───────────────────────────────────────
create or replace function public.registrar_mov_inventario(
  p_sede_id uuid,
  p_producto_id uuid,
  p_tipo text,            -- 'venta' | 'compra' | 'ajuste'
  p_cantidad int,
  p_monto numeric default null  -- null => cantidad × precio del producto (en venta)
)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
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

  select precio, nombre into v_precio, v_nombre from public.producto
   where id = p_producto_id and empresa_id = v_empresa;
  if v_nombre is null then raise exception 'Producto no válido'; end if;

  select stock into v_stock from public.inventario_sede
   where sede_id = p_sede_id and producto_id = p_producto_id;
  v_stock := coalesce(v_stock, 0);

  if p_tipo = 'venta' and v_stock < p_cantidad then
    raise exception 'Stock insuficiente: quedan % unidades', v_stock;
  end if;

  -- Actualizar stock
  insert into public.inventario_sede (empresa_id, sede_id, producto_id, stock)
  values (v_empresa, p_sede_id, p_producto_id,
          case when p_tipo = 'venta' then -p_cantidad else p_cantidad end)
  on conflict (sede_id, producto_id) do update
    set stock = public.inventario_sede.stock + case when p_tipo = 'venta' then -p_cantidad else p_cantidad end;

  v_monto := coalesce(p_monto, v_precio * p_cantidad);

  insert into public.movimiento_inventario (empresa_id, sede_id, producto_id, tipo, cantidad, monto, registrado_por)
  values (v_empresa, p_sede_id, p_producto_id, p_tipo, p_cantidad, v_monto, auth.uid());

  -- Impacto en caja (venta = ingreso, compra = gasto; ajuste no toca caja)
  if p_tipo in ('venta','compra') then
    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, ref_tipo, ref_id, registrado_por)
    values (v_empresa, p_sede_id,
            case when p_tipo = 'venta' then 'ingreso' else 'gasto' end,
            case when p_tipo = 'venta' then 'venta_kardex' else 'compra' end,
            initcap(p_tipo) || ' ' || v_nombre || ' × ' || p_cantidad,
            v_monto, 'producto', p_producto_id, auth.uid());
  end if;

  return jsonb_build_object('ok', true, 'stock_actual', v_stock + case when p_tipo='venta' then -p_cantidad else p_cantidad end, 'monto', v_monto);
end;
$$;

grant execute on function public.registrar_mov_inventario(uuid,uuid,text,int,numeric) to authenticated;

-- ── Check-in manual desde recepción ─────────────────────────────────────────
create or replace function public.checkin_manual(
  p_socio_id uuid,
  p_sede_id uuid,
  p_direccion text default 'entrada'
)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_empresa uuid;
  v_nombre text;
  v_ok boolean;
  v_resultado text;
  v_motivo text;
begin
  select empresa_id, nombre into v_empresa, v_nombre from public.socio where id = p_socio_id;
  if v_empresa is null then raise exception 'Socio no encontrado'; end if;

  -- ¿Membresía activa vigente?
  select exists (
    select 1 from public.membresia m
    where m.socio_id = p_socio_id and m.estado = 'activa'
      and current_date between m.fecha_inicio and m.fecha_fin
  ) into v_ok;

  v_resultado := case when v_ok then 'permitido' else 'denegado' end;
  v_motivo := case when v_ok then null else 'membresia_vencida' end;

  insert into public.checkin (empresa_id, sede_id, socio_id, direccion, metodo, resultado, motivo)
  values (v_empresa, p_sede_id, p_socio_id, p_direccion, 'manual', v_resultado, v_motivo);

  return jsonb_build_object('resultado', v_resultado, 'motivo', v_motivo, 'socio', v_nombre);
end;
$$;

grant execute on function public.checkin_manual(uuid,uuid,text) to authenticated;
