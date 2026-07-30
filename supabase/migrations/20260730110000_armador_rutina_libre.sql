-- BLOQUE 2 (spec 2026-07-30 entrenamiento completo app): RPCs del ARMADOR
-- de rutina libre multi-día. El usuario arma su propia rutina: crea una
-- rutina vacía con 1 día, agrega/quita/renombra días, agrega/quita/edita/
-- mueve ejercicios dentro de un día. Todas security definer, aisladas por
-- auth.uid() (join hasta rutina_libre.usuario_id), devuelven el detalle
-- completo con _rutina_libre_detalle (mismo shape que generar_rutina_libre/
-- mi_rutina_libre).

-- ============================================================
-- crear_rutina_libre_vacia: reemplaza la activa anterior del usuario y crea
-- una rutina vacía con 1 día (Día 1) lista para armar.
-- ============================================================

create or replace function public.crear_rutina_libre_vacia(p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  -- Reemplaza la rutina activa anterior del usuario (cascada borra días y
  -- ejercicios), igual que generar_rutina_libre.
  delete from public.rutina_libre where usuario_id = v_usuario and activa;

  insert into public.rutina_libre (usuario_id, nombre, activa)
  values (v_usuario, coalesce(nullif(trim(p_nombre), ''), 'Mi rutina'), true)
  returning id into v_rutina;

  insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
  values (v_rutina, 1, 'Día 1');

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.crear_rutina_libre_vacia(text) from public;
grant execute on function public.crear_rutina_libre_vacia(text) to authenticated, service_role;

-- ============================================================
-- agregar_dia_libre: agrega un día al final de la rutina (dia_semana = max+1).
-- ============================================================

create or replace function public.agregar_dia_libre(p_rutina_libre_id uuid, p_foco text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_siguiente int;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  if not exists (
    select 1 from public.rutina_libre
    where id = p_rutina_libre_id and usuario_id = v_usuario
  ) then
    raise exception 'rutina no encontrada';
  end if;

  select coalesce(max(dia_semana), 0) + 1 into v_siguiente
  from public.rutina_libre_dia
  where rutina_libre_id = p_rutina_libre_id;

  insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
  values (p_rutina_libre_id, v_siguiente, p_foco);

  return public._rutina_libre_detalle(p_rutina_libre_id);
end;
$function$;

revoke all on function public.agregar_dia_libre(uuid, text) from public;
grant execute on function public.agregar_dia_libre(uuid, text) to authenticated, service_role;

-- ============================================================
-- quitar_dia_libre: borra un día (cascada sus ejercicios). No permite dejar
-- la rutina con 0 días.
-- ============================================================

create or replace function public.quitar_dia_libre(p_dia_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
  v_total int;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  select rl.id into v_rutina
  from public.rutina_libre_dia d
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where d.id = p_dia_id and rl.usuario_id = v_usuario;

  if v_rutina is null then
    raise exception 'día no encontrado';
  end if;

  select count(*) into v_total
  from public.rutina_libre_dia
  where rutina_libre_id = v_rutina;

  if v_total <= 1 then
    raise exception 'la rutina debe tener al menos 1 día';
  end if;

  delete from public.rutina_libre_dia where id = p_dia_id;

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.quitar_dia_libre(uuid) from public;
grant execute on function public.quitar_dia_libre(uuid) to authenticated, service_role;

-- ============================================================
-- renombrar_dia_libre: cambia el foco del día ("Glúteos", "Pecho"…).
-- ============================================================

create or replace function public.renombrar_dia_libre(p_dia_id uuid, p_foco text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  select rl.id into v_rutina
  from public.rutina_libre_dia d
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where d.id = p_dia_id and rl.usuario_id = v_usuario;

  if v_rutina is null then
    raise exception 'día no encontrado';
  end if;

  update public.rutina_libre_dia set foco = p_foco where id = p_dia_id;

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.renombrar_dia_libre(uuid, text) from public;
grant execute on function public.renombrar_dia_libre(uuid, text) to authenticated, service_role;

-- ============================================================
-- agregar_ejercicio_libre: inserta un ejercicio del catálogo en un día.
-- nombre derivado del catálogo (nombre_es o nombre); orden = max+1.
-- p_descanso es el tiempo configurable (texto libre, ej. "60s").
-- ============================================================

create or replace function public.agregar_ejercicio_libre(
  p_dia_id uuid,
  p_catalogo_id uuid,
  p_series int,
  p_reps text,
  p_descanso text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
  v_nombre text;
  v_orden int;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  select rl.id into v_rutina
  from public.rutina_libre_dia d
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where d.id = p_dia_id and rl.usuario_id = v_usuario;

  if v_rutina is null then
    raise exception 'día no encontrado';
  end if;

  select coalesce(c.nombre_es, c.nombre) into v_nombre
  from public.ejercicio_catalogo c
  where c.id = p_catalogo_id;

  if v_nombre is null then
    raise exception 'ejercicio de catálogo no encontrado';
  end if;

  select coalesce(max(orden), 0) + 1 into v_orden
  from public.rutina_libre_ejercicio
  where rutina_libre_dia_id = p_dia_id;

  insert into public.rutina_libre_ejercicio
    (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
  values (p_dia_id, p_catalogo_id, v_nombre, p_series, p_reps, p_descanso, v_orden);

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.agregar_ejercicio_libre(uuid, uuid, int, text, text) from public;
grant execute on function public.agregar_ejercicio_libre(uuid, uuid, int, text, text) to authenticated, service_role;

-- ============================================================
-- quitar_ejercicio_libre: borra un ejercicio del día.
-- ============================================================

create or replace function public.quitar_ejercicio_libre(p_ejercicio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  select rl.id into v_rutina
  from public.rutina_libre_ejercicio re
  join public.rutina_libre_dia d on d.id = re.rutina_libre_dia_id
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where re.id = p_ejercicio_id and rl.usuario_id = v_usuario;

  if v_rutina is null then
    raise exception 'ejercicio no encontrado';
  end if;

  delete from public.rutina_libre_ejercicio where id = p_ejercicio_id;

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.quitar_ejercicio_libre(uuid) from public;
grant execute on function public.quitar_ejercicio_libre(uuid) to authenticated, service_role;

-- ============================================================
-- editar_ejercicio_libre: actualiza series/reps/descanso.
-- ============================================================

create or replace function public.editar_ejercicio_libre(
  p_ejercicio_id uuid,
  p_series int,
  p_reps text,
  p_descanso text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  select rl.id into v_rutina
  from public.rutina_libre_ejercicio re
  join public.rutina_libre_dia d on d.id = re.rutina_libre_dia_id
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where re.id = p_ejercicio_id and rl.usuario_id = v_usuario;

  if v_rutina is null then
    raise exception 'ejercicio no encontrado';
  end if;

  update public.rutina_libre_ejercicio
  set series = p_series, reps = p_reps, descanso = p_descanso
  where id = p_ejercicio_id;

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.editar_ejercicio_libre(uuid, int, text, text) from public;
grant execute on function public.editar_ejercicio_libre(uuid, int, text, text) to authenticated, service_role;

-- ============================================================
-- mover_ejercicio_libre: sube/baja el orden intercambiando con el
-- ejercicio adyacente del mismo día (reordenar simple, no drag&drop).
-- ============================================================

create or replace function public.mover_ejercicio_libre(p_ejercicio_id uuid, p_direccion text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
  v_dia uuid;
  v_orden int;
  v_vecino_id uuid;
  v_vecino_orden int;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  if p_direccion not in ('arriba', 'abajo') then
    raise exception 'dirección inválida (arriba/abajo)';
  end if;

  select rl.id, re.rutina_libre_dia_id, re.orden
  into v_rutina, v_dia, v_orden
  from public.rutina_libre_ejercicio re
  join public.rutina_libre_dia d on d.id = re.rutina_libre_dia_id
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where re.id = p_ejercicio_id and rl.usuario_id = v_usuario;

  if v_rutina is null then
    raise exception 'ejercicio no encontrado';
  end if;

  if p_direccion = 'arriba' then
    select id, orden into v_vecino_id, v_vecino_orden
    from public.rutina_libre_ejercicio
    where rutina_libre_dia_id = v_dia and orden < v_orden
    order by orden desc
    limit 1;
  else
    select id, orden into v_vecino_id, v_vecino_orden
    from public.rutina_libre_ejercicio
    where rutina_libre_dia_id = v_dia and orden > v_orden
    order by orden asc
    limit 1;
  end if;

  if v_vecino_id is not null then
    update public.rutina_libre_ejercicio set orden = v_orden where id = v_vecino_id;
    update public.rutina_libre_ejercicio set orden = v_vecino_orden where id = p_ejercicio_id;
  end if;

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.mover_ejercicio_libre(uuid, text) from public;
grant execute on function public.mover_ejercicio_libre(uuid, text) to authenticated, service_role;
