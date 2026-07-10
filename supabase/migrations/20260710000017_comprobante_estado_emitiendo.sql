-- Permite el estado transitorio 'emitiendo' (claim atómico del worker para
-- evitar doble emisión cuando el cron y el disparo al vuelo corren a la vez).
alter table public.comprobante drop constraint if exists comprobante_estado_check;
alter table public.comprobante add constraint comprobante_estado_check
  check (estado in ('pendiente','emitiendo','emitido','observado','anulado','error'));
