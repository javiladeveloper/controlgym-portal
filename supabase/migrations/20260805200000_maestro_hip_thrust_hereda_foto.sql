-- El "Hip thrust" huérfano ya no aparece vacío al lado del bueno.
--
-- Al verificar la búsqueda quedó a la vista un efecto feo: escribir "hip
-- thrust" devolvía TRES resultados y uno era el ejercicio maestro original
-- ('maestro-486823fd…'), sin foto, sin equipo y sin instrucciones. La socia veía
-- dos entradas casi idénticas, una de ellas en blanco.
--
-- Ese registro es uno de los 45 "maestro" creados el 15-jul (los básicos del
-- gimnasio: press banca, sentadilla, peso muerto, plancha…), que se quedaron sin
-- media mientras los 1.324 importados sí la tienen. No se puede borrar sin más:
-- puede estar referenciado por rutinas de gimnasios reales.
--
-- La solución es rellenarlo con lo que ya tenemos, en vez de dejarlo huérfano o
-- duplicar el ejercicio: hereda la foto e instrucciones del nuevo
-- 'pd-barbell-hip-thrust' y gana el equipo que le faltaba. Los otros 44 quedan
-- para una pasada aparte.

update public.ejercicio_catalogo m
set
  foto_url      = pd.foto_url,
  instrucciones = pd.instrucciones,
  pasos         = pd.pasos,
  equipment     = pd.equipment,
  attribution   = pd.attribution,
  -- Sin nombre_es la búsqueda solo casaba por el nombre en inglés; con él, la
  -- fila responde igual que sus vecinas a "empuje de cadera".
  nombre_es     = 'hip thrust',
  updated_at    = now()
from public.ejercicio_catalogo pd
where pd.ext_id = 'pd-barbell-hip-thrust'
  and m.ext_id  = 'maestro-486823fd-3f49-44ab-9b3b-d2a012cfc4fa'
  -- Idempotente: si ya heredó la foto, no se vuelve a tocar.
  and m.foto_url is null;
