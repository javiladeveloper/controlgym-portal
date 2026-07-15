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
  v_zona text; v_i int;
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

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre)
  values (p_empresa_id, v_objetivo_id, 'Rutina ' || initcap(replace(p_objetivo_codigo,'_',' ')) || ' (' || p_dias || ' días)')
  returning id into v_plantilla;

  for v_i in 1..p_dias loop
    v_zona := v_zonas[1 + ((v_i - 1) % array_length(v_zonas,1))];
    insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
    values (v_plantilla, v_i, v_zona)
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
