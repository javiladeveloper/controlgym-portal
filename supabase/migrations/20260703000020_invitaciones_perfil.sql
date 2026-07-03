-- ============================================================================
-- 20 · Invitaciones + auto-creación de perfil (login con Google/OAuth)
--
-- Flujo: un Admin invita un email a su empresa con un rol. Cuando esa persona
-- entra por primera vez con Google, un trigger sobre auth.users:
--   1) crea su fila en public.usuario (perfil),
--   2) si su email tiene invitaciones pendientes, lo vincula a esas empresas.
-- ============================================================================

-- ── Invitaciones ────────────────────────────────────────────────────────────
create table public.invitacion (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,   -- TENANT
  email      citext not null,
  rol_id     uuid not null references public.rol(id),
  sede_id    uuid references public.sede(id),          -- sede inicial (opcional)
  estado     text not null default 'pendiente' check (estado in ('pendiente','aceptada','revocada')),
  invitado_por uuid references public.usuario(id),
  created_at timestamptz not null default now(),
  aceptada_at timestamptz,
  unique (empresa_id, email)
);

create index idx_invitacion_email on public.invitacion(email) where estado = 'pendiente';
create index idx_invitacion_empresa on public.invitacion(empresa_id);

comment on table public.invitacion is
  'Pre-autorización de un email para unirse a una empresa con un rol. Se consume al primer login.';

alter table public.invitacion enable row level security;
create policy "invitacion_scope" on public.invitacion
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

-- ── Trigger: al crear un usuario en auth, crear perfil y consumir invitaciones ─
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_iniciales text;
  inv record;
begin
  -- Nombre desde los metadatos de Google (full_name/name) o el email
  v_nombre := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(new.email, '@', 1)
  );
  v_iniciales := upper(left(regexp_replace(v_nombre, '[^A-Za-zÁÉÍÓÚÑáéíóúñ ]', '', 'g'), 1));
  -- segunda inicial si hay apellido
  if position(' ' in v_nombre) > 0 then
    v_iniciales := v_iniciales || upper(substr(split_part(v_nombre, ' ', 2), 1, 1));
  end if;

  insert into public.usuario (id, nombre, email, avatar_iniciales, activo)
  values (new.id, v_nombre, new.email, v_iniciales, true)
  on conflict (id) do nothing;

  -- Consumir invitaciones pendientes para este email
  for inv in
    select * from public.invitacion where email = new.email and estado = 'pendiente'
  loop
    insert into public.usuario_empresa (usuario_id, empresa_id, rol_id, es_default, activo)
    values (new.id, inv.empresa_id, inv.rol_id, false, true)
    on conflict (usuario_id, empresa_id) do nothing;

    if inv.sede_id is not null then
      insert into public.usuario_sede (usuario_id, empresa_id, sede_id)
      values (new.id, inv.empresa_id, inv.sede_id)
      on conflict do nothing;
    end if;

    update public.invitacion set estado = 'aceptada', aceptada_at = now() where id = inv.id;
  end loop;

  -- Marcar una empresa como default si el usuario quedó con exactamente una
  update public.usuario_empresa ue
     set es_default = true
   where ue.usuario_id = new.id
     and (select count(*) from public.usuario_empresa where usuario_id = new.id) = 1;

  return new;
end;
$$;

drop trigger if exists trg_new_auth_user on auth.users;
create trigger trg_new_auth_user
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

comment on function public.handle_new_auth_user() is
  'Al primer login (Google/email): crea el perfil public.usuario y consume invitaciones pendientes.';

-- ── RPC: invitar a un colaborador (para el módulo Personal) ─────────────────
create or replace function public.invitar_colaborador(p_email text, p_rol_codigo text, p_sede_id uuid default null)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_rol uuid;
  v_id uuid;
begin
  if not public.auth_is_admin() then
    raise exception 'Solo un administrador puede invitar colaboradores';
  end if;
  select id into v_rol from public.rol
   where codigo = p_rol_codigo and (empresa_id is null or empresa_id = v_empresa)
   order by empresa_id nulls last limit 1;
  if v_rol is null then raise exception 'Rol % no existe', p_rol_codigo; end if;

  insert into public.invitacion (empresa_id, email, rol_id, sede_id, invitado_por)
  values (v_empresa, p_email, v_rol, p_sede_id, auth.uid())
  on conflict (empresa_id, email) do update set rol_id = excluded.rol_id, estado = 'pendiente'
  returning id into v_id;

  -- Si el usuario ya existe (ya se logueó antes), vincularlo de una vez
  update public.invitacion set estado = 'aceptada', aceptada_at = now()
   where id = v_id and exists (select 1 from public.usuario u where u.email = p_email);
  insert into public.usuario_empresa (usuario_id, empresa_id, rol_id, activo)
  select u.id, v_empresa, v_rol, true from public.usuario u where u.email = p_email
  on conflict (usuario_id, empresa_id) do nothing;

  return v_id;
end;
$$;

grant execute on function public.invitar_colaborador(text, text, uuid) to authenticated;
