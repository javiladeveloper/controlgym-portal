-- Aviso de vencimiento de membresía: si el socio tiene la APP (usuario_id
-- vinculado) ya le llega el PUSH — no le mandamos correo también (redundante y
-- el correo cuesta). El correo queda SOLO como respaldo para socios SIN app,
-- para que nadie se quede sin aviso. Cambio: la condición del email exige
-- ADEMÁS `r.usuario_id is null`. Todo lo demás de la función queda idéntico.
create or replace function public.recordar_vencimientos_socios()
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  r record;
  v_key text;
  v_cuando text;
  v_html text;
begin
  select valor into v_key from privado.secreto where clave = 'resend_api_key';

  for r in
    select m.fecha_fin, s.id as socio_id, s.usuario_id, s.nombre as socio, s.email,
           e.nombre as gym, e.email_contacto, e.telefono_contacto,
           p.nombre as plan, m.precio_pagado as precio, e.moneda
    from public.membresia m
    join public.socio s on s.id = m.socio_id and s.deleted_at is null
    join public.empresa e on e.id = m.empresa_id
    join public.plan p on p.id = m.plan_id
    where m.deleted_at is null and m.estado = 'activa'
      and m.fecha_fin in (current_date + 3, current_date + 1, current_date)
  loop
    v_cuando := case
      when r.fecha_fin = current_date then 'vence HOY'
      when r.fecha_fin = current_date + 1 then 'vence mañana'
      else 'vence en 3 días' end;

    -- PUSH a la app del socio (si tiene cuenta vinculada) — llega aunque no haya email.
    if r.usuario_id is not null then
      begin
        perform public.encolar_push(
          r.usuario_id,
          '⏰ Tu membresía ' || v_cuando,
          'Tu plan ' || r.plan || ' en ' || r.gym || ' ' || v_cuando ||
            '. Renueva para seguir entrenando sin cortes.',
          jsonb_build_object('tipo', 'vencimiento', 'socio_id', r.socio_id,
                             'fecha_fin', r.fecha_fin, 'empresa', r.gym)
        );
      exception when others then null; -- un push fallido no frena a los demás
      end;
    end if;

    -- EMAIL solo como RESPALDO para socios SIN app (usuario_id null): si ya tiene
    -- app recibió el push y no hace falta duplicar por correo.
    if r.usuario_id is null and v_key is not null and r.email is not null and trim(r.email) <> '' then
      v_html :=
        '<div style="font-family:sans-serif;max-width:480px">' ||
        '<h2 style="margin:0 0 8px">Hola ' || split_part(r.socio, ' ', 1) || ' 👋</h2>' ||
        '<p style="color:#444;line-height:1.6">Tu membresía <b>' || r.plan || '</b> en <b>' || r.gym || '</b> ' ||
        v_cuando || ' (' || to_char(r.fecha_fin, 'DD/MM/YYYY') || ').</p>' ||
        '<p style="color:#444;line-height:1.6">Renuévala en recepción para seguir entrenando sin cortes' ||
        case when r.precio is not null then ' — ' || coalesce(r.moneda, 'PEN') || ' ' || trim(to_char(r.precio, 'FM999990.00')) || ' el período' else '' end || '.</p>' ||
        coalesce('<p style="color:#666;font-size:13px">¿Dudas? Escríbenos: ' || r.email_contacto || coalesce(' · ' || r.telefono_contacto, '') || '</p>', '') ||
        '<p style="color:#aaa;font-size:11px;margin-top:18px">Enviado por ' || r.gym || ' a través de FitCore.</p>' ||
        '</div>';
      begin
        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'from', r.gym || ' <avisos@fitcorecenter.com>',
            'reply_to', coalesce(r.email_contacto, 'soporte@fitcorecenter.com'),
            'to', jsonb_build_array(r.email::text),
            'subject', '⏰ Tu membresía en ' || r.gym || ' ' || v_cuando,
            'html', v_html
          )
        );
      exception when others then null;
      end;
    end if;
  end loop;
end;
$function$;
