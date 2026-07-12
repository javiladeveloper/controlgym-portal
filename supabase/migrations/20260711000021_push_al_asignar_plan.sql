-- El plan asignado por plantilla ya nacia "enviado" a la app (enviado_at),
-- pero no avisaba por push al socio como si lo hace el boton "Enviar a la
-- app". Se iguala: si el socio tiene cuenta en la app, push automatico.
-- (Al inscribir, el socio aun no tiene usuario_id => no aplica y no molesta.)

CREATE OR REPLACE FUNCTION public.asignar_plan_automatico(p_socio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_socio public.socio; v_obj public.objetivo_entrenamiento;
  v_imc numeric; v_cat text; v_factor numeric := 1.0;
  v_pr uuid; v_pd uuid; v_rut uuid; v_die uuid;
  v_nota text := 'Plan sugerido según tu objetivo e IMC. Consulta a tu entrenador; no reemplaza indicación médica.';
  v_nota_imc text := ''; v_carga_suave boolean := false;
  v_dia record; v_new_dia uuid; v_kcal_dia int := 0;
begin
  select * into v_socio from public.socio where id = p_socio_id;
  if v_socio.id is null then return jsonb_build_object('asignado', false, 'motivo', 'socio_inexistente'); end if;
  if v_socio.objetivo_id is null then return jsonb_build_object('asignado', false, 'motivo', 'sin_objetivo'); end if;
  select * into v_obj from public.objetivo_entrenamiento where id = v_socio.objetivo_id;
  if not coalesce(v_obj.tiene_plan, false) then return jsonb_build_object('asignado', false, 'motivo', 'objetivo_sin_plan'); end if;
  if coalesce(v_socio.peso_kg,0) <= 0 or coalesce(v_socio.talla_m,0) <= 0 then
    return jsonb_build_object('asignado', false, 'motivo', 'sin_peso_talla'); end if;

  v_imc := round(v_socio.peso_kg / (v_socio.talla_m * v_socio.talla_m), 1);
  v_cat := case when v_imc < 18.5 then 'bajo_peso' when v_imc < 25 then 'normal'
                when v_imc < 30 then 'sobrepeso' when v_imc < 35 then 'obesidad_1'
                when v_imc < 40 then 'obesidad_2' else 'obesidad_3' end;

  v_factor := case v_cat
    when 'bajo_peso' then 1.15
    when 'normal' then case v_obj.codigo when 'bajar_peso' then 0.85 when 'ganar_masa' then 1.15 else 1.0 end
    when 'sobrepeso' then 0.80 when 'obesidad_1' then 0.75 else 0.70 end;
  if v_cat in ('obesidad_2','obesidad_3') then
    v_nota_imc := ' Arranque progresivo: prioriza cardio de bajo impacto y cargas suaves las primeras semanas para proteger tus articulaciones.';
    v_carga_suave := true;
  end if;

  -- Idempotencia: no duplicar si ya tiene rutina activa
  if exists (select 1 from public.rutina where socio_id = p_socio_id and activa) then
    return jsonb_build_object('asignado', false, 'motivo', 'ya_tiene_plan');
  end if;

  -- Plantilla del gym o global (prefiere la del gym)
  select id into v_pr from public.plantilla_rutina where objetivo_id=v_obj.id and (empresa_id=v_socio.empresa_id or empresa_id is null) order by empresa_id nulls last limit 1;
  select id into v_pd from public.plantilla_dieta  where objetivo_id=v_obj.id and (empresa_id=v_socio.empresa_id or empresa_id is null) order by empresa_id nulls last limit 1;

  -- Copiar RUTINA
  if v_pr is not null then
    insert into public.rutina (empresa_id, socio_id, nombre, objetivo, activa, enviado_at, notas)
      values (v_socio.empresa_id, p_socio_id, v_obj.nombre || ' — plan', v_obj.nombre, true, now(), v_nota || v_nota_imc)
      returning id into v_rut;
    for v_dia in select * from public.plantilla_rutina_dia where plantilla_rutina_id=v_pr order by dia_semana loop
      insert into public.rutina_dia (empresa_id, rutina_id, dia_semana, foco)
        values (v_socio.empresa_id, v_rut, v_dia.dia_semana, v_dia.foco) returning id into v_new_dia;
      insert into public.rutina_ejercicio (empresa_id, rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden, notas)
        select v_socio.empresa_id, v_new_dia, e.ejercicio_id, e.nombre, e.series, e.reps, e.descanso,
               case when v_carga_suave and e.carga not ilike '%corporal%' and e.carga not ilike '%cardio%' and e.carga not ilike '%ritmo%' then 'Suave / progresiva' else e.carga end,
               e.orden, e.notas
        from public.plantilla_rutina_ejercicio e where e.plantilla_rutina_dia_id = v_dia.id;
    end loop;
  end if;

  -- Copiar DIETA con kcal moduladas
  if v_pd is not null then
    insert into public.dieta (empresa_id, socio_id, nombre, activa, enviado_at, suplementos)
      select v_socio.empresa_id, p_socio_id, v_obj.nombre || ' — nutrición', true, now(), suplementos
      from public.plantilla_dieta where id=v_pd returning id into v_die;
    insert into public.comida (empresa_id, dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana)
      select v_socio.empresa_id, v_die, nombre, hora, descripcion, round(coalesce(kcal,0) * v_factor)::int, orden, dia_semana
      from public.plantilla_comida where plantilla_dieta_id=v_pd;
    select coalesce(sum(kcal),0) into v_kcal_dia from public.comida where dieta_id=v_die and coalesce(dia_semana,1)=1;
    if v_kcal_dia = 0 then select coalesce(sum(kcal),0) into v_kcal_dia from public.comida where dieta_id=v_die; end if;
  end if;

  -- El plan nace "enviado" (enviado_at) y, si el socio ya usa la app, se le
  -- avisa por push — igual que el boton "Enviar a la app" del panel. Asi la
  -- asignacion automatica no necesita ningun paso manual extra.
  if v_socio.usuario_id is not null then
    perform public.encolar_push(v_socio.usuario_id, 'Tu entrenador te preparó un plan 💪',
      'Ya puedes ver tu nueva rutina y alimentación en la app. ¡A entrenar!',
      jsonb_build_object('tipo','plan_enviado'));
  end if;

  return jsonb_build_object('asignado', true, 'objetivo', v_obj.nombre, 'imc', v_imc,
    'categoria', v_cat, 'rutina_dias', (select count(*) from public.rutina_dia where rutina_id=v_rut),
    'dieta_kcal_dia', v_kcal_dia);
end;
$function$;
