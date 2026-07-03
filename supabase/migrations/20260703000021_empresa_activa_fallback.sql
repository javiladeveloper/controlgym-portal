-- ============================================================================
-- 21 · auth_empresa_id() robusto: funciona CON o SIN el hook de JWT
--
-- Estrategia:
--   1) Si el JWT trae empresa_id (hook activo) → se usa (rápido, sin query).
--   2) Si no → se deriva de usuario_empresa: la empresa es_default del usuario
--      (o la primera activa). Así el sistema funciona sin configurar el hook.
--
-- auth_rol() aplica la misma lógica para el rol.
-- ============================================================================

create or replace function public.auth_empresa_id()
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_claim text;
  v_empresa uuid;
begin
  -- 1) intentar el claim del JWT (si el hook está activo)
  v_claim := coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'empresa_id',
    current_setting('request.jwt.claims', true)::jsonb ->> 'empresa_id'
  );
  if v_claim is not null and v_claim <> '' then
    return v_claim::uuid;
  end if;

  -- 2) fallback: empresa default (o primera activa) del usuario en usuario_empresa
  select ue.empresa_id into v_empresa
  from public.usuario_empresa ue
  where ue.usuario_id = auth.uid() and ue.activo
  order by ue.es_default desc, ue.created_at asc
  limit 1;

  return v_empresa;
end;
$$;

create or replace function public.auth_rol()
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_claim text;
  v_rol text;
begin
  v_claim := coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'rol',
    current_setting('request.jwt.claims', true)::jsonb ->> 'rol'
  );
  if v_claim is not null and v_claim <> '' then
    return v_claim;
  end if;

  select r.codigo into v_rol
  from public.usuario_empresa ue
  join public.rol r on r.id = ue.rol_id
  where ue.usuario_id = auth.uid() and ue.activo
  order by ue.es_default desc, ue.created_at asc
  limit 1;

  return v_rol;
end;
$$;

-- Nota: al ser SECURITY DEFINER y consultar usuario_empresa por auth.uid(), el
-- fallback no depende de RLS (evita recursión) y es tan seguro como el claim.
