-- 20260704000003: Correo de bienvenida v2 — con la marca del gimnasio.
-- Escrito por la sesión de la APP (pedido del cliente: "más bonito").
-- NO aplicar desde la app: lo aplica la sesión del panel (protocolo HANDOFF).
-- Mismo contrato que la v1 (trigger after insert on socio); solo cambia el HTML:
--   · header oscuro con logo y nombre de marca (empresa_tema)
--   · tarjeta blanca con saludo, beneficios y botón CTA del color del gym
--   · footer con contacto y byline FitControl

create or replace function public.notificar_bienvenida_socio()
returns trigger
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_key text;
  v_gym text;
  v_slug text;
  v_email_gym text;
  v_tel_gym text;
  v_marca text;
  v_logo text;
  v_primario text;
  v_navy text;
  v_nombre text;
  v_contacto text;
  v_cta text := '';
  v_html text;
begin
  if new.email is null or trim(new.email) = '' then return new; end if;

  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  if v_key is null then return new; end if;

  select e.nombre, e.slug, e.email_contacto, e.telefono_contacto
    into v_gym, v_slug, v_email_gym, v_tel_gym
  from public.empresa e where e.id = new.empresa_id;

  select t.nombre_marca, t.logo_url, t.color_primary, t.color_navy
    into v_marca, v_logo, v_primario, v_navy
  from public.empresa_tema t where t.empresa_id = new.empresa_id;

  v_marca    := coalesce(nullif(trim(v_marca), ''), v_gym, 'Tu gimnasio');
  v_primario := coalesce(nullif(trim(v_primario), ''), '#FF6B35');
  v_navy     := coalesce(nullif(trim(v_navy), ''), '#141B2E');
  v_nombre   := split_part(new.nombre, ' ', 1);

  if v_slug is not null and trim(v_slug) <> '' then
    v_cta :=
      '<tr><td align="center" style="padding:26px 0 6px">' ||
      '<a href="https://' || v_slug || '.fitcorecenter.com" ' ||
      'style="background:' || v_primario || ';color:#ffffff;text-decoration:none;' ||
      'font-weight:bold;font-size:15px;padding:13px 34px;border-radius:999px;display:inline-block">' ||
      'Conocer ' || v_marca || '</a></td></tr>';
  end if;

  v_contacto := coalesce(
    '¿Dudas? Escríbenos a <a href="mailto:' || v_email_gym || '" style="color:' || v_primario ||
    '">' || v_email_gym || '</a>' || coalesce(' &nbsp;·&nbsp; ' || v_tel_gym, ''),
    'Cualquier duda, pregúntanos en recepción 😉');

  v_html :=
    '<div style="background:#f1f3f6;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">' ||
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' ||
      '<table role="presentation" width="520" cellpadding="0" cellspacing="0" ' ||
        'style="max-width:520px;width:100%;border-collapse:separate">' ||

        -- Header con la marca del gym
        '<tr><td style="background:' || v_navy || ';border-radius:16px 16px 0 0;padding:22px 28px" align="center">' ||
          coalesce('<img src="' || v_logo || '" width="40" height="40" alt="" ' ||
                   'style="border-radius:10px;display:block;margin:0 auto 8px">', '') ||
          '<span style="color:#ffffff;font-size:19px;font-weight:bold;letter-spacing:.3px">' ||
          v_marca || '</span>' ||
        '</td></tr>' ||

        -- Tarjeta principal
        '<tr><td style="background:#ffffff;border-radius:0 0 16px 16px;padding:30px 28px">' ||
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' ||
            '<tr><td align="center" style="font-size:34px;padding-bottom:6px">🎉</td></tr>' ||
            '<tr><td align="center" style="color:#141b2e;font-size:22px;font-weight:bold;padding-bottom:6px">' ||
              '¡Bienvenido, ' || v_nombre || '!</td></tr>' ||
            '<tr><td align="center" style="color:#5b6472;font-size:15px;line-height:1.6;padding-bottom:20px">' ||
              'Tu inscripción quedó registrada. Desde hoy eres parte de la familia <b>' ||
              v_marca || '</b> 💪</td></tr>' ||

            -- Beneficios
            '<tr><td style="background:#f7f8fa;border-radius:12px;padding:16px 20px">' ||
              '<table role="presentation" cellpadding="0" cellspacing="0">' ||
              '<tr><td style="font-size:15px;padding:5px 10px 5px 0">🏋️</td>' ||
                  '<td style="color:#333;font-size:14px;line-height:1.5">Tu rutina personalizada, directo en tu celular</td></tr>' ||
              '<tr><td style="font-size:15px;padding:5px 10px 5px 0">🥗</td>' ||
                  '<td style="color:#333;font-size:14px;line-height:1.5">Tu plan de alimentación siempre a la mano</td></tr>' ||
              '<tr><td style="font-size:15px;padding:5px 10px 5px 0">📅</td>' ||
                  '<td style="color:#333;font-size:14px;line-height:1.5">Reserva de clases y carnet digital de ingreso</td></tr>' ||
              '</table>' ||
            '</td></tr>' ||

            v_cta ||

            '<tr><td align="center" style="border-top:1px solid #e8eaef;margin-top:8px;' ||
              'padding-top:18px;color:#8a93a5;font-size:12.5px;line-height:1.6">' ||
              v_contacto || '</td></tr>' ||
          '</table>' ||
        '</td></tr>' ||

        -- Byline
        '<tr><td align="center" style="padding:14px;color:#a8b0bf;font-size:11px">' ||
          'Enviado por ' || v_marca || ' a través de FitControl</td></tr>' ||
      '</table>' ||
      '</td></tr></table>' ||
    '</div>';

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', coalesce(v_gym, 'FitControl') || ' <avisos@fitcorecenter.com>',
        'reply_to', coalesce(v_email_gym, 'soporte@fitcorecenter.com'),
        'to', jsonb_build_array(new.email::text),
        'subject', '¡Bienvenido a ' || v_marca || '! 💪 Tu membresía ya está activa',
        'html', v_html
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;
