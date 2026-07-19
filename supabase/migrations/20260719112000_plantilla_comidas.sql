-- Edición de comidas de la plantilla de dieta del gym. Espejo de las RPCs de
-- ejercicio. La plantilla global es inmutable: se valida que la dieta destino
-- tenga empresa_id = empresa del llamante (el panel personaliza antes si era global).
-- p_hora entra como text ('08:00') y se castea a time (la columna es time).
create or replace function public.plantilla_comida_agregar(
  p_plantilla_dieta_id uuid, p_nombre text, p_hora text,
  p_descripcion text, p_kcal int, p_dia_semana int)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_ok boolean;
  v_orden int;
  v_id uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'La comida necesita un nombre'; end if;

  select true into v_ok from public.plantilla_dieta
  where id = p_plantilla_dieta_id and empresa_id = v_emp;
  if not coalesce(v_ok,false) then raise exception 'plantilla no encontrada o sin acceso (¿es global?)'; end if;

  select coalesce(max(orden),0)+1 into v_orden from public.plantilla_comida
  where plantilla_dieta_id = p_plantilla_dieta_id
    and dia_semana is not distinct from p_dia_semana;

  insert into public.plantilla_comida
    (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana)
  values (p_plantilla_dieta_id, trim(p_nombre), nullif(p_hora,'')::time,
          p_descripcion, p_kcal, v_orden, p_dia_semana)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.plantilla_comida_editar(
  p_comida_id uuid, p_nombre text, p_hora text, p_descripcion text, p_kcal int)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_n int;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'La comida necesita un nombre'; end if;

  update public.plantilla_comida c
     set nombre = trim(p_nombre), hora = nullif(p_hora,'')::time,
         descripcion = p_descripcion, kcal = p_kcal
   where c.id = p_comida_id
     and exists (select 1 from public.plantilla_dieta d
                  where d.id = c.plantilla_dieta_id and d.empresa_id = v_emp);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'comida no encontrada o sin acceso (¿es global?)'; end if;
end $$;

create or replace function public.plantilla_comida_quitar(p_comida_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_n int;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador'; end if;

  delete from public.plantilla_comida c
   where c.id = p_comida_id
     and exists (select 1 from public.plantilla_dieta d
                  where d.id = c.plantilla_dieta_id and d.empresa_id = v_emp);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'comida no encontrada o sin acceso (¿es global?)'; end if;
end $$;

revoke all on function public.plantilla_comida_agregar(uuid, text, text, text, int, int) from public, authenticated;
revoke all on function public.plantilla_comida_editar(uuid, text, text, text, int) from public, authenticated;
revoke all on function public.plantilla_comida_quitar(uuid) from public, authenticated;
grant execute on function public.plantilla_comida_agregar(uuid, text, text, text, int, int) to authenticated;
grant execute on function public.plantilla_comida_editar(uuid, text, text, text, int) to authenticated;
grant execute on function public.plantilla_comida_quitar(uuid) to authenticated;
