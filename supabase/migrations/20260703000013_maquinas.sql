-- ============================================================================
-- 13 · Máquinas y mantenimientos (oculto para categoría 'clases')
-- ============================================================================

create table public.maquina (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,         -- TENANT
  sede_id    uuid not null references public.sede(id) on delete cascade,
  nombre     text not null,                        -- 'Caminadora ProRun 400'
  detalle    text,                                 -- '6 unidades · N.º 1-6'
  zona       text,                                 -- 'Cardio','Fuerza'
  unidades   int not null default 1,
  serie      text,
  estado     text not null default 'operativa' check (estado in ('operativa','mantenimiento','fuera_servicio')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create trigger trg_maquina_updated before update on public.maquina
  for each row execute function public.set_updated_at();
create index idx_maquina_empresa_sede on public.maquina(empresa_id, sede_id);

create table public.mantenimiento (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresa(id) on delete cascade,   -- TENANT
  sede_id          uuid not null references public.sede(id),
  maquina_id       uuid references public.maquina(id) on delete cascade,
  tipo             text not null default 'preventivo' check (tipo in ('preventivo','correctivo')),
  detalle          text,
  fecha_programada date,
  fecha_realizada  date,
  costo            numeric(12,2),
  estado           text not null default 'programado' check (estado in ('programado','en_proceso','completado','cancelado')),
  responsable_id   uuid references public.usuario(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_mantenimiento_updated before update on public.mantenimiento
  for each row execute function public.set_updated_at();
create index idx_mantenimiento_empresa_sede on public.mantenimiento(empresa_id, sede_id);
create index idx_mantenimiento_maquina on public.mantenimiento(maquina_id);
