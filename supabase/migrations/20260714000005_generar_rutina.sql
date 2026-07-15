-- Genera una plantilla de rutina editable a partir de un objetivo. Reparte
-- ejercicios del catálogo por zona (body_part) según el nº de días y aplica
-- series/reps/descanso por defecto según el objetivo. Respeta el equipo de sede.
create or replace function public.generar_plantilla_rutina(
  p_empresa_id uuid, p_sede_id uuid, p_objetivo_codigo text, p_dias int default 3)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_objetivo_id uuid;
  v_plantilla uuid;
  v_dia uuid;
  v_zonas text[] := array['chest','back','upper legs','shoulders','upper arms','waist'];
  v_series int; v_reps text; v_descanso text; v_por_dia int := 5;
  v_zona text; v_i int; v_dia_num int; v_cnt int; v_nombre text;
begin
  -- Resolver el objetivo (codigo -> id).
  select id into v_objetivo_id
  from public.objetivo_entrenamiento
  where codigo = p_objetivo_codigo;

  if v_objetivo_id is null then
    raise exception 'objetivo inválido';
  end if;

  -- Parámetros por objetivo (enfoque del entrenamiento).
  case p_objetivo_codigo
    when 'ganar_masa' then v_series:=4; v_reps:='8-12'; v_descanso:='90s';
    when 'fuerza'     then v_series:=5; v_reps:='3-5';  v_descanso:='2-3 min';
    when 'resistencia'then v_series:=3; v_reps:='15-20';v_descanso:='30s';
    when 'bajar_peso' then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    when 'tonificar'  then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    else v_series:=3; v_reps:='10-12'; v_descanso:='60s';
  end case;

  v_nombre := 'Rutina ' || initcap(replace(p_objetivo_codigo,'_',' ')) || ' (' || p_dias || ' días)';

  -- FIX 1: upsert por objetivo (uq_plantilla_rutina_objetivo es único por
  -- objetivo_id + empresa_id). Si ya existe la plantilla del objetivo,
  -- reutilizarla y regenerar sus días en vez de fallar con duplicate key.
  select id into v_plantilla
  from public.plantilla_rutina
  where objetivo_id = v_objetivo_id
    and coalesce(empresa_id,'00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_empresa_id,'00000000-0000-0000-0000-000000000000'::uuid)
  limit 1;

  if v_plantilla is not null then
    delete from public.plantilla_rutina_ejercicio
    where plantilla_rutina_dia_id in (
      select id from public.plantilla_rutina_dia where plantilla_rutina_id = v_plantilla
    );
    delete from public.plantilla_rutina_dia where plantilla_rutina_id = v_plantilla;
    update public.plantilla_rutina set nombre = v_nombre where id = v_plantilla;
  else
    insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre)
    values (p_empresa_id, v_objetivo_id, v_nombre)
    returning id into v_plantilla;
  end if;

  -- FIX 2: no crear días vacíos. Se cuenta primero cuántos ejercicios de la
  -- zona pasan el filtro de equipo de sede; si son 0, se omite el día. Los
  -- días sí creados se numeran secuencialmente con v_dia_num.
  v_dia_num := 0;
  for v_i in 1..p_dias loop
    v_zona := v_zonas[1 + ((v_i - 1) % array_length(v_zonas,1))];

    select count(*) into v_cnt
    from public.ejercicio_catalogo c
    where c.activo and c.body_part = v_zona
      and (c.equipment = 'body weight'
           or c.equipment in (select equipment from public.sede_equipo where sede_id = p_sede_id and disponible)
           or not exists (select 1 from public.sede_equipo where sede_id = p_sede_id));

    if v_cnt = 0 then
      continue;
    end if;

    v_dia_num := v_dia_num + 1;

    insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
    values (v_plantilla, v_dia_num, v_zona)
    returning id into v_dia;

    insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, orden)
    select v_dia, null, coalesce(c.nombre_es, c.nombre), v_series, v_reps, v_descanso,
           row_number() over ()
    from (
      select c.nombre, c.nombre_es
      from public.ejercicio_catalogo c
      where c.activo and c.body_part = v_zona
        and (c.equipment = 'body weight'
             or c.equipment in (select equipment from public.sede_equipo where sede_id = p_sede_id and disponible)
             or not exists (select 1 from public.sede_equipo where sede_id = p_sede_id))
      order by random()
      limit v_por_dia
    ) c;
  end loop;

  return v_plantilla;
end $$;
revoke all on function public.generar_plantilla_rutina(uuid,uuid,text,int) from public;
grant execute on function public.generar_plantilla_rutina(uuid,uuid,text,int) to authenticated, service_role;
