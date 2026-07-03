-- ============================================================================
-- 26 · Landing enriquecida: imágenes, galería, estadísticas, secciones, ubicación
--   Toda la config de la página web vive en empresa.landing (jsonb) para ser
--   flexible y escalar sin más migraciones. Estructura:
--   {
--     hero_url, hero_overlay (0..1),
--     galeria: [url, ...],
--     stats: [{ label, valor }, ...],           -- ej. {label:'Miembros', valor:'500+'}
--     secciones: { planes, clases, sedes, galeria, stats, mapa },  -- bool visibilidad
--     ubicacion: { lat, lng, direccion }         -- pin del mapa
--   }
--   La foto de cada sede va en sede.foto_url.
-- ============================================================================

alter table public.empresa
  add column if not exists landing jsonb not null default '{}';

comment on column public.empresa.landing is
  'Config de la página web pública: hero, galería, stats, visibilidad de secciones, ubicación (mapa).';

alter table public.sede
  add column if not exists foto_url text;

-- Defaults sensatos de secciones para la empresa demo (todas visibles)
update public.empresa
   set landing = jsonb_build_object(
     'hero_overlay', 0.55,
     'secciones', jsonb_build_object('planes',true,'clases',true,'sedes',true,'galeria',true,'stats',true,'mapa',true)
   )
 where landing = '{}'::jsonb;
