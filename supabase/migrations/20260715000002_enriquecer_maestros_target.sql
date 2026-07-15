-- Enriquece los 45 ejercicios migrados del maestro viejo con el target/body_part
-- del ejercicio equivalente del dataset rico. Así las rutinas que usan estos
-- nombres comunes (español) permiten sugerir similares por músculo (PEDIDO 37) y
-- tienen datos completos para las plantillas. Casado a mano por `nombre` (los
-- migrados guardan el nombre español en `nombre`, con `nombre_es` NULL).
update public.ejercicio_catalogo c set target=v.target, body_part=v.bp
from (values
  ('Curl de bíceps con barra','biceps','upper arms'),
  ('Curl alterno con mancuernas','biceps','upper arms'),
  ('Curl martillo','biceps','upper arms'),
  ('Press francés','triceps','upper arms'),
  ('Extensión de tríceps en polea','triceps','upper arms'),
  ('Fondos de tríceps en banco','triceps','upper arms'),
  ('Fondos en paralelas','triceps','upper arms'),
  ('Dominadas','lats','back'),
  ('Jalón al pecho','lats','back'),
  ('Remo con barra','upper back','back'),
  ('Remo con mancuerna','upper back','back'),
  ('Remo en polea baja','upper back','back'),
  ('Pull-over','lats','back'),
  ('Press banca plano','pectorals','chest'),
  ('Press banca inclinado','pectorals','chest'),
  ('Press con mancuernas','pectorals','chest'),
  ('Flexiones de pecho','pectorals','chest'),
  ('Press militar','delts','shoulders'),
  ('Press Arnold','delts','shoulders'),
  ('Elevaciones laterales','delts','shoulders'),
  ('Elevaciones frontales','delts','shoulders'),
  ('Pájaros (posterior)','delts','shoulders'),
  ('Encogimientos de trapecio','traps','back'),
  ('Sentadilla con barra','glutes','upper legs'),
  ('Prensa de piernas','quads','upper legs'),
  ('Extensión de cuádriceps','quads','upper legs'),
  ('Curl femoral','hamstrings','upper legs'),
  ('Peso muerto','glutes','upper legs'),
  ('Peso muerto rumano','hamstrings','upper legs'),
  ('Zancadas con mancuernas','glutes','upper legs'),
  ('Elevación de talones','calves','lower legs'),
  ('Hip thrust','glutes','upper legs'),
  ('Puente de glúteo','glutes','upper legs'),
  ('Patada de glúteo en polea','glutes','upper legs'),
  ('Crunch abdominal','abs','waist'),
  ('Elevación de piernas','abs','waist'),
  ('Plancha','abs','waist'),
  ('Plancha lateral','abs','waist'),
  ('Rueda abdominal','abs','waist'),
  ('Mountain climbers','cardiovascular system','cardio'),
  ('Burpees','cardiovascular system','cardio'),
  ('Salto de soga','cardiovascular system','cardio'),
  ('Bicicleta estacionaria','cardiovascular system','cardio'),
  ('Trotadora','cardiovascular system','cardio'),
  ('Remo ergómetro','cardiovascular system','cardio')
) as v(nom, target, bp)
where c.ext_id like 'maestro-%' and lower(c.nombre) = lower(v.nom);
