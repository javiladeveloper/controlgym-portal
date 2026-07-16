-- actualizar_mi_perfil cambia de firma (agrega p_documento). CREATE OR REPLACE
-- con distinta firma crea una sobrecarga nueva en vez de reemplazar; se elimina
-- la versión vieja de 6 args para no dejar dos sobrecargas activas.
drop function if exists public.actualizar_mi_perfil(text,text,text,numeric,numeric,date);

-- get_mi_perfil ahora incluye foto_estado (la app lo usa para el badge).
create or replace function public.get_mi_perfil()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_perfil jsonb; v_email text;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select jsonb_build_object(
    'id', u.id, 'nombre', u.nombre, 'email', coalesce(u.email, v_email),
    'telefono', u.telefono, 'documento', u.documento, 'objetivo', u.objetivo,
    'foto_url', u.foto_url, 'foto_estado', u.foto_estado,
    'peso_kg', u.peso_kg, 'talla_m', u.talla_m, 'fecha_nacimiento', u.fecha_nacimiento
  ) into v_perfil
  from public.usuario u where u.id = v_uid;
  if v_perfil is null then
    v_perfil := jsonb_build_object('id', v_uid, 'email', v_email,
      'nombre', null, 'telefono', null, 'documento', null, 'objetivo', null,
      'foto_url', null, 'foto_estado', null, 'peso_kg', null, 'talla_m', null,
      'fecha_nacimiento', null);
  end if;
  return v_perfil;
end;
$function$;

-- actualizar_mi_perfil acepta documento (opcional) además de lo actual.
create or replace function public.actualizar_mi_perfil(
  p_nombre text default null, p_telefono text default null, p_objetivo text default null,
  p_peso_kg numeric default null, p_talla_m numeric default null,
  p_fecha_nacimiento date default null, p_documento text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  update public.usuario u
     set nombre = coalesce(p_nombre, u.nombre),
         telefono = coalesce(p_telefono, u.telefono),
         objetivo = coalesce(p_objetivo, u.objetivo),
         peso_kg = coalesce(p_peso_kg, u.peso_kg),
         talla_m = coalesce(p_talla_m, u.talla_m),
         fecha_nacimiento = coalesce(p_fecha_nacimiento, u.fecha_nacimiento),
         documento = coalesce(p_documento, u.documento),
         updated_at = now()
   where u.id = v_uid;
  if not found then
    insert into public.usuario (id, nombre, telefono, objetivo, peso_kg, talla_m, fecha_nacimiento, documento)
    values (v_uid, coalesce(p_nombre,''), p_telefono, p_objetivo, p_peso_kg, p_talla_m, p_fecha_nacimiento, p_documento);
  end if;
  return public.get_mi_perfil();
end;
$function$;

-- vincular_socio: tras enganchar, propagar los datos del usuario al socio recién
-- vinculado (el trigger solo dispara en UPDATE de usuario, no al setear usuario_id).
create or replace function public.vincular_socio()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_email text; v_tel text; v_n int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select regexp_replace(coalesce(telefono, ''), '\D', '', 'g') into v_tel
  from public.usuario where id = v_uid;

  update public.socio s set usuario_id = v_uid
   where s.usuario_id is null and s.deleted_at is null
     and ((s.email is not null and lower(s.email) = v_email)
       or (coalesce(v_tel,'') <> '' and length(v_tel) >= 9
           and regexp_replace(coalesce(s.telefono,''), '\D', '', 'g') = v_tel));
  get diagnostics v_n = row_count;

  -- Propaga los datos del usuario a TODOS sus socios (incluye los recién vinculados).
  update public.socio s
     set nombre = coalesce(u.nombre, s.nombre), telefono = u.telefono,
         documento = coalesce(u.documento, s.documento), fecha_nacimiento = u.fecha_nacimiento,
         objetivo = u.objetivo, peso_kg = u.peso_kg, talla_m = u.talla_m,
         foto_url = u.foto_url, foto_estado = u.foto_estado, foto_actualizada_at = u.foto_actualizada_at
    from public.usuario u
   where s.usuario_id = v_uid and u.id = v_uid and s.deleted_at is null;

  return jsonb_build_object('vinculados_ahora', v_n,
    'total', (select count(*) from public.socio where usuario_id = v_uid and deleted_at is null));
end;
$function$;

grant execute on function public.actualizar_mi_perfil(text,text,text,numeric,numeric,date,text) to authenticated;
