-- ============================================================================
-- 05 · Funciones de contexto para RLS + hook de JWT + cambio de empresa activa
--
-- Multi-empresa: el JWT lleva la empresa ACTIVA (empresa_id) y el rol en esa
-- empresa. El usuario cambia de empresa activa con set_empresa_activa() (marca
-- es_default); el nuevo claim se aplica al refrescar el token.
-- ============================================================================

-- ── Empresa activa del usuario actual (desde el claim del JWT) ───────────────
create or replace function public.auth_empresa_id()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'empresa_id',
      current_setting('request.jwt.claims', true)::jsonb ->> 'empresa_id'
    ),
    ''
  )::uuid;
$$;

comment on function public.auth_empresa_id() is 'Empresa activa del usuario actual, leída del claim del JWT.';

-- ── Rol del usuario en la empresa activa ────────────────────────────────────
create or replace function public.auth_rol()
returns text
language sql stable
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'rol',
    current_setting('request.jwt.claims', true)::jsonb ->> 'rol'
  );
$$;

create or replace function public.auth_is_admin()
returns boolean
language sql stable
as $$
  select public.auth_rol() = 'admin';
$$;

-- ── Sedes visibles para el usuario actual en su empresa activa ──────────────
-- Regla: si la empresa permite staff_multisede O el rol es admin => todas las
-- sedes de la empresa; si no => solo las de usuario_sede.
create or replace function public.auth_sede_ids()
returns setof uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_multisede boolean;
begin
  if v_empresa is null then
    return;
  end if;

  select e.staff_multisede into v_multisede
  from public.empresa e where e.id = v_empresa;

  if coalesce(v_multisede, false) or public.auth_is_admin() then
    return query select s.id from public.sede s where s.empresa_id = v_empresa;
  else
    return query
      select us.sede_id
      from public.usuario_sede us
      where us.empresa_id = v_empresa
        and us.usuario_id = auth.uid();
  end if;
end;
$$;

comment on function public.auth_sede_ids() is
  'Sedes visibles para el usuario actual: todas si multisede/admin, si no las de usuario_sede.';

-- ── Cambiar la empresa activa (marca es_default) ────────────────────────────
create or replace function public.set_empresa_activa(p_empresa_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  -- Verifica que el usuario pertenece a esa empresa
  if not exists (
    select 1 from public.usuario_empresa
    where usuario_id = auth.uid() and empresa_id = p_empresa_id and activo
  ) then
    raise exception 'No perteneces a esa empresa o está inactiva';
  end if;

  update public.usuario_empresa
     set es_default = (empresa_id = p_empresa_id)
   where usuario_id = auth.uid();
end;
$$;

comment on function public.set_empresa_activa(uuid) is
  'Cambia la empresa activa del usuario (es_default). El nuevo empresa_id/rol entra al refrescar el token.';

-- ── Hook de custom access token: inyecta empresa_id + rol en el JWT ─────────
-- Se registra en Supabase Auth (config.toml / dashboard). Toma la empresa
-- default del usuario y su rol en esa empresa.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = public
as $$
declare
  v_claims jsonb := coalesce(event->'claims', '{}'::jsonb);
  v_meta   jsonb := coalesce(v_claims->'app_metadata', '{}'::jsonb);
  v_uid    uuid  := (event->>'user_id')::uuid;
  v_empresa uuid;
  v_rol     text;
begin
  select ue.empresa_id, r.codigo
    into v_empresa, v_rol
  from public.usuario_empresa ue
  join public.rol r on r.id = ue.rol_id
  where ue.usuario_id = v_uid and ue.activo
  order by ue.es_default desc, ue.created_at asc
  limit 1;

  if v_empresa is not null then
    v_meta := v_meta || jsonb_build_object('empresa_id', v_empresa, 'rol', v_rol);
    v_claims := jsonb_set(v_claims, '{app_metadata}', v_meta);
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Auth hook: añade empresa_id (activa) y rol al JWT. Registrar en Supabase Auth Hooks.';

-- Permisos para el rol de auth que ejecuta el hook
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.usuario_empresa, public.rol to supabase_auth_admin;
