-- ============================================================================
-- 28 · Subir límite del bucket 'branding' a 5MB (red de seguridad).
--   El frontend comprime/redimensiona antes de subir (src/lib/imagen.js),
--   así que rara vez se acercará al límite.
-- ============================================================================

update storage.buckets
   set file_size_limit = 5242880  -- 5MB
 where id = 'branding';
