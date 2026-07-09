-- PEDIDO 15 Fase 1.c — Andamiaje de facturación electrónica (SEE/SUNAT).
--
-- Deja TODA la arquitectura lista para emitir boleta/factura cuando un pago por
-- app se aprueba, PERO sin acoplarse a un proveedor todavía. Cuando el owner
-- elija proveedor (Nubefact/Efact/etc.), solo se enchufa la llamada HTTP en el
-- webhook (el único punto marcado). Aquí definimos: config por gym, estado del
-- comprobante en pago_app, y una función que decide SI se debe facturar.

-- 1. Config de facturación por gimnasio. Cada gym factura con SU RUC/serie y SUS
--    credenciales de proveedor (secretas → RLS cerrado, solo backend las lee,
--    igual patrón que empresa_mp).
create table if not exists public.empresa_facturacion (
  empresa_id      uuid primary key references public.empresa(id) on delete cascade,
  activo          boolean not null default false,   -- ¿este gym emite comprobantes?
  proveedor       text,                              -- 'nubefact' | 'efact' | ... (null hasta elegir)
  ruc             text,                              -- RUC emisor del gym
  razon_social    text,
  serie_boleta    text default 'B001',
  serie_factura   text default 'F001',
  correlativo_boleta  bigint not null default 0,     -- último número emitido (fallback local)
  correlativo_factura bigint not null default 0,
  -- Credenciales del proveedor (secretas). RLS cerrado: nadie las lee vía API.
  proveedor_token   text,
  proveedor_url     text,
  igv_incluido    boolean not null default true,     -- si el precio ya incluye IGV (Perú: sí, 18%)
  creado_at       timestamptz not null default now(),
  actualizado_at  timestamptz not null default now()
);

-- RLS cerrado para authenticated (como empresa_mp): las credenciales solo las
-- lee el backend por conexión directa. El panel gestiona la config vía RPC.
alter table public.empresa_facturacion enable row level security;
-- (sin policies para authenticated → nadie lee la tabla por PostgREST)

-- 2. Estado del comprobante en el pago (además de comprobante_url que ya existe).
alter table public.pago_app
  add column if not exists comprobante_estado text not null default 'no_emitido';
-- valores: 'no_emitido' | 'emitido' | 'error' | 'no_aplica'
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pago_app_comprobante_estado_check') then
    alter table public.pago_app add constraint pago_app_comprobante_estado_check
      check (comprobante_estado in ('no_emitido', 'emitido', 'error', 'no_aplica'));
  end if;
end $$;

alter table public.pago_app
  add column if not exists comprobante_serie   text,
  add column if not exists comprobante_numero  bigint,
  add column if not exists comprobante_error   text;

-- 3. RPC que el panel usa para configurar la facturación del gym (solo admin).
--    Devuelve/guarda solo lo NO secreto; las credenciales se setean aparte.
create or replace function public.guardar_facturacion(
  p_activo        boolean,
  p_proveedor     text default null,
  p_ruc           text default null,
  p_razon_social  text default null,
  p_serie_boleta  text default null,
  p_serie_factura text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador configura la facturación';
  end if;
  insert into public.empresa_facturacion (empresa_id, activo, proveedor, ruc, razon_social, serie_boleta, serie_factura, actualizado_at)
  values (v_empresa, p_activo, p_proveedor, p_ruc, p_razon_social,
          coalesce(p_serie_boleta, 'B001'), coalesce(p_serie_factura, 'F001'), now())
  on conflict (empresa_id) do update set
    activo = excluded.activo,
    proveedor = coalesce(excluded.proveedor, empresa_facturacion.proveedor),
    ruc = coalesce(excluded.ruc, empresa_facturacion.ruc),
    razon_social = coalesce(excluded.razon_social, empresa_facturacion.razon_social),
    serie_boleta = excluded.serie_boleta,
    serie_factura = excluded.serie_factura,
    actualizado_at = now();
end;
$function$;

grant execute on function public.guardar_facturacion(boolean, text, text, text, text, text) to authenticated;

-- Estado de facturación (no secreto) para el panel.
create or replace function public.estado_facturacion()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_empresa uuid := public.auth_empresa_id(); v_fila public.empresa_facturacion;
begin
  if v_empresa is null or not public.auth_is_admin() then
    return jsonb_build_object('activo', false, 'motivo', 'solo_admin');
  end if;
  select * into v_fila from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fila.empresa_id is null then return jsonb_build_object('activo', false, 'configurado', false); end if;
  return jsonb_build_object(
    'activo', v_fila.activo, 'configurado', true,
    'proveedor', v_fila.proveedor, 'ruc', v_fila.ruc, 'razon_social', v_fila.razon_social,
    'serie_boleta', v_fila.serie_boleta, 'serie_factura', v_fila.serie_factura,
    'tiene_credenciales', v_fila.proveedor_token is not null
  );
end;
$function$;

grant execute on function public.estado_facturacion() to authenticated;

-- 4. Decide si un pago DEBE facturarse y prepara los datos. NO llama al proveedor
--    (eso es HTTP, va en el webhook). Marca el pago como 'no_aplica' si el gym no
--    factura, o devuelve los datos para emitir si sí. Idempotente.
create or replace function public.preparar_comprobante(p_pago_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pago public.pago_app;
  v_fac  public.empresa_facturacion;
begin
  select * into v_pago from public.pago_app where id = p_pago_id;
  if v_pago.id is null then return jsonb_build_object('emitir', false, 'motivo', 'pago_inexistente'); end if;

  -- Ya emitido o marcado: no repetir.
  if v_pago.comprobante_estado in ('emitido', 'no_aplica') then
    return jsonb_build_object('emitir', false, 'motivo', 'ya_procesado');
  end if;

  select * into v_fac from public.empresa_facturacion where empresa_id = v_pago.empresa_id;

  -- El gym no factura (sin config o desactivado) → marca no_aplica y termina.
  if v_fac.empresa_id is null or not v_fac.activo or v_fac.proveedor is null then
    update public.pago_app set comprobante_estado = 'no_aplica' where id = p_pago_id;
    return jsonb_build_object('emitir', false, 'motivo', 'gym_no_factura');
  end if;

  -- Sí factura: devolvemos lo necesario para que el webhook llame al proveedor.
  -- (Sin documento del cliente → boleta; con RUC del cliente → factura; aquí
  --  simplificamos a boleta, el proveedor real decidirá con los datos del socio.)
  return jsonb_build_object(
    'emitir', true,
    'proveedor', v_fac.proveedor,
    'ruc_emisor', v_fac.ruc,
    'razon_social_emisor', v_fac.razon_social,
    'serie', v_fac.serie_boleta,
    'monto', v_pago.monto,
    'igv_incluido', v_fac.igv_incluido,
    'concepto', v_pago.concepto,
    'cliente_nombre', coalesce(v_pago.nuevo_nombre, ''),
    'cliente_doc', coalesce(v_pago.nuevo_documento, '')
  );
end;
$function$;

grant execute on function public.preparar_comprobante(uuid) to authenticated;

comment on table public.empresa_facturacion is
  'Config de facturación electrónica (SEE) por gym. Credenciales secretas → RLS cerrado (solo backend). PEDIDO 15 Fase 1.c (andamiaje; falta enchufar proveedor).';
comment on function public.preparar_comprobante is
  'Decide si un pago debe facturarse y prepara los datos. NO llama al proveedor (eso es HTTP en el webhook). Idempotente. Marca no_aplica si el gym no factura.';
