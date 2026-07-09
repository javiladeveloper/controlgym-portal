-- FIX (PEDIDO 15): el webhook de MercadoPago renueva la membresía con
-- metodo_pago='mercadopago', pero el CHECK de movimiento_financiero no lo
-- permitía → el webhook fallaba al registrar el ingreso en caja. Agregamos
-- 'mercadopago' (y 'culqi', por consistencia con el otro flujo de tarjeta) a
-- los métodos válidos.
alter table public.movimiento_financiero
  drop constraint if exists movimiento_financiero_metodo_pago_check;

alter table public.movimiento_financiero
  add constraint movimiento_financiero_metodo_pago_check
  check (metodo_pago = any (array[
    'efectivo', 'yape', 'plin', 'tarjeta', 'transferencia', 'otro',
    'mercadopago', 'culqi'
  ]));
