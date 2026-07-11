-- POS: cobra/renueva una membresía y crea el comprobante por el monto cobrado.
-- Reusa renew_membership (que ya registra caja y maneja abono parcial).
create or replace function public.cobrar_membresia_pos(
  p_membresia_id uuid,
  p_metodo_pago text default 'efectivo',
  p_monto numeric default null,
  p_cliente_tipo_doc text default '0',
  p_cliente_num_doc text default null,
  p_cliente_nombre text default 'CLIENTE VARIOS',
  p_cliente_email text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_res jsonb;
  v_cobrado numeric;
  v_comp uuid;
  v_base numeric; v_igv numeric;
  v_fac public.empresa_facturacion;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  -- renew_membership devuelve jsonb: {estado, fecha_fin, precio, pagado, saldo}
  v_res := public.renew_membership(p_membresia_id, p_metodo_pago, null, p_monto);
  v_cobrado := coalesce((v_res->>'pagado')::numeric, p_monto);
  if v_cobrado is null or v_cobrado <= 0 then
    return jsonb_build_object('cobrado', 0, 'comprobante_id', null);
  end if;

  select * into v_fac from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fac.empresa_id is not null and v_fac.activo then
    v_base := round(v_cobrado / 1.18, 2);
    v_igv := v_cobrado - v_base;
    insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, tipo,
      cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_email, base, igv, total)
    values (v_empresa, 'membresia', 'membresia', p_membresia_id,
      case when p_cliente_tipo_doc = '6' then '01' else '03' end,
      p_cliente_tipo_doc, nullif(p_cliente_num_doc,''),
      coalesce(nullif(p_cliente_nombre,''),'CLIENTE VARIOS'),
      nullif(p_cliente_email,''), v_base, v_igv, v_cobrado)
    on conflict (ref_tipo, ref_id) where estado <> 'anulado' do nothing
    returning id into v_comp;
  end if;

  return jsonb_build_object('cobrado', v_cobrado, 'comprobante_id', v_comp, 'renovacion', v_res);
end;
$function$;
grant execute on function public.cobrar_membresia_pos(uuid, text, numeric, text, text, text, text) to authenticated;
