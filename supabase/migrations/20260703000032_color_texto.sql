-- ============================================================================
-- 32 · White-label: color de texto principal configurable
--   (color_muted ya existía; faltaba el texto principal "ink")
-- ============================================================================

alter table public.empresa_tema
  add column if not exists color_ink text not null default '#141B2E';

comment on column public.empresa_tema.color_ink is
  'Color del texto principal (títulos y contenido) en portal y página.';
