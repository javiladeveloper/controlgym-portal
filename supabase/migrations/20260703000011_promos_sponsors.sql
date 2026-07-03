-- ============================================================================
-- 11 · Promociones y sponsors (nivel empresa)
-- ============================================================================

create table public.promocion (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresa(id) on delete cascade,       -- TENANT
  nombre       text not null,
  descripcion  text,
  canal        text,                               -- 'Recepción y redes','App del socio'
  tipo         text check (tipo in ('descuento_pct','descuento_monto','2x1','semana_gratis','otro')),
  valor        numeric(12,2),
  fecha_inicio date,
  fecha_fin    date,
  estado       text not null default 'activa' check (estado in ('activa','programada','finalizada','pausada')),
  canjes       int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_promocion_updated before update on public.promocion
  for each row execute function public.set_updated_at();
create index idx_promocion_empresa on public.promocion(empresa_id);

-- FK diferida de membresia.promocion_id → promocion
alter table public.membresia
  add constraint fk_membresia_promocion
  foreign key (promocion_id) references public.promocion(id);

create table public.sponsor (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresa(id) on delete cascade, -- TENANT
  nombre             text not null,
  descripcion        text,
  tipo               text check (tipo in ('auspicio','canje','descuento_cruzado','convenio_corporativo','otro')),
  aporte_monto       numeric(12,2),
  aporte_detalle     text,
  beneficio          text,
  fecha_vencimiento  date,
  estado             text not null default 'activo' check (estado in ('activo','por_renovar','inactivo')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create trigger trg_sponsor_updated before update on public.sponsor
  for each row execute function public.set_updated_at();
create index idx_sponsor_empresa on public.sponsor(empresa_id);
