-- Sube a 5 días las plantillas GLOBALES por defecto (antes 3-4) y les fija una
-- duración sugerida de 8 semanas.
--
-- Por qué (decisión del owner, 2026-07-19): más días de entrenamiento = más
-- gasto calórico y mejores resultados (sobre todo en bajar de peso), y
-- comercialmente = más razones para que el socio venga al gym = más adherencia
-- y renovación. Con 3 días, el socio que ya pagó no sabe qué hacer los otros
-- días de la semana.
--
-- Rehabilitación se queda en 2 días a propósito: subirla sería contraproducente
-- (y riesgoso) para alguien lesionado.
--
-- Es aditivo: se AÑADEN los días que faltan; los días ya existentes y sus
-- ejercicios no se tocan. Cada gym puede personalizar su propia plantilla
-- (copy-on-write) sin que esto le afecte.
do $$
declare
  v_pl uuid; v_obj text; v_dias_actuales int; v_meta int; v_dia uuid; v_n int;
  v_series int; v_reps text; v_descanso text;
  v_foco text; v_targets text[]; v_usados text[]; v_orden int; v_j int;
  rec_ej record;
  metas text[][] := array[
    ['bajar_peso','5'], ['ganar_masa','5'], ['tonificar','5'], ['fuerza','5'],
    ['resistencia','5'], ['salud_general','5'], ['prep_deportiva','5']
  ];
  i int;
begin
  for i in 1..array_length(metas,1) loop
    v_obj := metas[i][1];
    v_meta := metas[i][2]::int;

    select pr.id into v_pl
    from public.plantilla_rutina pr
    join public.objetivo_entrenamiento o on o.id = pr.objetivo_id
    where pr.empresa_id is null and o.codigo = v_obj
    limit 1;
    continue when v_pl is null;

    select count(*) into v_dias_actuales
    from public.plantilla_rutina_dia where plantilla_rutina_id = v_pl;
    continue when v_dias_actuales >= v_meta;

    case v_obj
      when 'ganar_masa' then v_series:=4; v_reps:='8-12'; v_descanso:='90s';
      when 'fuerza'     then v_series:=5; v_reps:='3-5';  v_descanso:='2-3 min';
      when 'resistencia'then v_series:=3; v_reps:='15-20';v_descanso:='30s';
      when 'bajar_peso' then v_series:=3; v_reps:='12-15';v_descanso:='45s';
      when 'tonificar'  then v_series:=3; v_reps:='12-15';v_descanso:='45s';
      else v_series:=3; v_reps:='10-12'; v_descanso:='60s';
    end case;

    for v_n in (v_dias_actuales + 1)..v_meta loop
      if v_obj in ('ganar_masa','fuerza') then
        case ((v_n - 1) % 5)
          when 0 then v_foco := 'Pecho';   v_targets := array['pectorals','serratus anterior'];
          when 1 then v_foco := 'Espalda'; v_targets := array['lats','upper back','traps'];
          when 2 then v_foco := 'Pierna';  v_targets := array['glutes','quads','hamstrings','calves'];
          when 3 then v_foco := 'Hombro';  v_targets := array['delts'];
          else        v_foco := 'Brazo';   v_targets := array['biceps','triceps','forearms'];
        end case;
      elsif v_obj = 'resistencia' then
        case ((v_n - 1) % 5)
          when 0 then v_foco := 'Cardio continuo + core';   v_targets := array['cardiovascular system','abs'];
          when 1 then v_foco := 'Circuito HIIT';            v_targets := array['cardiovascular system','quads','glutes'];
          when 2 then v_foco := 'Remo + circuito';          v_targets := array['upper back','lats','cardiovascular system'];
          when 3 then v_foco := 'Bicicleta + core';         v_targets := array['cardiovascular system','abs'];
          else        v_foco := 'Cardio mixto + fullbody';  v_targets := array['cardiovascular system','pectorals','quads'];
        end case;
      else
        case ((v_n - 1) % 5)
          when 0 then v_foco := 'Full body A + cardio'; v_targets := array['pectorals','lats','quads','glutes','abs'];
          when 1 then v_foco := 'Full body B + cardio'; v_targets := array['upper back','delts','hamstrings','glutes','abs'];
          when 2 then v_foco := 'Full body C + cardio'; v_targets := array['pectorals','biceps','triceps','quads','abs'];
          when 3 then v_foco := 'Full body D + cardio'; v_targets := array['lats','delts','glutes','calves','abs'];
          else        v_foco := 'Full body E + cardio'; v_targets := array['pectorals','upper back','quads','hamstrings','abs'];
        end case;
      end if;

      insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
      values (v_pl, v_n, v_foco)
      returning id into v_dia;

      -- ejercicios del catálogo global, priorizando peso corporal (la plantilla
      -- global no conoce el equipo de ningún gym; al personalizarla sí se filtra)
      v_usados := array[]::text[];
      for v_j in 1..array_length(v_targets,1) loop
        for rec_ej in
          select coalesce(c.nombre_es, c.nombre) as nombre
          from public.ejercicio_catalogo c
          where c.activo and c.target = v_targets[v_j]
            and coalesce(c.nombre_es, c.nombre) <> all (v_usados)
          order by (c.equipment = 'body weight') desc, random()
          limit greatest(1, 6 / array_length(v_targets,1))
        loop
          v_usados := v_usados || rec_ej.nombre;
        end loop;
      end loop;

      v_orden := 0;
      for v_j in 1..coalesce(array_length(v_usados,1),0) loop
        v_orden := v_orden + 1;
        insert into public.plantilla_rutina_ejercicio
          (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, orden)
        values (v_dia, null, v_usados[v_j], v_series, v_reps, v_descanso, v_orden);
      end loop;
    end loop;

    -- duración sugerida por defecto: 8 semanas (mesociclo estándar)
    update public.plantilla_rutina
       set duracion_semanas = coalesce(duracion_semanas, 8)
     where id = v_pl;
  end loop;
end $$;
