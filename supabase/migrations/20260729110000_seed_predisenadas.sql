-- Seed de rutinas prediseñadas curadas. Resuelve catalogo_id por nombre_es real
-- (verificado en la BD, equipment='body weight') para no depender de UUIDs que
-- cambian al recargar catálogo. Idempotente: borra por slug antes de insertar
-- (el cascade limpia días y ejercicios).

create or replace function pg_temp.cat(p_nombre text) returns uuid language sql as $$
  select id from public.ejercicio_catalogo
  where activo and equipment='body weight' and coalesce(nombre_es,nombre) = p_nombre limit 1;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 1) FULL BODY EN CASA — 3 días, principiante, peso_corporal
-- ════════════════════════════════════════════════════════════════════════
delete from public.rutina_predisenada where slug='full-body-casa';
with p as (
  insert into public.rutina_predisenada (slug,nombre,categoria,descripcion,nivel,dias_por_semana,equipo,orden)
  values ('full-body-casa','Full body en casa','full_body_casa',
          'Rutina de cuerpo completo con tu propio peso, sin equipo. 3 días a la semana.',
          'principiante',3,'peso_corporal',1)
  returning id
), d1 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,1,'Full body A' from p returning id
), d2 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,3,'Full body B' from p returning id
), d3 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,5,'Full body C' from p returning id
)
insert into public.rutina_predisenada_ejercicio
  (predisenada_dia_id,catalogo_id,nombre,series,reps,descanso,orden,alternativas_ids)
-- Día 1
select d1.id, pg_temp.cat('sentadillas divididas'), 'sentadillas divididas', 3, '10-12', '60s', 1,
       array_remove(array[pg_temp.cat('zancada caminando'), pg_temp.cat('sentadilla de reverencia')], null)
from d1
union all
select d1.id, pg_temp.cat('flexión de rodillas (hombre)'), 'flexión de rodillas (hombre)', 3, '8-10', '60s', 2,
       array_remove(array[pg_temp.cat('flexión de brazos (pared)'), pg_temp.cat('flexión inclinada')], null)
from d1
union all
select d1.id, pg_temp.cat('remo invertido con rodillas flexionadas'), 'remo invertido con rodillas flexionadas', 3, '8-10', '60s', 3,
       array_remove(array[pg_temp.cat('remo de pie con peso corporal'), pg_temp.cat('remo en suspensión')], null)
from d1
union all
select d1.id, pg_temp.cat('bicho muerto (dead bug)'), 'bicho muerto (dead bug)', 3, '10-12', '45s', 4,
       array_remove(array[pg_temp.cat('crunch en el suelo'), pg_temp.cat('inclinación pélvica')], null)
from d1
-- Día 2
union all
select d2.id, pg_temp.cat('zancada caminando'), 'zancada caminando', 3, '10-12 por lado', '60s', 1,
       array_remove(array[pg_temp.cat('sentadilla de reverencia'), pg_temp.cat('sentadillas divididas')], null)
from d2
union all
select d2.id, pg_temp.cat('flexión de brazos'), 'flexión de brazos', 3, '8-10', '60s', 2,
       array_remove(array[pg_temp.cat('flexión con manos amplias'), pg_temp.cat('flexión declinada')], null)
from d2
union all
select d2.id, pg_temp.cat('dominada (agarre neutro)'), 'dominada (agarre neutro)', 3, '5-8', '90s', 3,
       array_remove(array[pg_temp.cat('remo invertido'), pg_temp.cat('remo de pie con peso corporal')], null)
from d2
union all
select d2.id, pg_temp.cat('crunch en el suelo'), 'crunch en el suelo', 3, '12-15', '45s', 4,
       array_remove(array[pg_temp.cat('bicho muerto (dead bug)'), pg_temp.cat('crunch con toque de rodillas')], null)
from d2
-- Día 3
union all
select d3.id, pg_temp.cat('sentadilla de reverencia'), 'sentadilla de reverencia', 3, '10-12 por lado', '60s', 1,
       array_remove(array[pg_temp.cat('sentadillas divididas'), pg_temp.cat('zancada caminando')], null)
from d3
union all
select d3.id, pg_temp.cat('fondos de tríceps'), 'fondos de tríceps', 3, '8-10', '60s', 2,
       array_remove(array[pg_temp.cat('flexión con agarre cerrado'), pg_temp.cat('fondos en banco (rodillas flexionadas)')], null)
from d3
union all
select d3.id, pg_temp.cat('remo de pie con peso corporal'), 'remo de pie con peso corporal', 3, '10-12', '60s', 3,
       array_remove(array[pg_temp.cat('remo invertido'), pg_temp.cat('remo en cuclillas con peso corporal')], null)
from d3
union all
select d3.id, pg_temp.cat('crunch con toque de rodillas'), 'crunch con toque de rodillas', 3, '12-15', '45s', 4,
       array_remove(array[pg_temp.cat('toques de talón alternados'), pg_temp.cat('bicho muerto (dead bug)')], null)
from d3;

-- ════════════════════════════════════════════════════════════════════════
-- 2) PILATES CORE — 2 días, principiante, peso_corporal
-- ════════════════════════════════════════════════════════════════════════
delete from public.rutina_predisenada where slug='pilates-core';
with p as (
  insert into public.rutina_predisenada (slug,nombre,categoria,descripcion,nivel,dias_por_semana,equipo,orden)
  values ('pilates-core','Pilates core','pilates_core',
          'Movimientos controlados de baja intensidad para fortalecer el centro (core) y mejorar postura.',
          'principiante',2,'peso_corporal',2)
  returning id
), d1 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,1,'Core y control A' from p returning id
), d2 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,4,'Core y control B' from p returning id
)
insert into public.rutina_predisenada_ejercicio
  (predisenada_dia_id,catalogo_id,nombre,series,reps,descanso,orden,alternativas_ids)
select d1.id, pg_temp.cat('bicho muerto (dead bug)'), 'bicho muerto (dead bug)', 3, '10-12', '45s', 1,
       array_remove(array[pg_temp.cat('inclinación pélvica'), pg_temp.cat('elevación de cadera (rodillas flexionadas)')], null)
from d1
union all
select d1.id, pg_temp.cat('giro de columna'), 'giro de columna', 2, '8-10 por lado', '30s', 2,
       array_remove(array[pg_temp.cat('crunch oblicuo en el suelo'), pg_temp.cat('crunch cruzado')], null)
from d1
union all
select d1.id, pg_temp.cat('elevación de cadera (rodillas flexionadas)'), 'elevación de cadera (rodillas flexionadas)', 3, '12-15', '45s', 3,
       array_remove(array[pg_temp.cat('inclinación pélvica a puente'), pg_temp.cat('puente de glúteos bajo en el suelo')], null)
from d1
union all
select d1.id, pg_temp.cat('estiramiento lumbar sentado'), 'estiramiento lumbar sentado', 2, '30s', '20s', 4,
       array_remove(array[pg_temp.cat('estiramiento de espalda alta'), pg_temp.cat('estiramiento en el suelo tumbado de lado')], null)
from d1
union all
select d2.id, pg_temp.cat('inclinación pélvica'), 'inclinación pélvica', 3, '12-15', '45s', 1,
       array_remove(array[pg_temp.cat('bicho muerto (dead bug)'), pg_temp.cat('elevación de cadera (rodillas flexionadas)')], null)
from d2
union all
select d2.id, pg_temp.cat('puente lateral v. 2'), 'puente lateral v. 2', 2, '20-30s por lado', '30s', 2,
       array_remove(array[pg_temp.cat('crunch lateral sentado (pared)'), pg_temp.cat('flexión lateral a 45°')], null)
from d2
union all
select d2.id, pg_temp.cat('crunch con toque de rodillas'), 'crunch con toque de rodillas', 3, '10-12', '45s', 3,
       array_remove(array[pg_temp.cat('crunch en el suelo'), pg_temp.cat('crunch agrupado')], null)
from d2
union all
select d2.id, pg_temp.cat('estiramiento de espalda alta'), 'estiramiento de espalda alta', 2, '30s', '20s', 4,
       array_remove(array[pg_temp.cat('estiramiento lumbar sentado'), pg_temp.cat('estiramiento de dorsales arrodillado')], null)
from d2;

-- ════════════════════════════════════════════════════════════════════════
-- 3) PRENATAL — 2 días, principiante, peso_corporal
-- Solo ejercicios seguros: de pie, sentados o apoyados, sin decúbito supino,
-- sin planchas prolongadas boca abajo, sin saltos ni crunches intensos.
-- No incluye ejercicios de abdomen (abs): en este catálogo body-weight los
-- únicos movimientos de 'abs' son crunches/planchas/colgados — ninguno es
-- seguro en embarazo, así que el músculo 'abs' queda fuera a propósito.
-- ════════════════════════════════════════════════════════════════════════
delete from public.rutina_predisenada where slug='prenatal';
with p as (
  insert into public.rutina_predisenada (slug,nombre,categoria,descripcion,nivel,dias_por_semana,equipo,orden)
  values ('prenatal','Prenatal','prenatal',
          'Movilidad y fuerza suave pensada para el embarazo: de pie o sentada, sin saltos ni impacto.',
          'principiante',2,'peso_corporal',3)
  returning id
), d1 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,1,'Piernas y glúteos suave' from p returning id
), d2 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,4,'Movilidad y postura' from p returning id
)
insert into public.rutina_predisenada_ejercicio
  (predisenada_dia_id,catalogo_id,nombre,series,reps,descanso,orden,alternativas_ids)
select d1.id, pg_temp.cat('sentadilla de reverencia'), 'sentadilla de reverencia', 2, '8-10 por lado', '60s', 1,
       array_remove(array[pg_temp.cat('zancada caminando')], null)
from d1
union all
select d1.id, pg_temp.cat('extensión de cadera en banco'), 'extensión de cadera en banco', 2, '10-12', '60s', 2,
       array_remove(array[pg_temp.cat('marcha sentado (pared)')], null)
from d1
union all
select d1.id, pg_temp.cat('estiramiento con pierna extendida en silla'), 'estiramiento con pierna extendida en silla', 2, '20-30s por lado', '20s', 3,
       array_remove(array[pg_temp.cat('estiramiento de cuádriceps a cuatro apoyos')], null)
from d1
union all
select d1.id, pg_temp.cat('estiramiento de isquiotibiales'), 'estiramiento de isquiotibiales', 2, '20-30s por lado', '20s', 4,
       array_remove(array[pg_temp.cat('estiramiento de isquiotibiales con pierna elevada'), pg_temp.cat('estiramiento del corredor')], null)
from d1
union all
select d2.id, pg_temp.cat('estiramiento de tríceps'), 'estiramiento de tríceps', 2, '20-30s por lado', '20s', 1,
       array_remove(array[pg_temp.cat('estiramiento de tríceps sobre la cabeza')], null)
from d2
union all
select d2.id, pg_temp.cat('estiramiento de pecho y parte frontal del hombro'), 'estiramiento de pecho y parte frontal del hombro', 2, '20-30s', '20s', 2,
       array_remove(array[pg_temp.cat('estiramiento dinámico de pecho (hombre)')], null)
from d2
union all
select d2.id, pg_temp.cat('estiramiento lateral de pie'), 'estiramiento lateral de pie', 2, '20-30s por lado', '20s', 3,
       array_remove(array[pg_temp.cat('estiramiento lumbar sentado')], null)
from d2
union all
select d2.id, pg_temp.cat('estiramiento de espalda alta'), 'estiramiento de espalda alta', 2, '20-30s', '20s', 4,
       array_remove(array[pg_temp.cat('estiramiento de dorsales arrodillado')], null)
from d2;

update public.rutina_predisenada set disclaimer_salud =
  'Consulta con tu médico antes de comenzar cualquier rutina durante el embarazo. Detente si sientes molestias.'
where slug='prenatal';

-- ════════════════════════════════════════════════════════════════════════
-- 4) GLÚTEOS EN CASA — 2 días, principiante, peso_corporal (sin banda; el
--    catálogo body-weight ya cubre suficiente variedad de glúteo/isquios/
--    cuádriceps sin necesitar equipo adicional, se mantiene equipo consistente
--    con el resto de rutinas 'en casa').
-- ════════════════════════════════════════════════════════════════════════
delete from public.rutina_predisenada where slug='gluteos-casa';
with p as (
  insert into public.rutina_predisenada (slug,nombre,categoria,descripcion,nivel,dias_por_semana,equipo,orden)
  values ('gluteos-casa','Glúteos en casa','gluteos_casa',
          'Rutina enfocada en glúteos e isquiotibiales, con tu propio peso.',
          'principiante',2,'peso_corporal',4)
  returning id
), d1 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,2,'Glúteos A' from p returning id
), d2 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,5,'Glúteos B' from p returning id
)
insert into public.rutina_predisenada_ejercicio
  (predisenada_dia_id,catalogo_id,nombre,series,reps,descanso,orden,alternativas_ids)
select d1.id, pg_temp.cat('puente de glúteos bajo en el suelo'), 'puente de glúteos bajo en el suelo', 3, '15-20', '45s', 1,
       array_remove(array[pg_temp.cat('inclinación pélvica a puente'), pg_temp.cat('marcha en puente de glúteos')], null)
from d1
union all
select d1.id, pg_temp.cat('sentadilla a una pierna'), 'sentadilla a una pierna', 3, '6-8 por lado', '60s', 2,
       array_remove(array[pg_temp.cat('sentadilla de reverencia'), pg_temp.cat('zancada caminando')], null)
from d1
union all
select d1.id, pg_temp.cat('zancada caminando'), 'zancada caminando', 3, '10-12 por lado', '60s', 3,
       array_remove(array[pg_temp.cat('zancada frontal (hombre)'), pg_temp.cat('sentadillas divididas')], null)
from d1
union all
select d1.id, pg_temp.cat('extensión de cadera en banco'), 'extensión de cadera en banco', 3, '12-15', '45s', 4,
       array_remove(array[pg_temp.cat('puente de glúteos con dos piernas en banco (hombre)'), pg_temp.cat('marcha sentado (pared)')], null)
from d1
union all
select d2.id, pg_temp.cat('puente a una pierna con pierna extendida'), 'puente a una pierna con pierna extendida', 3, '10-12 por lado', '60s', 1,
       array_remove(array[pg_temp.cat('puente de glúteos bajo en el suelo'), pg_temp.cat('inclinación pélvica a puente')], null)
from d2
union all
select d2.id, pg_temp.cat('sentadilla de reverencia'), 'sentadilla de reverencia', 3, '10-12 por lado', '60s', 2,
       array_remove(array[pg_temp.cat('sentadilla a una pierna'), pg_temp.cat('sentadillas divididas')], null)
from d2
union all
select d2.id, pg_temp.cat('elevación glúteo-femoral'), 'elevación glúteo-femoral', 3, '8-10', '60s', 3,
       array_remove(array[pg_temp.cat('curl femoral inverso (apoyo en banco)'), pg_temp.cat('curl femoral a una pierna de pie')], null)
from d2
union all
select d2.id, pg_temp.cat('marcha sentado (pared)'), 'marcha sentado (pared)', 3, '10-12 por lado', '45s', 4,
       array_remove(array[pg_temp.cat('extensión de cadera en banco'), pg_temp.cat('abrazo de rodillas al pecho')], null)
from d2;

-- ════════════════════════════════════════════════════════════════════════
-- 5) CORE Y ABDOMEN — 2 días, principiante, peso_corporal
-- ════════════════════════════════════════════════════════════════════════
delete from public.rutina_predisenada where slug='core-abdomen';
with p as (
  insert into public.rutina_predisenada (slug,nombre,categoria,descripcion,nivel,dias_por_semana,equipo,orden)
  values ('core-abdomen','Core y abdomen','core_abdomen',
          'Rutina de abdomen y core con tu propio peso, sin equipo.',
          'principiante',2,'peso_corporal',5)
  returning id
), d1 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,2,'Core A' from p returning id
), d2 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,5,'Core B' from p returning id
)
insert into public.rutina_predisenada_ejercicio
  (predisenada_dia_id,catalogo_id,nombre,series,reps,descanso,orden,alternativas_ids)
select d1.id, pg_temp.cat('crunch en el suelo'), 'crunch en el suelo', 3, '15-20', '45s', 1,
       array_remove(array[pg_temp.cat('crunch agrupado'), pg_temp.cat('abdominal parcial (curl-up)')], null)
from d1
union all
select d1.id, pg_temp.cat('bicho muerto (dead bug)'), 'bicho muerto (dead bug)', 3, '10-12', '45s', 2,
       array_remove(array[pg_temp.cat('inclinación pélvica'), pg_temp.cat('elevación de cadera (rodillas flexionadas)')], null)
from d1
union all
select d1.id, pg_temp.cat('crunch oblicuo en el suelo'), 'crunch oblicuo en el suelo', 3, '12-15 por lado', '45s', 3,
       array_remove(array[pg_temp.cat('crunch cruzado'), pg_temp.cat('giro de columna')], null)
from d1
union all
select d1.id, pg_temp.cat('elevación de cadera en plancha (butt-ups)'), 'elevación de cadera en plancha (butt-ups)', 3, '10-12', '60s', 4,
       array_remove(array[pg_temp.cat('crunch invertido'), pg_temp.cat('elevación de piernas y cadera tumbado')], null)
from d1
union all
select d2.id, pg_temp.cat('crunch con toque de rodillas'), 'crunch con toque de rodillas', 3, '12-15', '45s', 1,
       array_remove(array[pg_temp.cat('crunch en el suelo'), pg_temp.cat('toques de talón alternados')], null)
from d2
union all
select d2.id, pg_temp.cat('puente lateral v. 2'), 'puente lateral v. 2', 2, '20-30s por lado', '30s', 2,
       array_remove(array[pg_temp.cat('crunch lateral sentado (pared)'), pg_temp.cat('flexión lateral a 45°')], null)
from d2
union all
select d2.id, pg_temp.cat('bicicleta en el aire'), 'bicicleta en el aire', 3, '30-40s', '45s', 3,
       array_remove(array[pg_temp.cat('toques de talón alternados'), pg_temp.cat('crunch cruzado')], null)
from d2
union all
select d2.id, pg_temp.cat('elevación de piernas y cadera tumbado'), 'elevación de piernas y cadera tumbado', 3, '10-12', '60s', 4,
       array_remove(array[pg_temp.cat('crunch invertido'), pg_temp.cat('elevación de cadera (rodillas flexionadas)')], null)
from d2;
