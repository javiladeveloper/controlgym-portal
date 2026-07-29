-- Rutinas prediseñadas curadas para el usuario en casa (sin gym). Catálogo
-- GLOBAL (sin empresa_id), como ejercicio_catalogo: cualquiera las lee, solo
-- service_role las cura. El usuario las "adopta" copiándolas a su rutina_libre.

create table public.rutina_predisenada (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  nombre        text not null,
  categoria     text not null,
  descripcion   text,
  nivel         text not null default 'principiante'
                  check (nivel in ('principiante','intermedio','avanzado')),
  dias_por_semana int not null check (dias_por_semana between 1 and 6),
  equipo        text not null default 'peso_corporal'
                  check (equipo in ('peso_corporal','mancuernas','gym_completo')),
  disclaimer_salud text,
  imagen        text,
  orden         int not null default 0,
  activa        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index rutina_predisenada_cat_idx on public.rutina_predisenada (categoria, activa, orden);

create table public.rutina_predisenada_dia (
  id            uuid primary key default gen_random_uuid(),
  predisenada_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  dia_semana    int not null,
  foco          text
);
create index rutina_predisenada_dia_idx on public.rutina_predisenada_dia (predisenada_id);

create table public.rutina_predisenada_ejercicio (
  id            uuid primary key default gen_random_uuid(),
  predisenada_dia_id uuid not null references public.rutina_predisenada_dia(id) on delete cascade,
  catalogo_id   uuid not null references public.ejercicio_catalogo(id),
  nombre        text not null,
  series        int,
  reps          text,
  descanso      text,
  orden         int not null default 0,
  alternativas_ids uuid[] not null default '{}'
);
create index rutina_predisenada_ej_idx on public.rutina_predisenada_ejercicio (predisenada_dia_id);

-- RLS: lectura para cualquier authenticated (catálogo compartido); escritura
-- solo service_role (curado por SQL).
alter table public.rutina_predisenada enable row level security;
alter table public.rutina_predisenada_dia enable row level security;
alter table public.rutina_predisenada_ejercicio enable row level security;

create policy rutina_predisenada_lee on public.rutina_predisenada
  for select to authenticated using (activa);
create policy rutina_predisenada_dia_lee on public.rutina_predisenada_dia
  for select to authenticated using (true);
create policy rutina_predisenada_ej_lee on public.rutina_predisenada_ejercicio
  for select to authenticated using (true);

grant select on public.rutina_predisenada to authenticated;
grant select on public.rutina_predisenada_dia to authenticated;
grant select on public.rutina_predisenada_ejercicio to authenticated;
