-- Task D4: editar los ejercicios de una plantilla de rutina generada
-- (generar_plantilla_rutina). Hoy solo se podía REGENERAR entera; ahora se
-- puede agregar/editar/quitar ejercicios uno por uno, igual que la rutina de
-- un socio. plantilla_rutina_ejercicio NO tiene empresa_id propio, así que
-- cada RPC valida subiendo la cadena:
--   plantilla_rutina_ejercicio -> plantilla_rutina_dia -> plantilla_rutina.empresa_id
-- y la compara con auth_empresa_id(). Sin esto, un gym podría editar la
-- plantilla de otro gym con solo adivinar (o enumerar) un uuid.

create or replace function public.plantilla_agregar_ejercicio(
  p_plantilla_dia_id uuid, p_nombre text, p_series int, p_reps text, p_descanso text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := auth_empresa_id();
  v_emp_dia uuid;
  v_nombre text := trim(coalesce(p_nombre, ''));
  v_orden int;
  v_id uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if v_nombre = '' then raise exception 'El ejercicio necesita nombre'; end if;

  select pr.empresa_id into v_emp_dia
  from public.plantilla_rutina_dia prd
  join public.plantilla_rutina pr on pr.id = prd.plantilla_rutina_id
  where prd.id = p_plantilla_dia_id;

  if v_emp_dia is null or v_emp_dia is distinct from v_emp then
    raise exception 'día de plantilla no encontrado o sin acceso';
  end if;

  select coalesce(max(orden), 0) + 1 into v_orden
  from public.plantilla_rutina_ejercicio
  where plantilla_rutina_dia_id = p_plantilla_dia_id;

  insert into public.plantilla_rutina_ejercicio
    (plantilla_rutina_dia_id, nombre, series, reps, descanso, orden)
  values (p_plantilla_dia_id, v_nombre, p_series, p_reps, p_descanso, v_orden)
  returning id into v_id;

  return v_id;
end $$;
revoke all on function public.plantilla_agregar_ejercicio(uuid,text,int,text,text) from public;
grant execute on function public.plantilla_agregar_ejercicio(uuid,text,int,text,text) to authenticated, service_role;

create or replace function public.plantilla_editar_ejercicio(
  p_ejercicio_id uuid, p_nombre text, p_series int, p_reps text, p_descanso text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := auth_empresa_id();
  v_emp_ej uuid;
  v_nombre text := trim(coalesce(p_nombre, ''));
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if v_nombre = '' then raise exception 'El ejercicio necesita nombre'; end if;

  select pr.empresa_id into v_emp_ej
  from public.plantilla_rutina_ejercicio pre
  join public.plantilla_rutina_dia prd on prd.id = pre.plantilla_rutina_dia_id
  join public.plantilla_rutina pr on pr.id = prd.plantilla_rutina_id
  where pre.id = p_ejercicio_id;

  if v_emp_ej is null or v_emp_ej is distinct from v_emp then
    raise exception 'ejercicio de plantilla no encontrado o sin acceso';
  end if;

  update public.plantilla_rutina_ejercicio
     set nombre = v_nombre, series = p_series, reps = p_reps, descanso = p_descanso
   where id = p_ejercicio_id;
end $$;
revoke all on function public.plantilla_editar_ejercicio(uuid,text,int,text,text) from public;
grant execute on function public.plantilla_editar_ejercicio(uuid,text,int,text,text) to authenticated, service_role;

create or replace function public.plantilla_quitar_ejercicio(p_ejercicio_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := auth_empresa_id();
  v_emp_ej uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;

  select pr.empresa_id into v_emp_ej
  from public.plantilla_rutina_ejercicio pre
  join public.plantilla_rutina_dia prd on prd.id = pre.plantilla_rutina_dia_id
  join public.plantilla_rutina pr on pr.id = prd.plantilla_rutina_id
  where pre.id = p_ejercicio_id;

  if v_emp_ej is null or v_emp_ej is distinct from v_emp then
    raise exception 'ejercicio de plantilla no encontrado o sin acceso';
  end if;

  delete from public.plantilla_rutina_ejercicio where id = p_ejercicio_id;
end $$;
revoke all on function public.plantilla_quitar_ejercicio(uuid) from public;
grant execute on function public.plantilla_quitar_ejercicio(uuid) to authenticated, service_role;
