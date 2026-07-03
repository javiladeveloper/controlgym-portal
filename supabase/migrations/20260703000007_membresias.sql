-- ============================================================================
-- 07 · Membresías: planes, acceso a clases por plan, membresías y congelamiento
--   Soporta planes individuales y FAMILIARES (una membresía cubre N hijos).
-- ============================================================================

-- ── Plan ────────────────────────────────────────────────────────────────────
create table public.plan (
  id                      uuid primary key default gen_random_uuid(),
  empresa_id              uuid not null references public.empresa(id) on delete cascade,  -- TENANT
  nombre                  text not null,           -- 'Premium','Pase del día'
  precio                  numeric(12,2) not null,   -- cuota recurrente (mensualidad, etc.)
  precio_matricula        numeric(12,2) not null default 0, -- pago único de inscripción (0 = sin matrícula)
  cobra_matricula         boolean not null default false,   -- si el plan cobra matrícula al inscribir
  unidad                  text not null default 'mes' check (unidad in ('dia','mes','trimestre','anual')),
  descripcion             text,
  dias_congelamiento_anio int not null default 0,  -- tope de congelamiento (Premium 30, Estándar 15, Básico 0)
  multisede               boolean not null default false, -- acceso a todas las sedes (si empresa lo permite)
  es_familiar             boolean not null default false, -- una membresía cubre varios socios (hijos)
  max_integrantes         int,                     -- para planes familiares
  incluye_clases          boolean not null default false,
  incluye_rutina          boolean not null default false,
  badge                   text,                    -- 'MÁS POPULAR'
  orden                   int not null default 0,
  activo                  boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

create trigger trg_plan_updated before update on public.plan
  for each row execute function public.set_updated_at();

create index idx_plan_empresa on public.plan(empresa_id);

comment on table public.plan is 'Plan de membresía (nivel empresa). Individual o familiar; opcional multisede.';

-- ── Tipos de clase / servicio ───────────────────────────────────────────────
create table public.tipo_clase (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,         -- TENANT
  nombre     text not null,                        -- 'Funcional','Baile','Spinning','Yoga'
  color      text,                                 -- color para el frontend
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

create index idx_tipo_clase_empresa on public.tipo_clase(empresa_id);

-- ── Acceso a clases por plan (matriz plan × tipo_clase) ─────────────────────
create table public.plan_acceso_clase (
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  plan_id       uuid not null references public.plan(id) on delete cascade,
  tipo_clase_id uuid not null references public.tipo_clase(id) on delete cascade,
  incluido      boolean not null default false,
  primary key (plan_id, tipo_clase_id)
);

create index idx_plan_acceso_empresa on public.plan_acceso_clase(empresa_id);

comment on table public.plan_acceso_clase is 'Qué tipos de clase incluye cada plan (DEFAULT_ACCESO del prototipo).';

-- ── Membresía de un socio ───────────────────────────────────────────────────
create table public.membresia (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  sede_id       uuid not null references public.sede(id),
  socio_id      uuid not null references public.socio(id) on delete cascade,        -- titular (o socio individual)
  plan_id       uuid not null references public.plan(id),
  fecha_inicio  date not null default current_date,
  fecha_fin     date not null,
  estado        text not null default 'activa' check (estado in ('activa','vencida','congelada','cancelada')),
  precio_pagado numeric(12,2),
  matricula_pagada numeric(12,2) not null default 0, -- matrícula cobrada al inscribir (0 si no aplica)
  promocion_id  uuid,                               -- FK añadida en migración de promos
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create trigger trg_membresia_updated before update on public.membresia
  for each row execute function public.set_updated_at();

create index idx_membresia_empresa_sede on public.membresia(empresa_id, sede_id);
create index idx_membresia_socio on public.membresia(socio_id);
create index idx_membresia_fecha_fin on public.membresia(empresa_id, fecha_fin);

comment on table public.membresia is 'Membresía de un socio. Para planes familiares, membresia_integrante lista a los hijos cubiertos.';

-- ── Integrantes de una membresía familiar ───────────────────────────────────
create table public.membresia_integrante (
  membresia_id uuid not null references public.membresia(id) on delete cascade,
  socio_id     uuid not null references public.socio(id) on delete cascade,
  empresa_id   uuid not null references public.empresa(id) on delete cascade,       -- TENANT
  primary key (membresia_id, socio_id)
);

create index idx_membresia_integrante_socio on public.membresia_integrante(socio_id);

comment on table public.membresia_integrante is 'Socios (hijos) cubiertos por una membresía familiar.';

-- ── Congelamientos ──────────────────────────────────────────────────────────
create table public.congelamiento (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresa(id) on delete cascade,       -- TENANT
  membresia_id uuid not null references public.membresia(id) on delete cascade,
  fecha_inicio date not null,
  fecha_fin    date,
  dias         int,
  motivo       text,
  estado       text not null default 'solicitado' check (estado in ('solicitado','aprobado','rechazado','finalizado')),
  aprobado_por uuid references public.usuario(id),
  created_at   timestamptz not null default now()
);

create index idx_congelamiento_membresia on public.congelamiento(membresia_id);
create index idx_congelamiento_empresa on public.congelamiento(empresa_id);
