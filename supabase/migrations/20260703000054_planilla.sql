-- 054: Planilla — sueldo mensual del personal por empresa.
-- El pago se registra como gasto en movimiento_financiero (categoria
-- 'planilla', ref al usuario), asi Finanzas y Reportes lo ven solos.
alter table public.usuario_empresa
  add column if not exists sueldo_mensual numeric(12,2);
