-- Permisos granulares: un usuario tiene los permisos de su ROL (mapa fijo) MÁS
-- los EXTRA que el admin le suma aquí. Solo suma, nunca quita. 4 permisos:
-- leads, caja, reportes, rutinas (solo 'leads' se cablea a lógica por ahora).
create table if not exists public.usuario_permiso (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  permiso    text not null check (permiso in ('leads','caja','reportes','rutinas')),
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id),
  unique (empresa_id, usuario_id, permiso)
);
alter table public.usuario_permiso enable row level security;
-- El admin de la empresa gestiona los extras; el usuario lee los suyos.
drop policy if exists usuario_permiso_admin on public.usuario_permiso;
create policy usuario_permiso_admin on public.usuario_permiso for all to authenticated
  using (public.auth_is_admin() and empresa_id = public.auth_empresa_id())
  with check (public.auth_is_admin() and empresa_id = public.auth_empresa_id());
drop policy if exists usuario_permiso_propio on public.usuario_permiso;
create policy usuario_permiso_propio on public.usuario_permiso for select to authenticated
  using (usuario_id = auth.uid());

-- ¿El usuario logueado tiene el permiso? admin siempre; o el rol base lo trae
-- (mapa FIJO); o tiene el extra en usuario_permiso. Único punto de verdad.
create or replace function public.auth_tiene_permiso(p_permiso text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_rol text;
begin
  if public.auth_is_admin() then return true; end if;  -- admin tiene todo
  v_rol := public.auth_rol();
  -- Mapa fijo rol -> permisos base.
  if (v_rol = 'recepcion'    and p_permiso = 'caja')
  or (v_rol = 'comunicador'  and p_permiso = 'leads')
  or (v_rol = 'entrenador'   and p_permiso = 'rutinas')
  or (v_rol = 'nutricionista' and p_permiso = 'rutinas') then
    return true;
  end if;
  -- Extra sumado por el admin.
  return exists (
    select 1 from public.usuario_permiso up
    where up.usuario_id = auth.uid()
      and up.empresa_id = public.auth_empresa_id()
      and up.permiso = p_permiso);
end $$;
revoke all on function public.auth_tiene_permiso(text) from public;
grant execute on function public.auth_tiene_permiso(text) to authenticated, service_role;
