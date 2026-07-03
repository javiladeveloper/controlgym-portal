-- ============================================================================
-- 10 · CRM: prospectos (leads) y tareas de seguimiento
-- ============================================================================

create table public.lead (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa(id) on delete cascade,        -- TENANT
  sede_id     uuid references public.sede(id),
  nombre      text not null,
  telefono    text,
  email       citext,
  fuente      text,                                -- 'Instagram','Facebook Ads','Referido'
  etapa       text not null default 'nuevo' check (etapa in ('nuevo','contactado','clase_prueba','inscrito')),
  nota        text,
  socio_id    uuid references public.socio(id),    -- si convierte a socio
  asignado_a  uuid references public.usuario(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_lead_updated before update on public.lead
  for each row execute function public.set_updated_at();
create index idx_lead_empresa_sede on public.lead(empresa_id, sede_id);
create index idx_lead_etapa on public.lead(empresa_id, etapa);

comment on table public.lead is 'Prospecto del embudo CRM.';

create table public.lead_tarea (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,         -- TENANT
  lead_id    uuid references public.lead(id) on delete cascade,
  tipo       text not null check (tipo in ('llamada','whatsapp','email','visita')),
  detalle    text,
  vence_at   timestamptz,
  completada boolean not null default false,
  asignado_a uuid references public.usuario(id),
  created_at timestamptz not null default now()
);
create index idx_lead_tarea_empresa on public.lead_tarea(empresa_id);
create index idx_lead_tarea_lead on public.lead_tarea(lead_id);
