-- ============================================================================
-- 68 · Ciclo de vida del moroso
--  1) Las membresías con fecha vencida pasan solas a estado 'vencida'
--     (pg_cron diario) — el socio ya no puede hacer check-in.
--  2) dar_baja_socio: cuando ya no responde y no volverá, se cierra su
--     membresía y el socio pasa a inactivo (sale de Cobros pendientes,
--     de los recordatorios y de los socios activos).
--  3) renew_membership también reactiva al socio si estaba de baja
--     (volvió después de meses: un solo botón lo revive todo).
-- ============================================================================

-- ── 1) Vencimiento automático ───────────────────────────────────────────────
create or replace function public.vencer_membresias()
returns void
language sql security definer
set search_path = public
as $$
  update public.membresia
     set estado = 'vencida'
   where estado = 'activa' and deleted_at is null
     and fecha_fin is not null and fecha_fin < current_date;
$$;

select cron.schedule('fitcontrol-vencer-membresias', '30 14 * * *', $$select public.vencer_membresias()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-vencer-membresias');

-- Pasada inicial para poner al día lo ya vencido
select public.vencer_membresias();

-- ── 2) Baja del socio que no volverá ────────────────────────────────────────
create or replace function public.dar_baja_socio(p_socio_id uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  update public.membresia
     set estado = 'vencida'
   where socio_id = p_socio_id and deleted_at is null
     and estado in ('activa', 'congelada');

  update public.socio set estado = 'inactivo'
   where id = p_socio_id and deleted_at is null;
end;
$$;

grant execute on function public.dar_baja_socio(uuid) to authenticated;

-- ── 3) Renovar también revive al socio dado de baja ─────────────────────────
create or replace function public.renew_membership(p_membresia_id uuid, p_metodo_pago text default 'efectivo')
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_m public.membresia;
  v_precio numeric(12,2);
  v_unidad text;
  v_nombre_plan text;
  v_nueva_fin date;
begin
  select * into v_m from public.membresia where id = p_membresia_id;
  if v_m.id is null then raise exception 'Membresía no encontrada o sin acceso'; end if;

  select precio, unidad, nombre into v_precio, v_unidad, v_nombre_plan from public.plan where id = v_m.plan_id;

  v_nueva_fin := greatest(v_m.fecha_fin, current_date) +
    case v_unidad
      when 'dia' then interval '1 day' when 'mes' then interval '1 month'
      when 'trimestre' then interval '3 months' when 'anual' then interval '1 year'
      else interval '1 month' end;

  update public.membresia
     set fecha_fin = v_nueva_fin, estado = 'activa', precio_pagado = v_precio
   where id = p_membresia_id;

  -- Si estaba de baja, vuelve a ser socio activo
  update public.socio set estado = 'activo'
   where id = v_m.socio_id and estado <> 'activo' and deleted_at is null;

  insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
  values (v_m.empresa_id, v_m.sede_id, 'ingreso', 'membresia',
          'Renovación ' || coalesce(v_nombre_plan, 'membresía'), v_precio,
          coalesce(p_metodo_pago, 'efectivo'), 'membresia', p_membresia_id, auth.uid());

  return jsonb_build_object('estado','activa','fecha_fin', v_nueva_fin, 'monto', v_precio);
end;
$$;

grant execute on function public.renew_membership(uuid, text) to authenticated;
