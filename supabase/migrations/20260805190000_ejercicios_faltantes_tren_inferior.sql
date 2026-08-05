-- Los tres ejercicios de tren inferior que faltaban en el catálogo.
--
-- Lo destapó una socia real: "faltan ejercicios para el tema de mujeres, el hip
-- thrust es importantísimo y no está". Y tenía razón, aunque el catálogo sí
-- tiene 144 ejercicios de glúteo con GIF: lo que hay es "puente de glúteos con
-- barra" (en el SUELO) y un "empuje de cadera con banda de rodillas". El hip
-- thrust propiamente dicho — espalda apoyada en un banco, barra sobre la
-- cadera, recorrido completo — no existía, y es el movimiento de referencia
-- para glúteo.
--
-- Al auditar los 10 movimientos clásicos que un gimnasio espera tener,
-- aparecieron dos huecos más:
--   * sentadilla búlgara — no había NINGUNA variante (se buscó por búlgara,
--     split squat, pie elevado y "una pierna con banco")
--   * patada de glúteo en polea — solo estaba como "extensión de cadera de pie
--     en polea", que nadie busca por ese nombre en un gimnasio
-- Los otros 7 (peso muerto sumo, buenos días, abductor/aductor, zancada
-- caminando, hiperextensión, gemelo sentado) ya estaban cubiertos.
--
-- ## Por qué la imagen es una FOTO y no un GIF como el resto
--
-- Los 1.324 GIF del catálogo son © Gym visual (ver columna attribution) y su
-- licencia no permite añadir piezas nuevas sin comprarlas. Se revisaron las
-- alternativas: los repos "gratuitos" de GIF (omercotkd, azilRababe,
-- mohamedatef90) o no tienen licencia o declaran expresamente no ser dueños del
-- material; Wikimedia Commons tiene animaciones libres pero ninguna de hip
-- thrust. La única fuente con licencia limpia y verificable es
-- free-exercise-db (Unlicense = dominio público), que trae fotos, no GIF.
--
-- Se eligió foto correcta y legal antes que ninguna imagen. Cuando se compre el
-- GIF en Gym visual, basta con actualizar gif_url de esta fila.
--
-- Fuente: https://github.com/yuhonas/free-exercise-db (Unlicense)
-- Imagen verificada a ojo antes de subirla: técnica correcta y SIN marcas de
-- agua ni logos de terceros (se descartó por eso el "glute kickback" del mismo
-- dataset, que llevaba el logo de Bodybuilding.com visible).

insert into public.ejercicio_catalogo (
  ext_id, nombre, nombre_es, body_part, grupo_muscular, target, secondary,
  equipment, instrucciones, pasos, foto_url, attribution, activo
)
values (
  -- ext_id con prefijo propio: los del set de Gym visual son numéricos, así que
  -- 'pd-' (público disponible) deja claro de un vistazo que este vino de otra
  -- fuente y con otra licencia.
  'pd-barbell-hip-thrust',
  'barbell hip thrust',
  'hip thrust con barra',
  'upper legs',
  -- Mismos valores que sus vecinos del catálogo (ver "barbell glute bridge"):
  -- target glutes y grupo_muscular hamstrings, para que caiga en los mismos
  -- filtros y búsquedas que el resto de glúteo.
  'hamstrings',
  'glutes',
  array['hamstrings', 'lower back'],
  'barbell',
  jsonb_build_object(
    'es', 'Siéntate en el suelo con la espalda apoyada en un banco y una barra sobre las caderas (usa una almohadilla o barra acolchada para evitar molestias). Apoya los omóplatos en el borde del banco. Empuja con los pies contra el suelo y extiende las caderas hacia arriba hasta que el cuerpo quede recto desde las rodillas hasta los hombros, apretando los glúteos arriba. Baja de forma controlada a la posición inicial y repite.',
    'en', 'Begin seated on the ground with a bench directly behind you and a loaded barbell over your legs. Using a fat bar or a pad on the bar greatly reduces the discomfort. Roll the bar so it sits directly above your hips and lean back against the bench so your shoulder blades are near the top of it. Drive through your feet, extending your hips vertically through the bar, supported by your shoulder blades and feet. Extend as far as possible, then reverse the motion to return to the starting position.'
  ),
  jsonb_build_object(
    'es', jsonb_build_array(
      'Siéntate en el suelo con la espalda apoyada en un banco y la barra sobre las caderas.',
      'Coloca una almohadilla en la barra: sin ella el peso sobre la cadera molesta bastante.',
      'Apoya los omóplatos en el borde del banco y mira al frente.',
      'Empuja con los pies y sube las caderas hasta formar una línea recta de rodillas a hombros.',
      'Aprieta los glúteos arriba un instante.',
      'Baja de forma controlada hasta la posición inicial y repite.'
    ),
    'en', jsonb_build_array(
      'Begin seated on the ground with a bench directly behind you and a loaded barbell over your legs.',
      'Use a fat bar or a pad on the bar to reduce discomfort.',
      'Roll the bar directly above your hips and lean back so your shoulder blades rest near the top of the bench.',
      'Drive through your feet, extending your hips vertically through the bar.',
      'Extend as far as possible, squeezing the glutes at the top.',
      'Reverse the motion to return to the starting position.'
    )
  ),
  'https://zlmqdubrjzmagslcsqvb.supabase.co/storage/v1/object/public/ejercicios/img/pd-hip-thrust-barra.jpg',
  'Dominio público — https://github.com/yuhonas/free-exercise-db',
  true
)
-- Idempotente: ext_id es unique, así que reejecutar la migración refresca los
-- textos en vez de fallar.
on conflict (ext_id) do update set
  nombre_es     = excluded.nombre_es,
  instrucciones = excluded.instrucciones,
  pasos         = excluded.pasos,
  foto_url      = excluded.foto_url,
  attribution   = excluded.attribution,
  updated_at    = now();


-- 2) Sentadilla búlgara. No había ninguna variante en todo el catálogo, y es un
-- ejercicio central de pierna/glúteo — de los más recomendados para trabajar
-- una pierna a la vez y corregir descompensaciones.
insert into public.ejercicio_catalogo (
  ext_id, nombre, nombre_es, body_part, grupo_muscular, target, secondary,
  equipment, instrucciones, pasos, foto_url, attribution, activo
)
values (
  'pd-bulgarian-split-squat',
  'bulgarian split squat with dumbbells',
  'sentadilla búlgara con mancuernas',
  'upper legs',
  'quadriceps',
  'quadriceps',
  array['glutes', 'hamstrings', 'calves'],
  'dumbbell',
  jsonb_build_object(
    'es', 'De pie a un paso de un banco, con una mancuerna en cada mano. Apoya el empeine del pie de atrás sobre el banco. Baja flexionando la pierna delantera hasta que el muslo quede casi paralelo al suelo, manteniendo el tronco erguido y la rodilla alineada con el pie. Empuja con el talón delantero para volver arriba. Completa las repeticiones y cambia de pierna.',
    'en', 'Stand about a stride in front of a bench holding a dumbbell in each hand. Rest the top of your rear foot on the bench. Lower by bending the front leg until the thigh is nearly parallel to the floor, keeping your torso upright and the knee tracking over the foot. Drive through the front heel to return to the top. Finish the reps, then switch legs.'
  ),
  jsonb_build_object(
    'es', jsonb_build_array(
      'Ponte de pie a un paso de un banco, con una mancuerna en cada mano.',
      'Apoya el empeine del pie de atrás sobre el banco.',
      'Baja flexionando la pierna delantera, con el tronco erguido.',
      'Detente cuando el muslo delantero esté casi paralelo al suelo.',
      'Empuja con el talón delantero para subir.',
      'Termina las repeticiones y cambia de pierna.'
    ),
    'en', jsonb_build_array(
      'Stand a stride in front of a bench with a dumbbell in each hand.',
      'Rest the top of your rear foot on the bench.',
      'Lower by bending the front leg, keeping the torso upright.',
      'Stop when the front thigh is nearly parallel to the floor.',
      'Drive through the front heel to return to the top.',
      'Finish the reps and switch legs.'
    )
  ),
  'https://zlmqdubrjzmagslcsqvb.supabase.co/storage/v1/object/public/ejercicios/img/pd-sentadilla-bulgara.jpg',
  'Dominio público — https://github.com/yuhonas/free-exercise-db',
  true
)
on conflict (ext_id) do update set
  nombre_es     = excluded.nombre_es,
  instrucciones = excluded.instrucciones,
  pasos         = excluded.pasos,
  foto_url      = excluded.foto_url,
  attribution   = excluded.attribution,
  updated_at    = now();


-- 3) Patada de glúteo en polea. El catálogo lo tenía como "extensión de cadera
-- de pie en polea": correcto de nombre anatómico, pero nadie lo busca así — en
-- el gimnasio es "la patada". Se añade con el nombre de la calle para que
-- aparezca al buscarlo.
insert into public.ejercicio_catalogo (
  ext_id, nombre, nombre_es, body_part, grupo_muscular, target, secondary,
  equipment, instrucciones, pasos, foto_url, attribution, activo
)
values (
  'pd-cable-glute-kickback',
  'one-legged cable kickback',
  'patada de glúteo en polea',
  'upper legs',
  'hamstrings',
  'glutes',
  array['hamstrings'],
  'cable',
  jsonb_build_object(
    'es', 'Sujeta una tobillera al cable bajo de la polea y colócatela en un tobillo. De cara a la máquina, sujétate de la estructura e inclina ligeramente el tronco hacia delante. Lleva la pierna hacia atrás con la rodilla casi extendida, apretando el glúteo al final del recorrido. Vuelve despacio sin dejar que el peso golpee. Completa las repeticiones y cambia de pierna.',
    'en', 'Attach an ankle strap to a low pulley and fasten it around one ankle. Face the machine, hold the frame for support and lean the torso slightly forward. Kick the working leg back with the knee nearly straight, squeezing the glute at the end of the range. Return slowly without letting the stack slam. Finish the reps and switch legs.'
  ),
  jsonb_build_object(
    'es', jsonb_build_array(
      'Coloca una tobillera en el cable bajo de la polea y sujétala a un tobillo.',
      'Ponte de cara a la máquina y agárrate de la estructura.',
      'Inclina un poco el tronco hacia delante.',
      'Lleva la pierna hacia atrás con la rodilla casi extendida.',
      'Aprieta el glúteo al final del recorrido.',
      'Vuelve despacio y repite; luego cambia de pierna.'
    ),
    'en', jsonb_build_array(
      'Attach an ankle strap to a low pulley and fasten it to one ankle.',
      'Face the machine and hold the frame for support.',
      'Lean the torso slightly forward.',
      'Kick the working leg back with the knee nearly straight.',
      'Squeeze the glute at the end of the range.',
      'Return slowly and repeat, then switch legs.'
    )
  ),
  'https://zlmqdubrjzmagslcsqvb.supabase.co/storage/v1/object/public/ejercicios/img/pd-patada-gluteo-polea.jpg',
  'Dominio público — https://github.com/yuhonas/free-exercise-db',
  true
)
on conflict (ext_id) do update set
  nombre_es     = excluded.nombre_es,
  instrucciones = excluded.instrucciones,
  pasos         = excluded.pasos,
  foto_url      = excluded.foto_url,
  attribution   = excluded.attribution,
  updated_at    = now();
