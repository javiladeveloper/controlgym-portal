-- ============================================================================
-- 08 · Clases: horario semanal y reservas
--   El cupo ocupado se calcula contando reservas (no se almacena).
-- ============================================================================

create table public.clase (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  sede_id       uuid not null references public.sede(id) on delete cascade,
  tipo_clase_id uuid references public.tipo_clase(id),
  nombre        text not null,                     -- 'Baile · Salsa'
  dia_semana    int not null check (dia_semana between 1 and 7),  -- 1=Lunes ... 7=Domingo
  hora          time not null,
  duracion_min  int not null default 60,
  instructor_id uuid references public.usuario(id),
  cupo_max      int not null default 20,
  activa        boolean not null default true,     -- pausadas => false
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create trigger trg_clase_updated before update on public.clase
  for each row execute function public.set_updated_at();

create index idx_clase_empresa_sede on public.clase(empresa_id, sede_id);
create index idx_clase_dia on public.clase(empresa_id, sede_id, dia_semana);

comment on table public.clase is 'Clase recurrente del horario semanal de una sede.';

-- ── Reservas ────────────────────────────────────────────────────────────────
create table public.reserva_clase (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,         -- TENANT
  sede_id    uuid not null references public.sede(id),
  clase_id   uuid not null references public.clase(id) on delete cascade,
  socio_id   uuid not null references public.socio(id) on delete cascade,
  fecha      date not null,
  estado     text not null default 'reservada' check (estado in ('reservada','asistio','no_show','cancelada')),
  created_at timestamptz not null default now(),
  unique (clase_id, socio_id, fecha)
);

create index idx_reserva_clase_empresa_sede on public.reserva_clase(empresa_id, sede_id);
create index idx_reserva_clase_clase_fecha on public.reserva_clase(clase_id, fecha);
create index idx_reserva_clase_socio on public.reserva_clase(socio_id);

comment on table public.reserva_clase is 'Reserva de un socio a una clase en una fecha. El cupo ocupado = count de reservas activas.';
