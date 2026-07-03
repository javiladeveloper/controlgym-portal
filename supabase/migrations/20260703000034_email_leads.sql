-- ============================================================================
-- 34 · Notificación por email de nuevos prospectos (Resend vía pg_net)
--   Cuando entra un lead (desde la página web o el panel), se envía un email
--   al correo de contacto de la empresa. El envío es asíncrono (pg_net) y
--   nunca bloquea ni hace fallar el registro del lead.
--   La API key se guarda en una tabla privada SIN grants (solo definer).
-- ============================================================================

create extension if not exists pg_net;

create schema if not exists privado;
create table if not exists privado.secreto (
  clave text primary key,
  valor text not null
);
revoke all on schema privado from public, anon, authenticated;
revoke all on privado.secreto from public, anon, authenticated;

-- ── Trigger: email al gym cuando entra un lead ──────────────────────────────
create or replace function public.notificar_lead()
returns trigger
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_key text;
  v_email text;
  v_gym text;
  v_html text;
begin
  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  select email_contacto, nombre into v_email, v_gym from public.empresa where id = new.empresa_id;

  if v_key is null or v_email is null then
    return new; -- sin key o sin correo de contacto: no notificar
  end if;

  v_html :=
    '<div style="font-family:sans-serif;max-width:480px">' ||
    '<h2 style="margin:0 0 4px">🔥 Nuevo interesado en ' || coalesce(v_gym, 'tu gimnasio') || '</h2>' ||
    '<p style="color:#555;margin:0 0 16px">Llegó desde: <b>' || coalesce(new.fuente, 'Panel') || '</b></p>' ||
    '<table style="font-size:14px;line-height:1.9">' ||
    '<tr><td style="color:#888;padding-right:12px">Nombre</td><td><b>' || new.nombre || '</b></td></tr>' ||
    coalesce('<tr><td style="color:#888;padding-right:12px">Teléfono</td><td><b>' || new.telefono || '</b></td></tr>', '') ||
    coalesce('<tr><td style="color:#888;padding-right:12px">Correo</td><td>' || new.email || '</td></tr>', '') ||
    coalesce('<tr><td style="color:#888;padding-right:12px">Nota</td><td>' || new.nota || '</td></tr>', '') ||
    '</table>' ||
    '<p style="color:#888;font-size:12px;margin-top:18px">Contáctalo pronto: los leads atendidos en minutos convierten mucho más. — FitCore</p>' ||
    '</div>';

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'FitCore <onboarding@resend.dev>',
        'to', jsonb_build_array(v_email),
        'subject', '🔥 Nuevo interesado: ' || new.nombre || ' (' || coalesce(new.fuente, 'Panel') || ')',
        'html', v_html
      )
    );
  exception when others then
    null; -- el email jamás debe romper el alta del lead
  end;

  return new;
end;
$$;

drop trigger if exists trg_notificar_lead on public.lead;
create trigger trg_notificar_lead
  after insert on public.lead
  for each row execute function public.notificar_lead();
