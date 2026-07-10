-- Catálogo de objetivos estándar con plan automático. codigo estable para
-- mapear plantillas; tiene_plan=false para objetivos "Otro"/disciplina sin plan.
create table if not exists public.objetivo_entrenamiento (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null unique,
  nombre    text not null,
  enfoque   text,
  orden     int not null default 0,
  tiene_plan boolean not null default true
);

insert into public.objetivo_entrenamiento (codigo, nombre, enfoque, orden) values
  ('bajar_peso',      'Bajar de peso',          'Déficit calórico + cardio + fullbody', 1),
  ('ganar_masa',      'Ganar masa muscular',    'Superávit + hipertrofia + split',      2),
  ('tonificar',       'Tonificar',              'Mantenimiento + circuitos',            3),
  ('fuerza',          'Fuerza',                 'Cargas altas, pocas reps',             4),
  ('resistencia',     'Resistencia / cardio',   'Alto volumen, poco descanso',          5),
  ('salud_general',   'Salud general',          'Equilibrado, moderado',                6),
  ('rehabilitacion',  'Rehabilitación',         'Bajo impacto, movilidad',              7),
  ('prep_deportiva',  'Preparación deportiva',  'Funcional, potencia',                  8)
on conflict (codigo) do nothing;

-- Objetivo del socio como FK (además del texto libre que se conserva)
alter table public.socio add column if not exists objetivo_id uuid references public.objetivo_entrenamiento(id);

-- Lectura del catálogo para authenticated (es global, no sensible)
alter table public.objetivo_entrenamiento enable row level security;
drop policy if exists objetivo_lectura on public.objetivo_entrenamiento;
create policy objetivo_lectura on public.objetivo_entrenamiento for select to authenticated using (true);

comment on table public.objetivo_entrenamiento is 'Catálogo de objetivos con plan automático (rutina+dieta por objetivo, modulado por IMC).';
