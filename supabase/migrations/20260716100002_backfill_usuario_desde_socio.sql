-- Backfill único: por cada usuario con socios vinculados, completar sus campos
-- vacíos con el valor del socio más reciente que sí lo tenga. No sobreescribe
-- datos ya presentes en usuario (coalesce se queda con u.<campo> si no es null).
with candidato as (
  select distinct on (s.usuario_id)
         s.usuario_id,
         s.nombre, s.telefono, s.documento, s.fecha_nacimiento,
         s.objetivo, s.peso_kg, s.talla_m, s.foto_url, s.foto_estado,
         s.foto_actualizada_at
  from public.socio s
  where s.usuario_id is not null and s.deleted_at is null
  order by s.usuario_id, s.created_at desc
)
update public.usuario u
   set nombre              = coalesce(nullif(u.nombre,''), c.nombre, u.nombre),
       telefono            = coalesce(u.telefono, c.telefono),
       documento           = coalesce(u.documento, c.documento),
       fecha_nacimiento    = coalesce(u.fecha_nacimiento, c.fecha_nacimiento),
       objetivo            = coalesce(u.objetivo, c.objetivo),
       peso_kg             = coalesce(u.peso_kg, c.peso_kg),
       talla_m             = coalesce(u.talla_m, c.talla_m),
       foto_url            = coalesce(u.foto_url, c.foto_url),
       foto_estado         = coalesce(u.foto_estado, c.foto_estado),
       foto_actualizada_at = coalesce(u.foto_actualizada_at, c.foto_actualizada_at)
  from candidato c
 where u.id = c.usuario_id;
