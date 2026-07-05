-- ============================================================================
-- 79 (20260704000010) · Banco de ejercicios base
-- Siembra el catálogo `ejercicio` (que la app ya usa para sugerencias) con
-- ~45 ejercicios estándar por grupo muscular, para TODAS las empresas activas
-- que no los tengan. El banco luego crece solo: cada ejercicio nuevo que el
-- staff escribe en una rutina se agrega automáticamente.
-- ============================================================================

with base(nombre, grupo) as (
  values
  ('Sentadilla con barra', 'Pierna'), ('Prensa de piernas', 'Pierna'),
  ('Peso muerto', 'Pierna'), ('Peso muerto rumano', 'Pierna'),
  ('Zancadas con mancuernas', 'Pierna'), ('Extensión de cuádriceps', 'Pierna'),
  ('Curl femoral', 'Pierna'), ('Elevación de talones', 'Pierna'),
  ('Hip thrust', 'Glúteo'), ('Puente de glúteo', 'Glúteo'), ('Patada de glúteo en polea', 'Glúteo'),
  ('Press banca plano', 'Pecho'), ('Press banca inclinado', 'Pecho'),
  ('Press con mancuernas', 'Pecho'), ('Aperturas con mancuernas', 'Pecho'),
  ('Fondos en paralelas', 'Pecho'), ('Flexiones de pecho', 'Pecho'),
  ('Dominadas', 'Espalda'), ('Jalón al pecho', 'Espalda'),
  ('Remo con barra', 'Espalda'), ('Remo con mancuerna', 'Espalda'),
  ('Remo en polea baja', 'Espalda'), ('Pull-over', 'Espalda'),
  ('Press militar', 'Hombro'), ('Press Arnold', 'Hombro'),
  ('Elevaciones laterales', 'Hombro'), ('Elevaciones frontales', 'Hombro'),
  ('Pájaros (posterior)', 'Hombro'), ('Encogimientos de trapecio', 'Hombro'),
  ('Curl de bíceps con barra', 'Brazo'), ('Curl alterno con mancuernas', 'Brazo'),
  ('Curl martillo', 'Brazo'), ('Extensión de tríceps en polea', 'Brazo'),
  ('Press francés', 'Brazo'), ('Fondos de tríceps en banco', 'Brazo'),
  ('Plancha', 'Core'), ('Plancha lateral', 'Core'), ('Crunch abdominal', 'Core'),
  ('Elevación de piernas', 'Core'), ('Russian twist', 'Core'), ('Rueda abdominal', 'Core'),
  ('Burpees', 'Cardio'), ('Mountain climbers', 'Cardio'), ('Salto de soga', 'Cardio'),
  ('Trotadora', 'Cardio'), ('Bicicleta estacionaria', 'Cardio'), ('Remo ergómetro', 'Cardio')
)
insert into public.ejercicio (empresa_id, nombre, grupo_muscular)
select e.id, b.nombre, b.grupo
from public.empresa e
cross join base b
where e.deleted_at is null and e.estado = 'activa'
  and not exists (
    select 1 from public.ejercicio x
    where x.empresa_id = e.id and lower(x.nombre) = lower(b.nombre)
  );
