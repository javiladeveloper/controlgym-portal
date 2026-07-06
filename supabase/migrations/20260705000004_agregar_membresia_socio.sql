-- ============================================================================
-- 91 (20260705000004) · Agregar membresía a un socio EXISTENTE (ex-socio que
-- retoma, o renovación con precio acordado). No recrea el socio.
--
-- Pedido del cliente: si al poner el DNI en "Nuevo socio" resulta que YA es
-- socio, en vez de bloquear, poder agregarle una membresía nueva directamente
-- (elegir plan + precio acordado + método + pago en partes), reactivándolo si
-- estaba de baja/inactivo. El "descuento por volver" es el precio acordado.
--
-- Reusa la misma lógica de cobro de inscribir_socio pero sin crear socio ni
-- manejar invitados de grupo (un retorno es individual).
-- ============================================================================

create or replace function public.agregar_membresia_socio(
  p_socio_id uuid,
  p_plan_id uuid,
  p_metodo_pago text default 'efectivo',
  p_promocion_id uuid default null,
  p_precio_acordado numeric default null,
  p_monto_inicial numeric default null,
  p_motivo text default null           -- ej. 'descuento por volver' (queda en la nota)
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_socio public.socio;
  v_plan public.plan;
  v_promo public.promocion;
  v_precio numeric(12,2) := 0;
  v_matricula numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_cobrado numeric(12,2) := 0;
  v_fin date;
  v_desc text := '';
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;

  select * into v_socio from public.socio
   where id = p_socio_id and empresa_id = v_empresa and deleted_at is null;
  if v_socio.id is null then raise exception 'Socio no encontrado'; end if;

  select * into v_plan from public.plan where id = p_plan_id and empresa_id = v_empresa;
  if v_plan.id is null then raise exception 'Plan no válido'; end if;

  -- Reactivar si estaba de baja/inactivo (el que retoma vuelve a activo)
  if v_socio.estado <> 'activo' then
    update public.socio set estado = 'activo' where id = v_socio.id;
  end if;

  v_fin := current_date + case v_plan.unidad
    when 'dia' then interval '1 day' when 'mes' then interval '1 month'
    when 'trimestre' then interval '3 months' when 'anual' then interval '1 year'
    else interval '1 month' end;

  v_precio := v_plan.precio;
  v_matricula := case when v_plan.cobra_matricula then coalesce(v_plan.precio_matricula,0) else 0 end;

  -- Promoción (mismos tipos individuales que inscribir_socio; grupos no aplican
  -- a un retorno individual)
  if p_promocion_id is not null then
    select * into v_promo from public.promocion
     where id = p_promocion_id and empresa_id = v_empresa and estado = 'activa' and deleted_at is null;
    if v_promo.id is not null then
      if v_promo.tipo = 'descuento_pct' then
        v_precio := round(v_precio * (1 - coalesce(v_promo.valor,0) / 100), 2);
        v_desc := v_promo.nombre || ' (−' || coalesce(v_promo.valor,0) || '%)';
      elsif v_promo.tipo = 'descuento_monto' then
        v_precio := greatest(0, v_precio - coalesce(v_promo.valor,0));
        v_desc := v_promo.nombre;
      elsif v_promo.tipo = 'semana_gratis' then
        v_fin := v_fin + 7; v_desc := v_promo.nombre || ' (+7 días)';
      elsif v_promo.tipo = 'precio_especial' then
        v_precio := coalesce(v_promo.valor, v_precio);
        if v_promo.duracion_meses is not null then
          v_fin := current_date + (v_promo.duracion_meses || ' months')::interval;
        end if;
        v_desc := v_promo.nombre;
      else
        v_desc := v_promo.nombre;
      end if;
      update public.promocion set canjes = canjes + 1 where id = v_promo.id;
    end if;
  end if;

  -- Precio acordado (el "descuento por volver" lo maneja recepción/admin)
  if p_precio_acordado is not null then
    v_precio := greatest(0, p_precio_acordado);
    v_desc := coalesce(nullif(p_motivo, ''), nullif(v_desc, ''), 'Precio acordado');
  elsif p_motivo is not null and p_motivo <> '' then
    v_desc := p_motivo;
  end if;

  v_total := v_precio + v_matricula;

  if p_monto_inicial is not null then
    v_cobrado := greatest(0, least(p_monto_inicial, v_total));
  else
    v_cobrado := v_total;
  end if;

  insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, matricula_pagada, promocion_id, monto_pagado)
  values (v_empresa, v_socio.sede_id, v_socio.id, p_plan_id, current_date, v_fin, 'activa', v_precio, v_matricula,
          case when v_promo.id is not null then v_promo.id else null end, v_cobrado);

  if v_cobrado > 0 then
    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
    values (v_empresa, v_socio.sede_id, 'ingreso', 'membresia',
            'Membresía ' || v_plan.nombre || ' · ' || v_socio.nombre ||
              case when v_matricula > 0 then ' (incluye matrícula)' else '' end ||
              case when v_desc <> '' then ' · ' || v_desc else '' end ||
              case when v_cobrado < v_total
                then ' · PAGO PARCIAL ' || trim(to_char(v_cobrado, 'FM999990.00')) || ' de ' || trim(to_char(v_total, 'FM999990.00'))
                else '' end,
            v_cobrado, coalesce(p_metodo_pago, 'efectivo'), 'socio', v_socio.id, auth.uid());
  end if;

  return jsonb_build_object(
    'socio_id', v_socio.id, 'codigo', v_socio.codigo, 'nombre', v_socio.nombre,
    'vence', v_fin, 'precio', v_precio, 'total', v_total,
    'total_cobrado', v_cobrado, 'saldo', v_total - v_cobrado,
    'nota', nullif(v_desc, ''));
end;
$$;

grant execute on function public.agregar_membresia_socio(uuid,uuid,text,uuid,numeric,numeric,text) to authenticated;
