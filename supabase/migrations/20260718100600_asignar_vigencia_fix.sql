-- Fix: la BD no garantiza "una sola rutina activa por socio" (sin unique
-- constraint). Antes se desactivaba solo la rutina previa más reciente,
-- dejando huérfanas otras rutinas activas si el socio tenía 2+. Ahora se
-- desactivan TODAS las rutinas activas previas del socio, y rutina_anterior_id
-- sigue enlazando la más reciente (mismo comportamiento de historial).
create or replace function public.asignar_rutina_con_vigencia(
  p_rutina_id uuid, p_duracion_semanas int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := auth_empresa_id(); v_socio uuid; v_fin date; v_prev uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  select socio_id into v_socio from public.rutina
   where id = p_rutina_id and empresa_id = v_emp;
  if v_socio is null then raise exception 'rutina no encontrada o sin acceso'; end if;
  if coalesce(p_duracion_semanas,0) < 1 then raise exception 'duración inválida'; end if;

  v_fin := current_date + (p_duracion_semanas * 7);

  -- la rutina activa previa MÁS RECIENTE del socio (distinta de esta) se
  -- enlaza como rutina_anterior_id, para preservar el historial
  select id into v_prev from public.rutina
   where socio_id = v_socio and empresa_id = v_emp and activa and id <> p_rutina_id
   order by created_at desc limit 1;

  -- pero se desactivan TODAS las rutinas activas previas del socio, no solo
  -- la más reciente: la BD no garantiza que exista una sola activa, y dejar
  -- las demás encendidas deja el historial inconsistente en silencio
  update public.rutina
     set activa = false
   where socio_id = v_socio and empresa_id = v_emp and activa and id <> p_rutina_id;

  update public.rutina
     set vigencia_inicio = current_date, vigencia_fin = v_fin,
         duracion_semanas = p_duracion_semanas, rutina_anterior_id = v_prev,
         activa = true, aviso_vencimiento_enviado_at = null
   where id = p_rutina_id;

  return jsonb_build_object('ok', true, 'vigencia_fin', v_fin, 'rutina_anterior_id', v_prev);
end $$;
revoke all on function public.asignar_rutina_con_vigencia(uuid,int) from public;
grant execute on function public.asignar_rutina_con_vigencia(uuid,int) to authenticated, service_role;
