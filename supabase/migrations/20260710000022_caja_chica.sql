-- Caja chica: detalle del arqueo por denominaciones + gastos de caja validados.

-- Detalle del conteo de billetes/monedas al cierre (para el reporte histórico).
alter table public.caja
  add column if not exists arqueo_detalle jsonb;

-- Gasto/egreso de caja chica (agua, taxi, compras menores). Validaciones que el
-- frontend no puede garantizar: monto > 0, motivo presente y caja del día abierta.
create or replace function public.registrar_gasto_caja(
  p_sede_id uuid,
  p_monto numeric,
  p_motivo text,
  p_metodo_pago text default 'efectivo'
) returns uuid
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_caja public.caja;
  v_id uuid;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a 0'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del gasto'; end if;

  -- Debe haber una caja ABIERTA en esa sede. Se busca por estado, NO por
  -- fecha=current_date: el servidor corre en UTC y desde las 7pm hora Perú
  -- (UTC-5) current_date ya es "mañana", mientras el panel abre la caja con la
  -- fecha local — comparar fechas rechazaría gastos toda la tarde-noche.
  select * into v_caja from public.caja
    where sede_id = p_sede_id and empresa_id = v_empresa and estado = 'abierta'
    order by fecha desc limit 1;
  if v_caja.id is null then
    raise exception 'Abre la caja del día antes de registrar un gasto';
  end if;

  insert into public.movimiento_financiero
    (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, caja_id, registrado_por)
  values
    (v_empresa, p_sede_id, 'gasto', 'caja_chica', trim(p_motivo), p_monto,
     coalesce(p_metodo_pago, 'efectivo'), v_caja.id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function public.registrar_gasto_caja(uuid, numeric, text, text) to authenticated;

comment on function public.registrar_gasto_caja is
  'Gasto de caja chica: valida monto>0, motivo y caja del día abierta. Descuenta del efectivo esperado (vía el cálculo del panel que suma gastos en efectivo).';
