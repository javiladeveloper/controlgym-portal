-- ============================================================================
-- 22 · Datos de contacto de la empresa
--   email_contacto: correo oficial (remitente de emails Resend, contacto).
-- ============================================================================

alter table public.empresa
  add column if not exists email_contacto citext,
  add column if not exists telefono_contacto text;

comment on column public.empresa.email_contacto is
  'Correo oficial de la empresa. Remitente por defecto de emails (invitaciones, recordatorios).';
