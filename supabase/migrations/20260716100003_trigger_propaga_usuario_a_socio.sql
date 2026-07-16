-- Trigger de propagación usuario -> socio: usuario es la fuente de verdad de
-- los datos personales. Cambios en usuario (nombre/telefono/documento/
-- fecha_nacimiento/objetivo/peso_kg/talla_m/foto_url/foto_estado/
-- foto_actualizada_at) se heredan a todas las fichas de socio del usuario.
--
-- Sin recursión: el trigger vive en usuario, actualiza socio (tabla distinta),
-- y solo actúa cuando cambia algún campo personal (evita trabajo en updates
-- irrelevantes, p.ej. solo updated_at).
create or replace function public.propagar_usuario_a_socio()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Solo si cambió algún campo personal (evita trabajo en updates irrelevantes).
  if new.nombre is distinct from old.nombre
     or new.telefono is distinct from old.telefono
     or new.documento is distinct from old.documento
     or new.fecha_nacimiento is distinct from old.fecha_nacimiento
     or new.objetivo is distinct from old.objetivo
     or new.peso_kg is distinct from old.peso_kg
     or new.talla_m is distinct from old.talla_m
     or new.foto_url is distinct from old.foto_url
     or new.foto_estado is distinct from old.foto_estado then
    update public.socio s
       set nombre              = coalesce(new.nombre, s.nombre),
           telefono            = new.telefono,
           documento           = coalesce(new.documento, s.documento),
           fecha_nacimiento    = new.fecha_nacimiento,
           objetivo            = new.objetivo,
           peso_kg             = new.peso_kg,
           talla_m             = new.talla_m,
           foto_url            = new.foto_url,
           foto_estado         = new.foto_estado,
           foto_actualizada_at = new.foto_actualizada_at
     where s.usuario_id = new.id and s.deleted_at is null;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_usuario_propaga on public.usuario;
create trigger trg_usuario_propaga
  after update on public.usuario
  for each row execute function public.propagar_usuario_a_socio();

-- Sincronización inicial idempotente: alinea todos los socios ya existentes
-- con los valores actuales de usuario (post Task 1 columnas + Task 2 backfill).
-- No depende del trigger (un update no-op de usuario no lo dispararía porque
-- los campos personales ya quedaron iguales tras el backfill).
update public.socio s
   set nombre = coalesce(u.nombre, s.nombre),
       telefono = u.telefono, documento = coalesce(u.documento, s.documento),
       fecha_nacimiento = u.fecha_nacimiento, objetivo = u.objetivo,
       peso_kg = u.peso_kg, talla_m = u.talla_m,
       foto_url = u.foto_url, foto_estado = u.foto_estado,
       foto_actualizada_at = u.foto_actualizada_at
  from public.usuario u
 where s.usuario_id = u.id and s.deleted_at is null;
