-- Catálogo GLOBAL de ejercicios (reemplaza ejercicio_maestro como fuente).
-- 1,324 ejercicios con GIF, instrucciones/pasos multi-idioma, músculos y equipo.
-- Fuente: hasaneyldrm/exercises-dataset (MIT; media © Gymvisual).
create table if not exists public.ejercicio_catalogo (
  id             uuid primary key default gen_random_uuid(),
  ext_id         text not null unique,          -- "0001" del dataset (idempotencia)
  nombre         text not null,                 -- inglés (fuente)
  nombre_es      text,                          -- traducción curada
  body_part      text not null,
  grupo_muscular text,
  target         text,
  secondary      text[] not null default '{}',
  equipment      text,
  instrucciones  jsonb not null default '{}'::jsonb,  -- {en, es, ...}
  pasos          jsonb not null default '{}'::jsonb,  -- {en:[...], es:[...]}
  media_id       text,
  foto_url       text,
  gif_url        text,
  attribution    text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ejercicio_catalogo_body_part_idx on public.ejercicio_catalogo (body_part);
create index if not exists ejercicio_catalogo_equipment_idx on public.ejercicio_catalogo (equipment);
create index if not exists ejercicio_catalogo_target_idx    on public.ejercicio_catalogo (target);
create extension if not exists pg_trgm with schema extensions;
create index if not exists ejercicio_catalogo_nombre_trgm on public.ejercicio_catalogo
  using gin ((coalesce(nombre_es,'') || ' ' || nombre) extensions.gin_trgm_ops);

alter table public.ejercicio_catalogo enable row level security;
-- Catálogo global de solo lectura: cualquier usuario autenticado lo ve.
drop policy if exists ejercicio_catalogo_sel on public.ejercicio_catalogo;
create policy ejercicio_catalogo_sel on public.ejercicio_catalogo
  for select to authenticated using (true);
-- Escritura solo por el backend (service_role bypassa RLS; no hay policy de write).
