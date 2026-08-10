-- Idempotencia REAL del link de pago de Finny: un lead + un plan = UN link vivo.
--
-- El índice anterior (pago_app_finny_lead_idx) NO era único: solo aceleraba la
-- consulta. Con un select-y-después-insert sin lock, dos mensajes casi
-- simultáneos del bot — el caso explícito del requisito, la "ráfaga de
-- mensajes" — pasan los dos por el select antes de que ninguno haya insertado,
-- y terminan creando DOS preferencias de MercadoPago vivas. Ahí duplicar no
-- molesta: significa que el interesado puede pagar dos veces.
--
-- La unicidad es PARCIAL a propósito, sobre estado_pago = 'pendiente': lo que
-- no puede haber dos veces es un cobro ABIERTO. Una vez que el pago se aprueba
-- (o se rechaza/cancela), la fila sale del índice y el mismo lead puede volver
-- a comprar el mismo plan más adelante — renovar no debe quedar bloqueado por
-- haber pagado una vez.
--
-- Con esto el insert de crear-pago.js puede apoyarse en la base de datos en vez
-- de en una carrera: el segundo pedido choca contra el índice y devuelve el
-- link que ya existe.
drop index if exists public.pago_app_finny_lead_idx;

create unique index if not exists pago_app_finny_lead_vivo_idx
  on public.pago_app (empresa_id, finny_lead_id, ref_id)
  where finny_lead_id is not null and estado_pago = 'pendiente';

-- Hasta cuándo es pagable el link (lo que se le pidió a MercadoPago con
-- `expires` + `expiration_date_to`).
--
-- Antes, la idempotencia miraba `creado_at > now() - interval '1 hour'` — un
-- plazo inventado del lado de FitCore que no se correspondía con nada: la
-- preferencia de MP no caducaba nunca. El resultado era exactamente el doble
-- cobro que se quería evitar: quien pedía el link de nuevo a las 11:05 tras
-- recibirlo a las 10:00 obtenía un SEGUNDO link, y los dos seguían siendo
-- pagables.
--
-- Guardando el vencimiento REAL, "¿sigue vivo?" se responde con el dato que MP
-- va a respetar, no con una suposición.
alter table public.pago_app
  add column if not exists init_point_vence_at timestamptz;
