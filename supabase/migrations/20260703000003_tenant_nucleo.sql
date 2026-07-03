-- ============================================================================
-- 03 · Tenant núcleo: empresa (tenant raíz) y sede
-- ============================================================================

create table public.empresa (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  slug         text unique,                       -- identificador / subdominio
  categoria_id uuid not null references public.categoria_gym(id),
  moneda       char(3) not null default 'PEN',
  -- Flags de negocio
  staff_multisede           boolean not null default false, -- staff puede ver varias sedes
  permite_planes_multisede  boolean not null default false, -- planes con acceso a todas las sedes
  settings     jsonb not null default '{}',
  estado       text not null default 'activa' check (estado in ('activa','suspendida','cancelada')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz                        -- soft-delete
);

create trigger trg_empresa_updated before update on public.empresa
  for each row execute function public.set_updated_at();

create index idx_empresa_categoria on public.empresa(categoria_id);

comment on table public.empresa is 'Tenant raíz. Cada gimnasio-cliente del SaaS. TODO cuelga de aquí vía empresa_id.';

-- ── Sede ────────────────────────────────────────────────────────────────────
create table public.sede (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,  -- TENANT
  nombre     text not null,
  direccion  text,
  telefono   text,
  aforo_max  int,                               -- para KPI de aforo
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger trg_sede_updated before update on public.sede
  for each row execute function public.set_updated_at();

create index idx_sede_empresa on public.sede(empresa_id);

comment on table public.sede is 'Sede física de una empresa. Todo lo operativo (socios, clases, caja) cuelga de una sede.';
