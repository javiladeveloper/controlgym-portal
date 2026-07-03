-- ============================================================================
-- 02 · Catálogos globales (NO multi-tenant — compartidos por todas las empresas)
--   · categoria_gym  : tipos de gym (fitness / niños / clases)
--   · modulo         : los 13 módulos del panel
--   · categoria_modulo: qué módulos trae por defecto cada tipo de gym
-- ============================================================================

-- ── Tipos de gym ────────────────────────────────────────────────────────────
create table public.categoria_gym (
  id          uuid primary key default gen_random_uuid(),
  codigo      text unique not null,          -- 'fitness' | 'ninos' | 'clases'
  nombre      text not null,
  descripcion text,
  -- Flags de comportamiento base del tipo (el frontend/BD los usa como default)
  usa_maquinas   boolean not null default true,   -- 'clases' => false
  usa_rutinas    boolean not null default true,   -- rutinas de pesas; 'clases' => false
  requiere_apoderado boolean not null default false, -- 'ninos' => true
  created_at  timestamptz not null default now()
);

comment on table public.categoria_gym is 'Catálogo global de tipos de gimnasio. Extensible sin tocar schema.';

-- ── Módulos del panel ───────────────────────────────────────────────────────
create table public.modulo (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,          -- 'dashboard','clientes',...
  nombre      text not null,
  descripcion text,
  orden       int not null default 0,        -- orden en el sidebar
  es_core     boolean not null default false -- siempre visible (dashboard)
);

comment on table public.modulo is 'Catálogo global de los módulos del panel.';

-- ── Qué módulos trae cada tipo de gym por defecto ──────────────────────────
create table public.categoria_modulo (
  categoria_id uuid not null references public.categoria_gym(id) on delete cascade,
  modulo_id    uuid not null references public.modulo(id) on delete cascade,
  primary key (categoria_id, modulo_id)
);

comment on table public.categoria_modulo is
  'Módulos habilitados por defecto según el tipo de gym. La empresa puede sobreescribir vía empresa_modulo.';

-- ── Seed de catálogos ───────────────────────────────────────────────────────
insert into public.categoria_gym (codigo, nombre, descripcion, usa_maquinas, usa_rutinas, requiere_apoderado) values
  ('fitness', 'Fitness / Adultos', 'Musculación, máquinas, rutinas de pesas y clases', true,  true,  false),
  ('ninos',   'Niños',             'Gimnasio infantil gestionado con apoderados',       true,  true,  true),
  ('clases',  'Solo clases',       'Yoga, pilates, baile, etc. Sin máquinas ni rutinas de pesas', false, false, false);

insert into public.modulo (slug, nombre, descripcion, orden, es_core) values
  ('dashboard',   'Dashboard',        'Resumen y KPIs de la sede',                 0,  true),
  ('clientes',    'Clientes',         'Socios y fichas',                           1,  false),
  ('crm',         'CRM',              'Prospectos y seguimientos',                 2,  false),
  ('membresias',  'Membresías',       'Planes y membresías de socios',             3,  false),
  ('rutinas',     'Rutinas y dietas', 'Planes de entrenamiento y alimentación',    4,  false),
  ('clases',      'Clases',           'Horario de clases y acceso por plan',       5,  false),
  ('promociones', 'Promociones',      'Campañas de captación y retención',         6,  false),
  ('personal',    'Personal',         'Colaboradores y turnos',                    7,  false),
  ('kardex',      'Kardex',           'Inventario y ventas de productos',          8,  false),
  ('maquinas',    'Máquinas',         'Equipos y mantenimientos',                  9,  false),
  ('finanzas',    'Finanzas',         'Ingresos, gastos y caja',                  10,  false),
  ('sponsors',    'Sponsors',         'Convenios y auspicios',                    11,  false),
  ('reportes',    'Reportes',         'Generación de reportes',                   12,  false);

-- Mapeo categoria → módulos
-- Fitness: todos los módulos
insert into public.categoria_modulo (categoria_id, modulo_id)
select c.id, m.id
from public.categoria_gym c cross join public.modulo m
where c.codigo = 'fitness';

-- Niños: todos MENOS 'rutinas' (los niños no llevan rutina de pesas) — mantiene máquinas/clases
insert into public.categoria_modulo (categoria_id, modulo_id)
select c.id, m.id
from public.categoria_gym c cross join public.modulo m
where c.codigo = 'ninos' and m.slug <> 'rutinas';

-- Clases: núcleo sin 'maquinas' ni 'rutinas'
insert into public.categoria_modulo (categoria_id, modulo_id)
select c.id, m.id
from public.categoria_gym c cross join public.modulo m
where c.codigo = 'clases' and m.slug not in ('maquinas', 'rutinas');

-- RLS: catálogos legibles por cualquier usuario autenticado; escritura solo service_role.
alter table public.categoria_gym    enable row level security;
alter table public.modulo           enable row level security;
alter table public.categoria_modulo enable row level security;

create policy "catalogo_gym_read"    on public.categoria_gym    for select to authenticated using (true);
create policy "catalogo_modulo_read" on public.modulo           for select to authenticated using (true);
create policy "catalogo_catmod_read" on public.categoria_modulo for select to authenticated using (true);
