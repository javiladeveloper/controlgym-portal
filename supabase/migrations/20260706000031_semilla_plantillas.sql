-- Semilla de plantillas globales (empresa_id null): 8 rutinas + 8 dietas, una por
-- objetivo de entrenamiento. Contenido de fitness/nutrición real y coherente al
-- objetivo. Idempotente: borra las plantillas globales previas antes de insertar
-- (el on delete cascade limpia días/ejercicios/comidas asociadas).

do $$
declare
  v_obj uuid;
  v_pr uuid;
  v_dia uuid;
  v_pd uuid;
begin
  delete from public.plantilla_rutina where empresa_id is null;
  delete from public.plantilla_dieta  where empresa_id is null;

  -- ======================================================================
  -- 1) BAJAR DE PESO — fullbody + cardio, reps altas, descansos cortos
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'bajar_peso';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Bajar de peso — plan base',
    'Fullbody 3x/semana con circuitos y cardio para maximizar el gasto calórico; descansos cortos para mantener el pulso alto.')
  returning id into v_pr;

  -- Día 1 - Lunes: Fullbody A + cardio
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 1, 'Fullbody A + cardio') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla libre' limit 1), 'Sentadilla libre', 3, '15', '45 seg', 'peso corporal', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Flexiones de pecho' limit 1), 'Flexiones de pecho', 3, '12', '45 seg', 'peso corporal', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo con mancuerna' limit 1), 'Remo con mancuerna', 3, '15', '45 seg', 'moderada', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Zancadas caminando' limit 1), 'Zancadas caminando', 3, '12 por pierna', '45 seg', 'peso corporal o ligera', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Salto de soga' limit 1), 'Salto de soga', 3, '1 min', '30 seg', '-', 5),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha' and nombre not ilike '%lateral%' limit 1), 'Plancha', 3, '30-40 seg', '30 seg', '-', 6);

  -- Día 2 - Miércoles: Fullbody B + cardio
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 3, 'Fullbody B + cardio') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Peso muerto rumano' limit 1), 'Peso muerto rumano', 3, '15', '45 seg', 'ligera-moderada', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press con mancuernas' limit 1), 'Press con mancuernas', 3, '12', '45 seg', 'moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Jalón al pecho' limit 1), 'Jalón al pecho', 3, '15', '45 seg', 'moderada', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Mountain climbers' limit 1), 'Mountain climbers', 3, '40 seg', '30 seg', '-', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Burpees' limit 1), 'Burpees', 3, '10', '40 seg', '-', 5),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Crunch abdominal' limit 1), 'Crunch abdominal', 3, '20', '30 seg', '-', 6);

  -- Día 3 - Viernes: Fullbody C + cardio
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 5, 'Fullbody C + cardio') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Prensa de piernas' limit 1), 'Prensa de piernas', 3, '15', '45 seg', 'moderada', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo en polea baja' limit 1), 'Remo en polea baja', 3, '15', '45 seg', 'moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevaciones laterales' limit 1), 'Elevaciones laterales', 3, '15', '30 seg', 'ligera', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Hip thrust' limit 1), 'Hip thrust', 3, '15', '45 seg', 'moderada', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Trotadora' and nombre not ilike '%ProRun%' limit 1), 'Trotadora', 1, '15-20 min', '-', 'ritmo moderado', 5),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Russian twist' limit 1), 'Russian twist', 3, '20', '30 seg', '-', 6);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Bajar de peso — nutrición base',
    'Opcional: proteína en polvo para completar requerimiento proteico sin sumar muchas calorías.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Avena con leche descremada, plátano y un huevo sancochado', 420, 1),
    (v_pd, 'Media mañana', '10:00', 'Yogurt natural con una fruta (manzana o papaya)', 180, 2),
    (v_pd, 'Almuerzo', '13:00', 'Pechuga de pollo a la plancha, ensalada fresca y medio plato de arroz integral', 580, 3),
    (v_pd, 'Snack', '16:30', 'Puñado de frutos secos y una fruta', 200, 4),
    (v_pd, 'Cena', '20:00', 'Pescado al horno con verduras salteadas y quinua', 520, 5);

  -- ======================================================================
  -- 2) GANAR MASA MUSCULAR — hipertrofia, split 4 días
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'ganar_masa';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Ganar masa muscular — plan base',
    'Split de 4 días (pecho/espalda/pierna/hombro-brazo) con rango de hipertrofia 8-12 reps y cargas progresivas.')
  returning id into v_pr;

  -- Día 1 - Lunes: Pecho + tríceps
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 1, 'Pecho + tríceps') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press banca plano' limit 1), 'Press banca plano', 4, '8-10', '90 seg', 'alta', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press banca inclinado' limit 1), 'Press banca inclinado', 4, '8-10', '90 seg', 'alta', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Aperturas con mancuernas' limit 1), 'Aperturas con mancuernas', 3, '10-12', '60 seg', 'moderada', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Fondos en paralelas' limit 1), 'Fondos en paralelas', 3, '8-10', '75 seg', 'peso corporal/lastre', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Extensión de tríceps en polea' limit 1), 'Extensión de tríceps en polea', 3, '10-12', '60 seg', 'moderada', 5);

  -- Día 2 - Martes: Espalda + bíceps
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 2, 'Espalda + bíceps') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Peso muerto' and nombre not ilike '%rumano%' limit 1), 'Peso muerto', 4, '6-8', '2 min', 'alta', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Dominadas' limit 1), 'Dominadas', 4, '8-10', '90 seg', 'peso corporal/lastre', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo con barra' limit 1), 'Remo con barra', 4, '8-10', '90 seg', 'alta', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Curl de bíceps con barra' limit 1), 'Curl de bíceps con barra', 3, '10-12', '60 seg', 'moderada', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Curl martillo' limit 1), 'Curl martillo', 3, '10-12', '60 seg', 'moderada', 5);

  -- Día 3 - Jueves: Pierna
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 4, 'Pierna') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla con barra' limit 1), 'Sentadilla con barra', 4, '8-10', '2 min', 'alta', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Prensa de piernas' limit 1), 'Prensa de piernas', 4, '10-12', '90 seg', 'alta', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Peso muerto rumano' limit 1), 'Peso muerto rumano', 3, '10-12', '90 seg', 'moderada-alta', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Curl femoral' limit 1), 'Curl femoral', 3, '10-12', '60 seg', 'moderada', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevación de talones' limit 1), 'Elevación de talones', 4, '15', '45 seg', 'moderada', 5);

  -- Día 4 - Sábado: Hombro + brazo
  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 6, 'Hombro + brazo') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press militar' and nombre not ilike '%mancuernas%' limit 1), 'Press militar', 4, '8-10', '90 seg', 'alta', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevaciones laterales' limit 1), 'Elevaciones laterales', 4, '12-15', '45 seg', 'ligera-moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Pájaros%' limit 1), 'Pájaros (posterior)', 3, '12-15', '45 seg', 'ligera', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press francés' limit 1), 'Press francés', 3, '10-12', '60 seg', 'moderada', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Curl alterno con mancuernas' limit 1), 'Curl alterno con mancuernas', 3, '10-12', '60 seg', 'moderada', 5);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Ganar masa muscular — nutrición base',
    'Proteína en polvo post-entreno y creatina monohidrato (5g/día) para apoyar la ganancia de fuerza y masa magra.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Pan integral con huevos revueltos, palta y jugo de fruta natural', 620, 1),
    (v_pd, 'Media mañana', '10:00', 'Batido de proteína con avena y plátano', 400, 2),
    (v_pd, 'Almuerzo', '13:00', 'Lomo saltado con arroz y papas doradas al horno', 750, 3),
    (v_pd, 'Snack', '16:30', 'Sándwich de pollo con queso y frutos secos', 380, 4),
    (v_pd, 'Cena', '20:00', 'Pescado o carne magra con arroz, menestra y ensalada', 650, 5);

  -- ======================================================================
  -- 3) TONIFICAR — circuitos, reps medias-altas, fullbody 3 días
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'tonificar';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Tonificar — plan base',
    'Circuitos fullbody 3x/semana en rango medio-alto de repeticiones para definir y mantener masa muscular sin buscar volumen extremo.')
  returning id into v_pr;

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 1, 'Circuito A tren superior') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press con mancuernas' limit 1), 'Press con mancuernas', 3, '12-15', '45 seg', 'moderada', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo con mancuerna' limit 1), 'Remo con mancuerna', 3, '12-15', '45 seg', 'moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevaciones frontales' limit 1), 'Elevaciones frontales', 3, '12-15', '30 seg', 'ligera', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Fondos de tríceps en banco' limit 1), 'Fondos de tríceps en banco', 3, '12-15', '45 seg', 'peso corporal', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha' and nombre not ilike '%lateral%' limit 1), 'Plancha', 3, '40 seg', '30 seg', '-', 5);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 3, 'Circuito B tren inferior') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla libre' limit 1), 'Sentadilla libre', 3, '15-18', '45 seg', 'peso corporal/ligera', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Zancadas con mancuernas' limit 1), 'Zancadas con mancuernas', 3, '12 por pierna', '45 seg', 'ligera', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Hip thrust' limit 1), 'Hip thrust', 3, '15', '45 seg', 'moderada', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevación de talones' limit 1), 'Elevación de talones', 3, '18-20', '30 seg', 'moderada', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Russian twist' limit 1), 'Russian twist', 3, '20', '30 seg', '-', 5);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 5, 'Circuito C fullbody + cardio') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Jalón al pecho' limit 1), 'Jalón al pecho', 3, '12-15', '45 seg', 'moderada', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Prensa de piernas' limit 1), 'Prensa de piernas', 3, '15', '45 seg', 'moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevaciones laterales' limit 1), 'Elevaciones laterales', 3, '15', '30 seg', 'ligera', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Mountain climbers' limit 1), 'Mountain climbers', 3, '40 seg', '30 seg', '-', 4),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Bicicleta estacionaria' limit 1), 'Bicicleta estacionaria', 1, '15 min', '-', 'ritmo moderado', 5);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Tonificar — nutrición base',
    'Opcional: proteína en polvo como snack post-entreno si cuesta llegar al requerimiento proteico diario.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Tostadas integrales con palta y huevo, más una fruta', 430, 1),
    (v_pd, 'Media mañana', '10:00', 'Yogurt griego con granola', 220, 2),
    (v_pd, 'Almuerzo', '13:00', 'Pollo a la plancha con ensalada variada y arroz integral', 600, 3),
    (v_pd, 'Snack', '16:30', 'Fruta con un puñado de almendras', 200, 4),
    (v_pd, 'Cena', '20:00', 'Tortilla de verduras con ensalada y quinua', 540, 5);

  -- ======================================================================
  -- 4) FUERZA — 5x5, cargas altas, descansos largos, split 4 días
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'fuerza';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Fuerza — plan base',
    'Esquema 5x5 sobre los básicos (sentadilla, press banca, peso muerto, press militar) con descansos largos para maximizar carga movida.')
  returning id into v_pr;

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 1, 'Sentadilla + accesorios pierna') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla con barra' limit 1), 'Sentadilla con barra', 5, '5', '2-3 min', 'alta (85-90% 5RM)', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Prensa de piernas' limit 1), 'Prensa de piernas', 3, '6-8', '2 min', 'alta', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Peso muerto rumano' limit 1), 'Peso muerto rumano', 3, '6', '2 min', 'alta', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevación de talones' limit 1), 'Elevación de talones', 4, '8', '90 seg', 'alta', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 2, 'Press banca + empuje') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press banca plano' limit 1), 'Press banca plano', 5, '5', '2-3 min', 'alta (85-90% 5RM)', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press banca inclinado' limit 1), 'Press banca inclinado', 3, '6-8', '2 min', 'alta', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Fondos en paralelas' limit 1), 'Fondos en paralelas', 3, '6-8', '90 seg', 'lastre si es posible', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Extensión de tríceps en polea' limit 1), 'Extensión de tríceps en polea', 3, '8', '90 seg', 'moderada-alta', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 4, 'Peso muerto + tirón') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Peso muerto' and nombre not ilike '%rumano%' limit 1), 'Peso muerto', 5, '5', '2-3 min', 'alta (85-90% 5RM)', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo con barra' limit 1), 'Remo con barra', 4, '6', '2 min', 'alta', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Dominadas' limit 1), 'Dominadas', 4, '6-8', '2 min', 'lastre si es posible', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Curl de bíceps con barra' limit 1), 'Curl de bíceps con barra', 3, '8', '90 seg', 'moderada-alta', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 5, 'Press militar + hombro') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press militar' and nombre not ilike '%mancuernas%' limit 1), 'Press militar', 5, '5', '2-3 min', 'alta (85-90% 5RM)', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press Arnold' limit 1), 'Press Arnold', 3, '6-8', '2 min', 'alta', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Encogimientos de trapecio' limit 1), 'Encogimientos de trapecio', 4, '8', '90 seg', 'alta', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevaciones laterales' limit 1), 'Elevaciones laterales', 3, '10', '60 seg', 'moderada', 4);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Fuerza — nutrición base',
    'Creatina monohidrato (5g/día) y proteína en polvo post-entreno para sostener el rendimiento en las series pesadas.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Huevos revueltos con pan integral, palta y jugo natural', 600, 1),
    (v_pd, 'Media mañana', '10:00', 'Batido de proteína con avena y maní', 420, 2),
    (v_pd, 'Almuerzo', '13:00', 'Bistec a la plancha con arroz, frejoles y ensalada', 780, 3),
    (v_pd, 'Snack', '16:30', 'Sándwich de atún o pollo con fruta', 400, 4),
    (v_pd, 'Cena', '20:00', 'Pollo o pescado con camote y verduras salteadas', 600, 5);

  -- ======================================================================
  -- 5) RESISTENCIA / CARDIO — circuitos, alto volumen, poco descanso, 4 días
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'resistencia';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Resistencia / cardio — plan base',
    'Circuitos de alto volumen con descansos cortos combinando cardio continuo e intervalos para mejorar la capacidad aeróbica.')
  returning id into v_pr;

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 1, 'Cardio continuo + core') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Trotadora' and nombre not ilike '%ProRun%' limit 1), 'Trotadora', 1, '25-30 min', '-', 'ritmo constante moderado', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha' and nombre not ilike '%lateral%' limit 1), 'Plancha', 3, '45 seg', '20 seg', '-', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevación de piernas' limit 1), 'Elevación de piernas', 3, '15', '20 seg', '-', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Russian twist' limit 1), 'Russian twist', 3, '25', '20 seg', '-', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 2, 'Circuito HIIT') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Burpees' limit 1), 'Burpees', 4, '45 seg', '15 seg', '-', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Salto de soga' limit 1), 'Salto de soga', 4, '45 seg', '15 seg', '-', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Mountain climbers' limit 1), 'Mountain climbers', 4, '45 seg', '15 seg', '-', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Zancadas caminando' limit 1), 'Zancadas caminando', 4, '45 seg', '15 seg', 'peso corporal', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 4, 'Remo ergómetro + circuito') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo ergómetro' limit 1), 'Remo ergómetro', 5, '3 min', '1 min', 'ritmo sostenido', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla libre' limit 1), 'Sentadilla libre', 3, '20', '20 seg', 'peso corporal', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Flexiones de pecho' limit 1), 'Flexiones de pecho', 3, '15', '20 seg', 'peso corporal', 3);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 6, 'Bicicleta + core resistencia') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Bicicleta estacionaria' limit 1), 'Bicicleta estacionaria', 1, '30 min', '-', 'intervalos moderados/altos', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Rueda abdominal' limit 1), 'Rueda abdominal', 3, '12', '30 seg', '-', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha lateral' limit 1), 'Plancha lateral', 3, '30 seg por lado', '20 seg', '-', 3);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Resistencia / cardio — nutrición base',
    'Hidratación con electrolitos en sesiones largas y carbohidratos de fácil digestión antes de entrenar.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Avena con fruta picada y miel, más un huevo sancochado', 480, 1),
    (v_pd, 'Media mañana', '10:00', 'Plátano con un puñado de pasas', 200, 2),
    (v_pd, 'Almuerzo', '13:00', 'Pollo o pescado con arroz, camote y ensalada', 650, 3),
    (v_pd, 'Snack', '16:30', 'Yogurt con granola y fruta', 250, 4),
    (v_pd, 'Cena', '20:00', 'Pasta integral con pollo desmenuzado y vegetales salteados', 620, 5);

  -- ======================================================================
  -- 6) SALUD GENERAL — equilibrado, moderado, fullbody 3 días
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'salud_general';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Salud general — plan base',
    'Entrenamiento fullbody moderado 3x/semana combinando fuerza básica, movilidad y cardio ligero para mantener buena forma física.')
  returning id into v_pr;

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 1, 'Fullbody A moderado') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla libre' limit 1), 'Sentadilla libre', 3, '12', '60 seg', 'peso corporal/ligera', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press con mancuernas' limit 1), 'Press con mancuernas', 3, '12', '60 seg', 'ligera-moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo con mancuerna' limit 1), 'Remo con mancuerna', 3, '12', '60 seg', 'ligera-moderada', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha' and nombre not ilike '%lateral%' limit 1), 'Plancha', 3, '30 seg', '30 seg', '-', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 3, 'Fullbody B moderado') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Zancadas caminando' limit 1), 'Zancadas caminando', 3, '10 por pierna', '60 seg', 'peso corporal', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Jalón al pecho' limit 1), 'Jalón al pecho', 3, '12', '60 seg', 'moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevaciones laterales' limit 1), 'Elevaciones laterales', 3, '12', '45 seg', 'ligera', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Crunch abdominal' limit 1), 'Crunch abdominal', 3, '15', '30 seg', '-', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 5, 'Fullbody C + cardio ligero') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Prensa de piernas' limit 1), 'Prensa de piernas', 3, '12', '60 seg', 'moderada', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo en polea baja' limit 1), 'Remo en polea baja', 3, '12', '60 seg', 'moderada', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Puente de glúteo' limit 1), 'Puente de glúteo', 3, '15', '45 seg', 'peso corporal', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Bicicleta estacionaria' limit 1), 'Bicicleta estacionaria', 1, '15 min', '-', 'ritmo suave-moderado', 4);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Salud general — nutrición base',
    'Sin suplementación específica necesaria; priorizar alimentos frescos, variados y buena hidratación.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Pan integral con huevo y fruta de estación', 420, 1),
    (v_pd, 'Media mañana', '10:00', 'Yogurt natural con fruta picada', 180, 2),
    (v_pd, 'Almuerzo', '13:00', 'Plato equilibrado: proteína magra, arroz o menestra y ensalada', 600, 3),
    (v_pd, 'Snack', '16:30', 'Fruta con un puñado de frutos secos', 200, 4),
    (v_pd, 'Cena', '20:00', 'Sopa de verduras con pollo y una porción pequeña de carbohidrato', 550, 5);

  -- ======================================================================
  -- 7) REHABILITACIÓN — bajo impacto, movilidad, 2 días
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'rehabilitacion';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Rehabilitación — plan base',
    'Movilidad articular y activación muscular de bajo impacto con peso corporal, orientado a recuperar rango de movimiento sin sobrecargar.')
  returning id into v_pr;

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 2, 'Movilidad + activación tren superior') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha' and nombre not ilike '%lateral%' limit 1), 'Plancha', 2, '15-20 seg', '45 seg', 'peso corporal', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Pájaros%' limit 1), 'Pájaros (posterior)', 2, '12', '45 seg', 'muy ligera/banda', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevaciones frontales' limit 1), 'Elevaciones frontales', 2, '10', '45 seg', 'muy ligera', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Puente de glúteo' limit 1), 'Puente de glúteo', 2, '12', '45 seg', 'peso corporal', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 4, 'Movilidad + activación tren inferior') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla libre' limit 1), 'Sentadilla libre (rango parcial)', 2, '10', '60 seg', 'peso corporal', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Elevación de talones' limit 1), 'Elevación de talones', 2, '12', '45 seg', 'peso corporal', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Zancadas caminando' limit 1), 'Zancadas caminando (paso corto)', 2, '8 por pierna', '60 seg', 'peso corporal', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha lateral' limit 1), 'Plancha lateral', 2, '15 seg por lado', '45 seg', 'peso corporal', 4);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Rehabilitación — nutrición base',
    'Priorizar alimentos antiinflamatorios (pescado, frutas, verduras) y buena hidratación para apoyar la recuperación tisular.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Avena con fruta y un huevo sancochado', 400, 1),
    (v_pd, 'Media mañana', '10:00', 'Yogurt natural con fruta', 180, 2),
    (v_pd, 'Almuerzo', '13:00', 'Pescado al horno con verduras al vapor y quinua', 560, 3),
    (v_pd, 'Snack', '16:30', 'Fruta con frutos secos', 200, 4),
    (v_pd, 'Cena', '20:00', 'Pollo a la plancha con verduras salteadas y camote', 550, 5);

  -- ======================================================================
  -- 8) PREPARACIÓN DEPORTIVA — funcional, pliometría, potencia, 4 días
  -- ======================================================================
  select id into v_obj from public.objetivo_entrenamiento where codigo = 'prep_deportiva';

  insert into public.plantilla_rutina (empresa_id, objetivo_id, nombre, notas)
  values (null, v_obj, 'Preparación deportiva — plan base',
    'Trabajo funcional combinando fuerza, pliometría y potencia para mejorar rendimiento deportivo (velocidad, salto y agilidad).')
  returning id into v_pr;

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 1, 'Fuerza de base tren inferior') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Sentadilla con barra' limit 1), 'Sentadilla con barra', 4, '6', '2 min', 'alta', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Peso muerto rumano' limit 1), 'Peso muerto rumano', 3, '8', '90 seg', 'moderada-alta', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Zancadas con mancuernas' limit 1), 'Zancadas con mancuernas', 3, '10 por pierna', '90 seg', 'moderada', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Hip thrust' limit 1), 'Hip thrust', 3, '10', '90 seg', 'moderada-alta', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 2, 'Pliometría + potencia') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Burpees' limit 1), 'Burpees', 4, '10', '60 seg', '-', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Salto de soga' limit 1), 'Salto de soga', 4, '1 min', '45 seg', '-', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Mountain climbers' limit 1), 'Mountain climbers', 3, '40 seg', '30 seg', '-', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Zancadas caminando' limit 1), 'Zancadas caminando (explosivas)', 3, '10 por pierna', '60 seg', 'peso corporal', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 4, 'Fuerza de base tren superior') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press banca plano' limit 1), 'Press banca plano', 4, '6-8', '2 min', 'alta', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Dominadas' limit 1), 'Dominadas', 4, '6-8', '2 min', 'peso corporal/lastre', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Press militar' and nombre not ilike '%mancuernas%' limit 1), 'Press militar', 3, '8', '90 seg', 'moderada-alta', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Fondos en paralelas' limit 1), 'Fondos en paralelas', 3, '8-10', '90 seg', 'peso corporal', 4);

  insert into public.plantilla_rutina_dia (plantilla_rutina_id, dia_semana, foco)
  values (v_pr, 6, 'Circuito funcional + core') returning id into v_dia;
  insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, carga, orden) values
    (v_dia, (select id from public.ejercicio where nombre ilike 'Remo ergómetro' limit 1), 'Remo ergómetro', 4, '2 min', '45 seg', 'ritmo alto', 1),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Rueda abdominal' limit 1), 'Rueda abdominal', 3, '12', '45 seg', '-', 2),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Plancha lateral' limit 1), 'Plancha lateral', 3, '30 seg por lado', '30 seg', '-', 3),
    (v_dia, (select id from public.ejercicio where nombre ilike 'Russian twist' limit 1), 'Russian twist', 3, '25', '30 seg', '-', 4);

  insert into public.plantilla_dieta (empresa_id, objetivo_id, nombre, suplementos)
  values (null, v_obj, 'Preparación deportiva — nutrición base',
    'Creatina monohidrato (5g/día) y buena hidratación con electrolitos en días de alta exigencia; carbohidratos alrededor del entrenamiento.')
  returning id into v_pd;
  insert into public.plantilla_comida (plantilla_dieta_id, nombre, hora, descripcion, kcal, orden) values
    (v_pd, 'Desayuno', '07:00', 'Avena con leche, plátano y huevos revueltos', 600, 1),
    (v_pd, 'Media mañana', '10:00', 'Batido de proteína con fruta y avena', 400, 2),
    (v_pd, 'Almuerzo', '13:00', 'Pollo o carne magra con arroz, menestra y ensalada', 750, 3),
    (v_pd, 'Snack', '16:30', 'Sándwich de pollo o atún con fruta', 400, 4),
    (v_pd, 'Cena', '20:00', 'Pescado o pollo con camote y verduras salteadas', 620, 5);

end $$;
