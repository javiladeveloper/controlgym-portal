-- ============================================================================
-- 04 · Auth / staff multi-empresa
--   Un usuario puede pertenecer a VARIAS empresas (usuario_empresa).
--   · usuario         : perfil de app, 1:1 con auth.users
--   · rol             : roles (de sistema o custom por empresa)
--   · usuario_empresa : membership usuario ↔ empresa (+ rol + es_default)
--   · usuario_sede    : sedes permitidas al staff dentro de una empresa
--   · empresa_modulo  : feature flags efectivos de módulos por empresa
-- ============================================================================

-- ── Roles ───────────────────────────────────────────────────────────────────
create table public.rol (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresa(id) on delete cascade,  -- NULL = rol de sistema
  codigo     text not null,        -- 'admin','recepcion','entrenador','nutricionista','mantenimiento'
  nombre     text not null,
  es_sistema boolean not null default false,
  created_at timestamptz not null default now(),
  unique (empresa_id, codigo)
);

comment on table public.rol is 'Roles del panel. empresa_id NULL = rol de sistema reutilizable por todas las empresas.';

-- Roles de sistema base
insert into public.rol (empresa_id, codigo, nombre, es_sistema) values
  (null, 'admin',         'Administrador', true),
  (null, 'recepcion',     'Recepción',     true),
  (null, 'entrenador',    'Entrenador',    true),
  (null, 'nutricionista', 'Nutricionista', true),
  (null, 'mantenimiento', 'Mantenimiento', true);

-- ── Usuario (perfil, espejo de auth.users) ──────────────────────────────────
create table public.usuario (
  id                uuid primary key references auth.users(id) on delete cascade,
  nombre            text not null,
  email             citext,
  telefono          text,
  avatar_iniciales  text,                        -- 'AQ'
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_usuario_updated before update on public.usuario
  for each row execute function public.set_updated_at();

comment on table public.usuario is 'Perfil de aplicación. id = auth.users.id. No lleva empresa_id: la relación es N:N vía usuario_empresa.';

-- ── Membership usuario ↔ empresa ────────────────────────────────────────────
create table public.usuario_empresa (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  rol_id     uuid not null references public.rol(id),
  es_default boolean not null default false,     -- empresa que se abre por defecto al entrar
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (usuario_id, empresa_id)
);

create index idx_usuario_empresa_usuario on public.usuario_empresa(usuario_id);
create index idx_usuario_empresa_empresa on public.usuario_empresa(empresa_id);

comment on table public.usuario_empresa is 'Membership: a qué empresas pertenece un usuario y con qué rol en cada una.';

-- Solo una empresa default por usuario
create unique index uq_usuario_empresa_default
  on public.usuario_empresa(usuario_id) where es_default;

-- ── Sedes permitidas al staff (dentro de una empresa) ───────────────────────
create table public.usuario_sede (
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  empresa_id uuid not null references public.empresa(id) on delete cascade,  -- TENANT (denormalizado p/ RLS)
  sede_id    uuid not null references public.sede(id) on delete cascade,
  primary key (usuario_id, sede_id)
);

create index idx_usuario_sede_empresa on public.usuario_sede(empresa_id);

comment on table public.usuario_sede is
  'Sedes que un usuario puede ver. Si empresa.staff_multisede o rol admin => ve todas (resuelto en auth_sede_ids()).';

-- ── Módulos habilitados por empresa (override del default de la categoría) ──
create table public.empresa_modulo (
  empresa_id uuid not null references public.empresa(id) on delete cascade,  -- TENANT
  modulo_id  uuid not null references public.modulo(id) on delete cascade,
  habilitado boolean not null default true,
  config     jsonb not null default '{}',
  primary key (empresa_id, modulo_id)
);

comment on table public.empresa_modulo is
  'Feature flags efectivos de módulos por empresa. Si no hay fila, se usa el default de categoria_modulo.';
