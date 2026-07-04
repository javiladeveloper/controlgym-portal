-- ============================================================================
-- 66 · Datos bancarios del colaborador (para efectuar el pago de planilla)
-- Viven en usuario_empresa porque son del vínculo laboral con ESTE negocio
-- (la misma persona puede cobrar en cuentas distintas en otra empresa).
-- ============================================================================

alter table public.usuario_empresa add column if not exists banco text;
alter table public.usuario_empresa add column if not exists cuenta_banco text;
alter table public.usuario_empresa add column if not exists cci text;

comment on column public.usuario_empresa.cci is
  'Código de Cuenta Interbancario (20 dígitos) para transferencias desde otros bancos.';
