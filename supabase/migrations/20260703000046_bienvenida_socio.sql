-- 046: Correo de bienvenida al socio recién inscrito (si dejó email).
-- Sale a nombre del gimnasio (reply-to al correo del gym) para que la
-- relación sea socio↔gym; FitControl es solo el cartero.

create or replace function public.notificar_bienvenida_socio()
returns trigger
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_key text;
  v_gym text;
  v_email_gym text;
  v_tel_gym text;
  v_html text;
begin
  if new.email is null or trim(new.email) = '' then return new; end if;

  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  if v_key is null then return new; end if;

  select nombre, email_contacto, telefono_contacto into v_gym, v_email_gym, v_tel_gym
  from public.empresa where id = new.empresa_id;

  v_html :=
    '<div style="font-family:sans-serif;max-width:480px">' ||
    '<h2 style="margin:0 0 8px">¡Bienvenido a ' || coalesce(v_gym, 'tu nuevo gimnasio') || ', ' || split_part(new.nombre, ' ', 1) || '! 💪</h2>' ||
    '<p style="color:#444;line-height:1.6">Tu inscripción quedó registrada. Desde hoy eres parte de la familia ' ||
    coalesce(v_gym, '') || ' — te esperamos en el gym para empezar.</p>' ||
    '<p style="color:#444;line-height:1.6">Muy pronto también podrás ver tu rutina, tu plan de alimentación y reservar clases desde nuestra app 📱.</p>' ||
    coalesce('<p style="color:#666;font-size:13px">¿Dudas? Escríbenos: ' || v_email_gym || coalesce(' · ' || v_tel_gym, '') || '</p>', '') ||
    '<p style="color:#aaa;font-size:11px;margin-top:18px">Enviado por ' || coalesce(v_gym, 'tu gimnasio') || ' a través de FitControl.</p>' ||
    '</div>';

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', coalesce(v_gym, 'FitControl') || ' <avisos@fitcorecenter.com>',
        'reply_to', coalesce(v_email_gym, 'soporte@fitcorecenter.com'),
        'to', jsonb_build_array(new.email::text),
        'subject', '¡Bienvenido a ' || coalesce(v_gym, 'tu gimnasio') || '! 💪',
        'html', v_html
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists trg_bienvenida_socio on public.socio;
create trigger trg_bienvenida_socio
  after insert on public.socio
  for each row execute function public.notificar_bienvenida_socio();
