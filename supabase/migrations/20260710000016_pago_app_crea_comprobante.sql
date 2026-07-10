-- Crea un comprobante 'pendiente' a partir de un pago_app aprobado. Idempotente.
create or replace function public.crear_comprobante_pago_app(p_pago_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_pago public.pago_app; v_fac public.empresa_facturacion; v_id uuid; v_base numeric; v_igv numeric;
begin
  select * into v_pago from public.pago_app where id = p_pago_id;
  if v_pago.id is null or v_pago.estado_pago <> 'aprobado' then return null; end if;
  select * into v_fac from public.empresa_facturacion where empresa_id = v_pago.empresa_id;
  if v_fac.empresa_id is null or not v_fac.activo then return null; end if;

  -- Idempotente: si ya hay comprobante vivo para este pago, devuélvelo.
  select id into v_id from public.comprobante
    where ref_tipo = 'pago_app' and ref_id = p_pago_id and estado <> 'anulado';
  if v_id is not null then return v_id; end if;

  v_base := round(v_pago.monto / 1.18, 2);
  v_igv  := v_pago.monto - v_base;
  insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, tipo,
    cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_email, base, igv, total)
  values (v_pago.empresa_id, 'pago_app', 'pago_app', p_pago_id, '03',
    case when coalesce(v_pago.nuevo_documento,'') = '' then '0' else '1' end,
    nullif(v_pago.nuevo_documento, ''),
    coalesce(nullif(v_pago.nuevo_nombre,''), 'CLIENTE VARIOS'),
    nullif(v_pago.nuevo_email,''), v_base, v_igv, v_pago.monto)
  returning id into v_id;
  update public.pago_app set comprobante_estado = 'emitido' where id = p_pago_id;
  return v_id;
end;
$function$;
grant execute on function public.crear_comprobante_pago_app(uuid) to authenticated;
revoke all on function public.crear_comprobante_pago_app(uuid) from anon;
