-- Idea Image Gym #3 — Croquis del gimnasio (mapa de áreas/máquinas).
-- Los socios se pierden buscando máquinas. El gym sube una IMAGEN de su plano
-- (por sede) y la app la muestra. Simple y funciona ya; un editor de zonas con
-- puntos es una fase 2 opcional.
alter table public.sede
  add column if not exists croquis_url text;

comment on column public.sede.croquis_url is 'Imagen del croquis/plano de la sede (áreas y máquinas). El socio la ve en la app para ubicarse.';
