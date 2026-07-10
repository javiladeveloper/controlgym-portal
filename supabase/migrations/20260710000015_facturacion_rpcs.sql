-- RPCs de configuración de facturación NORAC (API key cifrada).

-- Guarda la API key nrk_ cifrada (solo admin). Vacío = borrar credencial.
create or replace function public.guardar_facturacion_key(p_key text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_empresa uuid := public.auth_empresa_id(); v_cipher text;
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador configura la facturación';
  end if;
  select valor into v_cipher from privado.secreto where clave = 'fact_cipher_key';
  insert into public.empresa_facturacion (empresa_id, proveedor_token, actualizado_at)
  values (
    v_empresa,
    case when coalesce(p_key,'') = '' then null
         else encode(pgp_sym_encrypt(p_key, v_cipher), 'base64') end,
    now())
  on conflict (empresa_id) do update set
    proveedor_token = case when coalesce(p_key,'') = '' then null
                          else encode(pgp_sym_encrypt(p_key, v_cipher), 'base64') end,
    actualizado_at = now();
end;
$function$;
grant execute on function public.guardar_facturacion_key(text) to authenticated;

-- Reemplaza guardar_facturacion con los campos nuevos (proveedor fijo 'norac').
drop function if exists public.guardar_facturacion(boolean, text, text, text, text, text);
create or replace function public.guardar_facturacion(
  p_activo boolean,
  p_ruc text default null,
  p_razon_social text default null,
  p_serie_boleta text default null,
  p_serie_factura text default null,
  p_correlativo_inicial int default null,
  p_proveedor_url text default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador configura la facturación';
  end if;
  insert into public.empresa_facturacion
    (empresa_id, activo, proveedor, ruc, razon_social, serie_boleta, serie_factura,
     correlativo_inicial, proveedor_url, actualizado_at)
  values (v_empresa, p_activo, 'norac', p_ruc, p_razon_social,
          coalesce(p_serie_boleta,'B001'), coalesce(p_serie_factura,'F001'),
          p_correlativo_inicial,
          coalesce(p_proveedor_url, 'https://norac-facturacion.onrender.com'), now())
  on conflict (empresa_id) do update set
    activo = excluded.activo,
    proveedor = 'norac',
    ruc = coalesce(excluded.ruc, empresa_facturacion.ruc),
    razon_social = coalesce(excluded.razon_social, empresa_facturacion.razon_social),
    serie_boleta = excluded.serie_boleta,
    serie_factura = excluded.serie_factura,
    correlativo_inicial = coalesce(excluded.correlativo_inicial, empresa_facturacion.correlativo_inicial),
    proveedor_url = coalesce(excluded.proveedor_url, empresa_facturacion.proveedor_url),
    actualizado_at = now();
end;
$function$;
grant execute on function public.guardar_facturacion(boolean, text, text, text, text, int, text) to authenticated;

-- Estado no-secreto para el panel (agrega proveedor_url y correlativo_inicial).
create or replace function public.estado_facturacion()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_empresa uuid := public.auth_empresa_id(); v_fila public.empresa_facturacion;
begin
  if v_empresa is null or not public.auth_is_admin() then
    return jsonb_build_object('activo', false, 'motivo', 'solo_admin');
  end if;
  select * into v_fila from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fila.empresa_id is null then return jsonb_build_object('activo', false, 'configurado', false); end if;
  return jsonb_build_object(
    'activo', v_fila.activo, 'configurado', true,
    'ruc', v_fila.ruc, 'razon_social', v_fila.razon_social,
    'serie_boleta', v_fila.serie_boleta, 'serie_factura', v_fila.serie_factura,
    'correlativo_inicial', v_fila.correlativo_inicial,
    'proveedor_url', v_fila.proveedor_url,
    'tiene_credenciales', v_fila.proveedor_token is not null
  );
end;
$function$;
grant execute on function public.estado_facturacion() to authenticated;

-- SOLO BACKEND (DATABASE_URL, no expuesta a authenticated): descifra la key.
create or replace function public.facturacion_credenciales(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_fila public.empresa_facturacion; v_cipher text; v_key text;
begin
  select * into v_fila from public.empresa_facturacion where empresa_id = p_empresa;
  if v_fila.empresa_id is null or not v_fila.activo or v_fila.proveedor_token is null then
    return jsonb_build_object('ok', false);
  end if;
  select valor into v_cipher from privado.secreto where clave = 'fact_cipher_key';
  v_key := pgp_sym_decrypt(decode(v_fila.proveedor_token, 'base64'), v_cipher);
  return jsonb_build_object(
    'ok', true, 'api_key', v_key, 'url', v_fila.proveedor_url,
    'ruc', v_fila.ruc, 'razon_social', v_fila.razon_social,
    'serie_boleta', v_fila.serie_boleta, 'serie_factura', v_fila.serie_factura);
end;
$function$;
-- NO grant a authenticated: solo el backend la llama por conexión postgres directa.
revoke all on function public.facturacion_credenciales(uuid) from public, anon, authenticated;
