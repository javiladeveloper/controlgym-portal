-- Idea Image Gym #4 — Suplementos con beneficio.
-- El socio quiere ver, en la tienda de la app, el BENEFICIO de cada suplemento
-- (no solo el nombre/precio). Agregamos el campo y lo exponemos en catalogo_app.
alter table public.producto
  add column if not exists beneficio text;

comment on column public.producto.beneficio is
  'Beneficio del producto (ej. "24g de proteína · recuperación muscular"). Se muestra en la tienda de la app, util para suplementos.';
