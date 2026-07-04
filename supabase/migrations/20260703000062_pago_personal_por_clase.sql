-- ============================================================================
-- 62 · Forma de pago del personal
-- No todo el staff es de planilla fija: a instructores contratados se les
-- paga por clase o sesión dictada. tipo_pago decide cómo se le paga y
-- tarifa_clase guarda cuánto por clase (para pre-llenar el pago).
-- ============================================================================

alter table public.usuario_empresa
  add column if not exists tipo_pago text not null default 'mensual'
  check (tipo_pago in ('mensual', 'por_clase'));

alter table public.usuario_empresa
  add column if not exists tarifa_clase numeric(12,2);

comment on column public.usuario_empresa.tipo_pago is
  'mensual = sueldo fijo de planilla · por_clase = se le paga por clases/sesiones dictadas';
