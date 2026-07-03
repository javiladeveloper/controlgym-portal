-- ============================================================================
-- 23 · Configuración extendida de la empresa
--   · Contacto: dirección, RUC/razón social, horario
--   · Redes sociales (jsonb)
--   · Preferencias regionales: zona horaria, locale, formato fecha
--   · Textos de marca: eslogan, bienvenida en la app
--   · empresa_tema: favicon_url (isotipo cuadrado para la app)
-- ============================================================================

alter table public.empresa
  add column if not exists direccion       text,
  add column if not exists ruc             text,
  add column if not exists razon_social    text,
  add column if not exists horario_atencion text,
  add column if not exists redes           jsonb not null default '{}',   -- {facebook, instagram, tiktok, whatsapp, youtube, web}
  add column if not exists zona_horaria     text not null default 'America/Lima',
  add column if not exists locale           text not null default 'es-PE',
  add column if not exists eslogan          text,
  add column if not exists mensaje_bienvenida text;

comment on column public.empresa.redes is
  'Redes sociales de la empresa: {facebook, instagram, tiktok, whatsapp, youtube, web}. Se muestran en la app del socio.';

alter table public.empresa_tema
  add column if not exists favicon_url text;

comment on column public.empresa_tema.favicon_url is
  'Isotipo cuadrado (favicon) de la marca, para la app y la pestaña del navegador.';
