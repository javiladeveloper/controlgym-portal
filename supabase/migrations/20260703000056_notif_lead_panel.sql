-- 056: El nuevo interesado tambien suena en la campanita del panel
-- (ademas del email): notificar_lead inserta en notificacion.
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
  -- Campanita del panel (nunca bloquea)
  begin
    insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
    values (new.empresa_id, new.sede_id, 'lead',
            'Nuevo interesado: ' || new.nombre,
            coalesce('Llego desde ' || new.fuente, 'Registrado en el panel'),
            'info', 'lead', new.id);
  exception when others then
    null;
  end;

  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  select email_contacto, nombre into v_email, v_gym from public.empresa where id = new.empresa_id;

  if v_key is null or v_email is null then
    return new;
  end if;

  v_html :=
    '<div style="font-family:sans-serif;max-width:480px">' ||
    '<h2 style="margin:0 0 4px">Nuevo interesado en ' || coalesce(v_gym, 'tu gimnasio') || '</h2>' ||
    '<p style="color:#555;margin:0 0 16px">Llego desde: <b>' || coalesce(new.fuente, 'Panel') || '</b></p>' ||
    '<table style="font-size:14px;line-height:1.9">' ||
    '<tr><td style="color:#888;padding-right:12px">Nombre</td><td><b>' || new.nombre || '</b></td></tr>' ||
    coalesce('<tr><td style="color:#888;padding-right:12px">Telefono</td><td><b>' || new.telefono || '</b></td></tr>', '') ||
    coalesce('<tr><td style="color:#888;padding-right:12px">Correo</td><td>' || new.email || '</td></tr>', '') ||
    coalesce('<tr><td style="color:#888;padding-right:12px">Nota</td><td>' || new.nota || '</td></tr>', '') ||
    '</table>' ||
    '<p style="color:#888;font-size:12px;margin-top:18px">Contactalo pronto: los leads atendidos en minutos convierten mucho mas. — FitControl</p>' ||
    '</div>';

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'FitControl <avisos@fitcorecenter.com>',
        'to', jsonb_build_array(v_email),
        'subject', 'Nuevo interesado: ' || new.nombre || ' (' || coalesce(new.fuente, 'Panel') || ')',
        'html', v_html
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;
