-- De qué conversación de Finny salió este pago, y el link que se le entregó.
--
-- Dos motivos:
--   1) Idempotencia: un lead + un plan = UN solo link vivo. Si el bot vuelve a
--      pedirlo (reintento, ráfaga de mensajes, "no me llegó"), se busca por
--      (empresa_id, finny_lead_id, ref_id) y se devuelve el MISMO link en vez
--      de generar una preferencia nueva — duplicar aquí significa que alguien
--      pague dos veces.
--   2) Saber después cuánto vendió el bot de verdad.
--
-- init_point no existía en pago_app (crear-pago.js nunca lo guardaba, solo lo
-- devolvía en la respuesta). Sin guardarlo no hay nada que devolver en el
-- segundo pedido, así que se añade junto con finny_lead_id.
alter table public.pago_app
  add column if not exists finny_lead_id text,
  add column if not exists init_point text;

-- El índice acompaña la consulta exacta de la idempotencia.
create index if not exists pago_app_finny_lead_idx
  on public.pago_app (empresa_id, finny_lead_id, ref_id)
  where finny_lead_id is not null;

-- El canal 'finny' se suma a los dos que ya existían (app/mostrador). Sin
-- esto, crear-pago.js coincide con ningún valor permitido y el propio
-- endpoint degrada el canal a 'app' en silencio — el pago de un prospecto que
-- nunca fue socio quedaría contado como venta de la app, justo lo que
-- finny_lead_id existe para poder distinguir.
alter table public.pago_app drop constraint if exists pago_app_canal_check;
alter table public.pago_app
  add constraint pago_app_canal_check check (canal = any (array['app', 'mostrador', 'finny']));
