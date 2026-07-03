-- ============================================================================
-- 09 · Rutinas y dietas (oculto para categoría 'clases')
-- ============================================================================

-- Catálogo de ejercicios (por empresa)
create table public.ejercicio (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresa(id) on delete cascade,     -- TENANT
  nombre         text not null,
  grupo_muscular text,
  descripcion    text,
  video_url      text,
  created_at     timestamptz not null default now()
);
create index idx_ejercicio_empresa on public.ejercicio(empresa_id);

-- Rutina (plan de entrenamiento de un socio)
create table public.rutina (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  socio_id      uuid references public.socio(id) on delete cascade,
  nombre        text,
  objetivo      text,
  entrenador_id uuid references public.usuario(id),
  enviado_at    timestamptz,                       -- "Enviar a la app del socio"
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_rutina_updated before update on public.rutina
  for each row execute function public.set_updated_at();
create index idx_rutina_empresa on public.rutina(empresa_id);
create index idx_rutina_socio on public.rutina(socio_id);

-- Día de la rutina (foco semanal)
create table public.rutina_dia (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,         -- TENANT
  rutina_id  uuid not null references public.rutina(id) on delete cascade,
  dia_semana int not null check (dia_semana between 1 and 7),
  foco       text,                                 -- 'Pierna y glúteo','Descanso'
  unique (rutina_id, dia_semana)
);
create index idx_rutina_dia_rutina on public.rutina_dia(rutina_id);

-- Ejercicios de un día
create table public.rutina_ejercicio (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  rutina_dia_id uuid not null references public.rutina_dia(id) on delete cascade,
  ejercicio_id  uuid references public.ejercicio(id),
  nombre        text,                              -- por si es libre
  series        int,
  reps          text,                              -- '4×12'
  descanso      text,
  orden         int not null default 0
);
create index idx_rutina_ejercicio_dia on public.rutina_ejercicio(rutina_dia_id);

-- Dieta
create table public.dieta (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresa(id) on delete cascade,     -- TENANT
  socio_id       uuid references public.socio(id) on delete cascade,
  nombre         text,
  nutricionista_id uuid references public.usuario(id),
  enviado_at     timestamptz,
  activa         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_dieta_updated before update on public.dieta
  for each row execute function public.set_updated_at();
create index idx_dieta_empresa on public.dieta(empresa_id);
create index idx_dieta_socio on public.dieta(socio_id);

-- Comidas de una dieta
create table public.comida (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa(id) on delete cascade,        -- TENANT
  dieta_id    uuid not null references public.dieta(id) on delete cascade,
  nombre      text not null,                       -- 'Desayuno'
  hora        time,
  descripcion text,
  kcal        int,
  orden       int not null default 0
);
create index idx_comida_dieta on public.comida(dieta_id);
