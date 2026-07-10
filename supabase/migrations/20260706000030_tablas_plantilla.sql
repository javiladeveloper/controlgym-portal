-- Plantillas de rutina/dieta por objetivo. empresa_id nullable: NULL = global
-- (semilla del sistema); set = versión personalizada del gym (pisa la global).
create table if not exists public.plantilla_rutina (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresa(id) on delete cascade,
  objetivo_id uuid not null references public.objetivo_entrenamiento(id),
  nombre text not null,
  notas text,
  created_at timestamptz not null default now()
);
create table if not exists public.plantilla_rutina_dia (
  id uuid primary key default gen_random_uuid(),
  plantilla_rutina_id uuid not null references public.plantilla_rutina(id) on delete cascade,
  dia_semana int not null,
  foco text
);
create table if not exists public.plantilla_rutina_ejercicio (
  id uuid primary key default gen_random_uuid(),
  plantilla_rutina_dia_id uuid not null references public.plantilla_rutina_dia(id) on delete cascade,
  ejercicio_id uuid references public.ejercicio(id),
  nombre text not null,
  series int, reps text, descanso text, carga text, orden int not null default 0, notas text
);
create table if not exists public.plantilla_dieta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresa(id) on delete cascade,
  objetivo_id uuid not null references public.objetivo_entrenamiento(id),
  nombre text not null,
  suplementos text,
  created_at timestamptz not null default now()
);
create table if not exists public.plantilla_comida (
  id uuid primary key default gen_random_uuid(),
  plantilla_dieta_id uuid not null references public.plantilla_dieta(id) on delete cascade,
  nombre text not null, hora time, descripcion text, kcal int, orden int not null default 0, dia_semana int
);

-- Unicidad: una plantilla por objetivo por ámbito (global o gym).
create unique index if not exists uq_plantilla_rutina_objetivo
  on public.plantilla_rutina (objetivo_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));
create unique index if not exists uq_plantilla_dieta_objetivo
  on public.plantilla_dieta (objetivo_id, coalesce(empresa_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- RLS: lectura de globales (empresa_id null) para todos; las del gym solo su empresa.
alter table public.plantilla_rutina enable row level security;
alter table public.plantilla_dieta  enable row level security;
drop policy if exists pr_scope on public.plantilla_rutina;
create policy pr_scope on public.plantilla_rutina for all to authenticated
  using (empresa_id is null or empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());
drop policy if exists pd_scope on public.plantilla_dieta;
create policy pd_scope on public.plantilla_dieta for all to authenticated
  using (empresa_id is null or empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());
alter table public.plantilla_rutina_dia enable row level security;
alter table public.plantilla_rutina_ejercicio enable row level security;
alter table public.plantilla_comida enable row level security;
drop policy if exists prd_read on public.plantilla_rutina_dia;
create policy prd_read on public.plantilla_rutina_dia for select to authenticated using (true);
drop policy if exists pre_read on public.plantilla_rutina_ejercicio;
create policy pre_read on public.plantilla_rutina_ejercicio for select to authenticated using (true);
drop policy if exists pc_read on public.plantilla_comida;
create policy pc_read on public.plantilla_comida for select to authenticated using (true);
