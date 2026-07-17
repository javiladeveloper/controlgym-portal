-- Fix: el trigger propagar_usuario_a_socio hacía `foto_estado = new.foto_estado`
-- sin coalesce, pero socio.foto_estado es NOT NULL (default 'sin_foto'). Si el
-- usuario tiene foto_estado null (52 usuarios en producción lo tenían), al editar
-- CUALQUIER dato personal el trigger intentaba propagar null → violación NOT NULL
-- → el guardado del perfil REVENTABA. Detectado al crear la cuenta demo de Apple.
--
-- Fix: coalesce(new.foto_estado, s.foto_estado, 'sin_foto') — usa el del usuario
-- si lo tiene, si no conserva el del socio, y como último recurso el default.
create or replace function public.propagar_usuario_a_socio()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.nombre is distinct from old.nombre
     or new.telefono is distinct from old.telefono
     or new.documento is distinct from old.documento
     or new.fecha_nacimiento is distinct from old.fecha_nacimiento
     or new.objetivo_nota is distinct from old.objetivo_nota
     or new.objetivo_id is distinct from old.objetivo_id
     or new.peso_kg is distinct from old.peso_kg
     or new.talla_m is distinct from old.talla_m
     or new.foto_url is distinct from old.foto_url
     or new.foto_estado is distinct from old.foto_estado then
    update public.socio s
       set nombre              = coalesce(new.nombre, s.nombre),
           telefono            = new.telefono,
           documento           = coalesce(new.documento, s.documento),
           fecha_nacimiento    = new.fecha_nacimiento,
           objetivo_nota       = new.objetivo_nota,
           objetivo_id         = new.objetivo_id,
           peso_kg             = new.peso_kg,
           talla_m             = new.talla_m,
           foto_url            = new.foto_url,
           foto_estado         = coalesce(new.foto_estado, s.foto_estado, 'sin_foto'),
           foto_actualizada_at = new.foto_actualizada_at
     where s.usuario_id = new.id and s.deleted_at is null;
  end if;
  return new;
end;
$function$;
