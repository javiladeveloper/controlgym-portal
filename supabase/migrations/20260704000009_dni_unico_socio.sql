-- ============================================================================
-- 78 (20260704000009) · Un DNI = un socio por empresa
-- Backstop contra duplicados (pedido tras encontrar dos "jonathan avila"):
-- índice único parcial por (empresa_id, documento) ignorando borrados y
-- documentos vacíos. El formulario avisa amable ANTES; esto es el candado.
-- ============================================================================

create unique index if not exists uq_socio_documento_empresa
  on public.socio (empresa_id, documento)
  where deleted_at is null and documento is not null and documento <> '';
