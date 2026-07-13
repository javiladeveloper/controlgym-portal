-- Leadia (bot IA) como ADD-ON por sede: billing de 3 tiers + credenciales del
-- tenant de Leadia cifradas por sede. La app móvil consume /api/chat de Leadia;
-- este panel VENDE el add-on, aprovisiona el tenant y guarda su api_key.
-- Patrón de cifrado: igual que NORAC (pgp_sym_encrypt + llave maestra en
-- privado.secreto). El gym nunca ve la api_key ni la admin key de plataforma.

-- ── A1. Add-on de 3 tiers en suscripcion_sede ──────────────────────────────
alter table public.suscripcion_sede add column if not exists leadia_tier text
  check (leadia_tier in ('basica','pro','full'));   -- null = sin add-on
alter table public.suscripcion_sede add column if not exists leadia_estado text
  check (leadia_estado in ('activa','vencida','cancelada'));

-- Precio del add-on por tier (espejo de precio_plan). Soles/mes.
create or replace function public.precio_leadia(p_tier text)
returns numeric language sql immutable set search_path = public as $$
  select case p_tier when 'basica' then 39 when 'pro' then 69 when 'full' then 119 else 0 end::numeric
$$;

-- Conversaciones/mes incluidas por tier (informativo para el panel).
create or replace function public.conversaciones_leadia(p_tier text)
returns int language sql immutable set search_path = public as $$
  select case p_tier when 'basica' then 400 when 'pro' then 800 when 'full' then 1600 else 0 end
$$;

-- ── A2. Credenciales de Leadia por sede (cifradas, patrón NORAC) ────────────
create table if not exists public.sede_leadia (
  sede_id uuid primary key references public.sede(id) on delete cascade,
  empresa_id uuid not null references public.empresa(id),
  tenant_id text,                 -- id del tenant en Leadia
  api_key_cifrada text,           -- pgp_sym_encrypt(base64) de la api_key del tenant
  flujo_id text,                  -- id del flujo (árbol) en Leadia
  activo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- RLS CERRADO: sin policy de SELECT para authenticated → nadie lee la key por
-- PostgREST; solo el backend (conexión directa service_role) la descifra.
alter table public.sede_leadia enable row level security;

-- Guardar credenciales (lo llama la serverless tras aprovisionar en Leadia).
-- security definer, solo backend/admin — cifra con la llave maestra.
create or replace function public.guardar_leadia_credenciales(
  p_sede_id uuid, p_empresa_id uuid, p_tenant_id text, p_api_key text, p_flujo_id text default null
) returns void language plpgsql security definer set search_path = public, privado, extensions as $$
declare v_cipher text;
begin
  select valor into v_cipher from privado.secreto where clave = 'leadia_cipher_key';
  if v_cipher is null then raise exception 'Falta leadia_cipher_key'; end if;
  insert into public.sede_leadia (sede_id, empresa_id, tenant_id, api_key_cifrada, flujo_id, activo)
  values (p_sede_id, p_empresa_id, p_tenant_id,
          encode(pgp_sym_encrypt(p_api_key, v_cipher), 'base64'), p_flujo_id, true)
  on conflict (sede_id) do update
    set tenant_id = excluded.tenant_id,
        api_key_cifrada = excluded.api_key_cifrada,
        flujo_id = coalesce(excluded.flujo_id, public.sede_leadia.flujo_id),
        activo = true, updated_at = now();
end $$;
revoke all on function public.guardar_leadia_credenciales(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.guardar_leadia_credenciales(uuid, uuid, text, text, text) to service_role;

-- Descifrar (solo backend): devuelve tenant_id + api_key para llamar a Leadia.
create or replace function public.leadia_credenciales(p_sede_id uuid)
returns jsonb language plpgsql security definer set search_path = public, privado, extensions as $$
declare v_cipher text; v_row public.sede_leadia;
begin
  select valor into v_cipher from privado.secreto where clave = 'leadia_cipher_key';
  select * into v_row from public.sede_leadia where sede_id = p_sede_id and activo;
  if v_row.sede_id is null or v_row.api_key_cifrada is null then
    return jsonb_build_object('encontrado', false);
  end if;
  return jsonb_build_object(
    'encontrado', true,
    'tenant_id', v_row.tenant_id,
    'flujo_id', v_row.flujo_id,
    'api_key', pgp_sym_decrypt(decode(v_row.api_key_cifrada, 'base64'), v_cipher)
  );
end $$;
revoke all on function public.leadia_credenciales(uuid) from public, anon, authenticated;
grant execute on function public.leadia_credenciales(uuid) to service_role;

-- Estado para el PANEL (sin exponer la key): activo, tier, si ya tiene tenant.
create or replace function public.estado_leadia_sede(p_sede_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_row public.sede_leadia; v_tier text; v_estado text;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not exists (select 1 from public.sede where id = p_sede_id and empresa_id = v_emp) then
    raise exception 'Sede no encontrada o sin acceso';
  end if;
  select * into v_row from public.sede_leadia where sede_id = p_sede_id;
  select leadia_tier, leadia_estado into v_tier, v_estado from public.suscripcion_sede where sede_id = p_sede_id;
  return jsonb_build_object(
    'activo', coalesce(v_row.activo, false),
    'tier', v_tier,
    'estado', v_estado,
    'tiene_credenciales', v_row.tenant_id is not null,
    'flujo_id', v_row.flujo_id,
    'monto', public.precio_leadia(v_tier),
    'conversaciones', public.conversaciones_leadia(v_tier)
  );
end $$;
revoke all on function public.estado_leadia_sede(uuid) from public, anon;
grant execute on function public.estado_leadia_sede(uuid) to authenticated, service_role;

-- ── A3. suscripciones_mis_sedes: incluir el add-on Leadia para la card ──────
create or replace function public.suscripciones_mis_sedes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sede_id', s.id, 'sede_nombre', s.nombre,
      'tiene_fila', ss.id is not null,
      'plan_slug', coalesce(ss.plan_slug, e.plan_slug),
      'con_app', coalesce(ss.con_app, e.plan_con_app, false),
      'estado', coalesce(ss.estado, (select estado from public.suscripcion_plataforma where empresa_id = v_emp), 'prueba'),
      'monto', case when ss.monto_override then ss.monto
                    else public.precio_plan(coalesce(ss.plan_slug, e.plan_slug), coalesce(ss.con_app, e.plan_con_app, false)) end,
      'monto_override', coalesce(ss.monto_override, false),
      'trial_hasta', ss.trial_hasta, 'proximo_cobro', ss.proximo_cobro,
      -- add-on Leadia
      'leadia_tier', ss.leadia_tier,
      'leadia_estado', ss.leadia_estado,
      'leadia_monto', public.precio_leadia(ss.leadia_tier)
    ) order by s.created_at)
    from public.sede s
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where s.empresa_id = v_emp and s.deleted_at is null and s.activa
  ), '[]'::jsonb);
end $$;
revoke all on function public.suscripciones_mis_sedes() from public, anon;
grant execute on function public.suscripciones_mis_sedes() to authenticated, service_role;

-- ── Marcar el tier del add-on (lo llama la serverless al aprovisionar) ──────
create or replace function public.set_leadia_tier(p_sede_id uuid, p_tier text)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from public.sede where id = p_sede_id;
  if v_emp is null then raise exception 'Sede no encontrada'; end if;
  -- asegurar fila de suscripcion_sede (hereda del plan de empresa si no existía)
  insert into public.suscripcion_sede (empresa_id, sede_id, plan_slug, estado)
  select v_emp, p_sede_id, e.plan_slug, 'prueba' from public.empresa e where e.id = v_emp
  on conflict (sede_id) do nothing;
  update public.suscripcion_sede
    set leadia_tier = p_tier, leadia_estado = 'activa', updated_at = now()
    where sede_id = p_sede_id;
end $$;
revoke all on function public.set_leadia_tier(uuid, text) from public, anon, authenticated;
grant execute on function public.set_leadia_tier(uuid, text) to service_role;

-- Llave maestra de cifrado de Leadia + admin key de plataforma (placeholders;
-- el owner las setea de verdad por SQL). Se generan si no existen.
insert into privado.secreto (clave, valor)
select 'leadia_cipher_key', encode(gen_random_bytes(32), 'hex')
where not exists (select 1 from privado.secreto where clave = 'leadia_cipher_key');
insert into privado.secreto (clave, valor)
select 'leadia_admin_key', 'CONFIGURAR_ADMIN_KEY_DE_LEADIA'
where not exists (select 1 from privado.secreto where clave = 'leadia_admin_key');
insert into privado.secreto (clave, valor)
select 'leadia_api_base', 'https://api.leadai-pe.com'
where not exists (select 1 from privado.secreto where clave = 'leadia_api_base');
