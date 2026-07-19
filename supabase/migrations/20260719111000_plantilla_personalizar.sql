-- Copy-on-write de plantillas: editar una plantilla GLOBAL crea la copia del gym
-- y se edita esa. La global (empresa_id is null) es inmutable y compartida por
-- todos los gyms del SaaS. Idempotente: si el gym ya tiene su plantilla para ese
-- objetivo+tipo, la devuelve en vez de duplicar.
create or replace function public.plantilla_personalizar(p_plantilla_id uuid, p_tipo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_objetivo uuid;
  v_nombre text;
  v_notas text;
  v_suplementos text;
  v_duracion int;
  v_es_global boolean;
  v_nueva uuid;
  v_dia record;
  v_nuevo_dia uuid;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() then raise exception 'Solo el administrador puede personalizar plantillas'; end if;
  if p_tipo not in ('rutina','dieta') then raise exception 'Tipo inválido'; end if;

  if p_tipo = 'rutina' then
    select objetivo_id, nombre, notas, duracion_semanas, (empresa_id is null)
      into v_objetivo, v_nombre, v_notas, v_duracion, v_es_global
    from public.plantilla_rutina
    where id = p_plantilla_id and (empresa_id is null or empresa_id = v_emp);
    if v_objetivo is null then raise exception 'plantilla no encontrada o sin acceso'; end if;

    -- ya es del gym → nada que copiar
    if not v_es_global then return p_plantilla_id; end if;

    -- idempotente: ¿el gym ya tiene la suya para este objetivo?
    select id into v_nueva from public.plantilla_rutina
    where empresa_id = v_emp and objetivo_id = v_objetivo limit 1;
    if v_nueva is not null then return v_nueva; end if;

    insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas, duracion_semanas)
    values (v_emp, v_objetivo, v_nombre, v_notas, v_duracion)
    returning id into v_nueva;

    -- copiar días y sus ejercicios
    for v_dia in
      select id, dia_semana, foco from public.plantilla_rutina_dia
      where plantilla_rutina_id = p_plantilla_id order by dia_semana
    loop
      insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
      values (v_nueva, v_dia.dia_semana, v_dia.foco)
      returning id into v_nuevo_dia;

      insert into public.plantilla_rutina_ejercicio
        (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden, notas)
      select v_nuevo_dia, ejercicio_id, nombre, series, reps, descanso, carga, orden, notas
      from public.plantilla_rutina_ejercicio
      where plantilla_rutina_dia_id = v_dia.id
      order by orden;
    end loop;

    return v_nueva;
  end if;

  -- dieta
  select objetivo_id, nombre, suplementos, duracion_semanas, (empresa_id is null)
    into v_objetivo, v_nombre, v_suplementos, v_duracion, v_es_global
  from public.plantilla_dieta
  where id = p_plantilla_id and (empresa_id is null or empresa_id = v_emp);
  if v_objetivo is null then raise exception 'plantilla no encontrada o sin acceso'; end if;

  if not v_es_global then return p_plantilla_id; end if;

  select id into v_nueva from public.plantilla_dieta
  where empresa_id = v_emp and objetivo_id = v_objetivo limit 1;
  if v_nueva is not null then return v_nueva; end if;

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos, duracion_semanas)
  values (v_emp, v_objetivo, v_nombre, v_suplementos, v_duracion)
  returning id into v_nueva;

  insert into public.plantilla_comida
    (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana)
  select v_nueva, nombre, hora, descripcion, kcal, orden, dia_semana
  from public.plantilla_comida
  where plantilla_dieta_id = p_plantilla_id
  order by dia_semana nulls first, orden;

  return v_nueva;
end $$;

revoke all on function public.plantilla_personalizar(uuid, text) from public, authenticated;
grant execute on function public.plantilla_personalizar(uuid, text) to authenticated;

-- Fija la duración sugerida. Solo sobre una plantilla DEL GYM (el panel llama
-- antes a plantilla_personalizar si era global).
create or replace function public.plantilla_set_duracion(p_plantilla_id uuid, p_tipo text, p_semanas int)
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
  if not public.auth_is_admin() then raise exception 'Solo el administrador puede cambiar la duración'; end if;
  if p_tipo not in ('rutina','dieta') then raise exception 'Tipo inválido'; end if;
  if p_semanas is not null and p_semanas not in (4,8,12,16) then
    raise exception 'Duración inválida (usa 4, 8, 12 o 16 semanas)';
  end if;

  if p_tipo = 'rutina' then
    update public.plantilla_rutina set duracion_semanas = p_semanas
    where id = p_plantilla_id and empresa_id = v_emp;
  else
    update public.plantilla_dieta set duracion_semanas = p_semanas
    where id = p_plantilla_id and empresa_id = v_emp;
  end if;

  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'plantilla no encontrada o sin acceso (¿es global?)'; end if;
end $$;

revoke all on function public.plantilla_set_duracion(uuid, text, int) from public, authenticated;
grant execute on function public.plantilla_set_duracion(uuid, text, int) to authenticated;
