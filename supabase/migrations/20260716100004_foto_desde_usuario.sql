-- La foto es del usuario: se escribe en usuario y el trigger la propaga a los socios.
create or replace function public.subir_mi_foto(p_foto_url text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if coalesce(trim(p_foto_url),'') = '' then raise exception 'Falta la foto'; end if;
  update public.usuario
     set foto_url = p_foto_url, foto_estado = 'pendiente', foto_actualizada_at = now(),
         updated_at = now()
   where id = v_uid;
  if not found then raise exception 'Usuario no encontrado'; end if;
  return jsonb_build_object('ok', true, 'estado', 'pendiente');
end;
$function$;

-- Recepción aprueba/rechaza; el estado sube a la FUENTE (usuario) para no divergir.
-- Solo si el socio tiene cuenta; si no, se mantiene el estado en el socio.
create or replace function public.validar_foto_socio(p_socio_id uuid, p_aprobar boolean)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_uid uuid;
  v_estado text := case when p_aprobar then 'aprobada' else 'rechazada' end;
begin
  if v_empresa is null or not (public.auth_is_admin() or public.auth_rol() in ('admin','recepcion')) then
    raise exception 'No autorizado';
  end if;
  select usuario_id into v_uid from public.socio
   where id = p_socio_id and empresa_id = v_empresa and deleted_at is null;
  if not found then raise exception 'Socio no encontrado'; end if;

  if v_uid is not null then
    -- Tiene cuenta: el estado vive en usuario; el trigger lo propaga a todos sus gyms.
    update public.usuario set foto_estado = v_estado, updated_at = now() where id = v_uid;
  else
    -- Sin cuenta: el socio es su propio dato.
    update public.socio set foto_estado = v_estado where id = p_socio_id;
  end if;
  return jsonb_build_object('ok', true, 'estado', v_estado);
end;
$function$;
