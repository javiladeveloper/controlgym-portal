-- Imagen y descripción del producto (para venderlo en la app).
-- Un producto que se vende por app necesita FOTO y DESCRIPCIÓN: la foto para
-- que el socio lo reconozca, la descripción para saber qué es (sabor, tamaño,
-- para qué sirve). La imagen se sube al bucket 'branding' (reusa subirImagen
-- del panel) y aquí guardamos su URL pública.

alter table public.producto
  add column if not exists imagen_url  text,
  add column if not exists descripcion text;

comment on column public.producto.imagen_url is
  'Foto del producto (URL pública en el bucket branding). Se muestra en la app y el kardex.';
comment on column public.producto.descripcion is
  'Descripción del producto para la app (sabor, tamaño, para qué sirve).';
