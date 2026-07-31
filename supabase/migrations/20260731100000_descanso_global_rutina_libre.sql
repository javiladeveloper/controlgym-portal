-- Descanso global de la rutina libre: aplicar un mismo descanso a TODOS los
-- ejercicios de una vez.
--
-- POR QUÉ (pedido del owner): tras generar la rutina, el usuario pasa por una
-- pantalla de revisión donde puede ajustar todo antes de quedarse con ella
-- ("solo damos una recomendación"). Cambiar el descanso ejercicio por ejercicio
-- es tedioso cuando quiere el mismo para todos, así que hace falta un botón
-- "descanso para todos" — y para eso, esta RPC.
--
-- El ajuste individual ya existe (editar_ejercicio_libre); esta es el atajo
-- masivo, no lo reemplaza.

create or replace function public.descanso_global_rutina_libre(
  p_rutina_libre_id uuid,
  p_descanso text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario uuid := auth.uid();
  v_es_mia boolean;
begin
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;
  if coalesce(trim(p_descanso), '') = '' then
    raise exception 'descanso inválido';
  end if;

  -- Pertenencia: solo el dueño de la rutina puede tocarla.
  select exists (
    select 1 from public.rutina_libre
    where id = p_rutina_libre_id and usuario_id = v_usuario
  ) into v_es_mia;
  if not v_es_mia then raise exception 'rutina no encontrada'; end if;

  update public.rutina_libre_ejercicio e
  set descanso = trim(p_descanso)
  from public.rutina_libre_dia d
  where d.id = e.rutina_libre_dia_id
    and d.rutina_libre_id = p_rutina_libre_id;

  return public._rutina_libre_detalle(p_rutina_libre_id);
end;
$$;

revoke all on function public.descanso_global_rutina_libre(uuid, text) from public;
grant execute on function public.descanso_global_rutina_libre(uuid, text) to authenticated, service_role;

comment on function public.descanso_global_rutina_libre(uuid, text) is
  'Aplica el mismo descanso a todos los ejercicios de una rutina libre propia. Atajo masivo del ajuste individual (editar_ejercicio_libre).';
