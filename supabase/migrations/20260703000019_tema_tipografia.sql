-- ============================================================================
-- 19 · White-label: tipografía por empresa
--   El gym puede elegir su fuente (además de logo y colores).
-- ============================================================================

alter table public.empresa_tema
  add column if not exists font_family text not null default 'Manrope';

comment on column public.empresa_tema.font_family is
  'Familia tipográfica de la marca de la empresa (white-label). Default Manrope.';
