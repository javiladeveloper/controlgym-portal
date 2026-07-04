-- 044: Remitente propio (dominio verificado en Resend).
-- Los 3 correos automáticos pasan de onboarding@resend.dev a
-- FitControl <avisos@fitcorecenter.com>: mejor entrega y sin la restricción
-- de test-mode (ya pueden llegar a cualquier gimnasio, no solo al dueño).

-- 1) Notificación de nuevos leads (era 034)
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
    return new;
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
    '<p style="color:#888;font-size:12px;margin-top:18px">Contáctalo pronto: los leads atendidos en minutos convierten mucho más. — FitControl</p>' ||
    '</div>';

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'FitControl <avisos@fitcorecenter.com>',
        'to', jsonb_build_array(v_email),
        'subject', '🔥 Nuevo interesado: ' || new.nombre || ' (' || coalesce(new.fuente, 'Panel') || ')',
        'html', v_html
      )
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

-- 2) Recordatorios de fin de prueba (era 043)
create or replace function public.mantener_trials()
returns void
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_key text;
  r record;
  v_dias int;
  v_html text;
  v_asunto text;
begin
  update public.suscripcion_plataforma
  set estado = 'vencida'
  where estado = 'prueba' and trial_hasta < current_date;

  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  if v_key is null then return; end if;

  for r in
    select s.id, s.plan_slug, s.monto, s.trial_hasta, e.nombre, e.email_contacto
    from public.suscripcion_plataforma s
    join public.empresa e on e.id = s.empresa_id
    where s.estado = 'prueba'
      and e.email_contacto is not null
      and s.trial_hasta - current_date in (5, 0)
  loop
    v_dias := r.trial_hasta - current_date;
    if v_dias = 0 then
      v_asunto := 'Tu prueba gratis de FitControl termina HOY';
    else
      v_asunto := 'Tu prueba gratis de FitControl termina en ' || v_dias || ' días';
    end if;

    v_html :=
      '<div style="font-family:sans-serif;max-width:480px">' ||
      '<h2 style="margin:0 0 8px">Hola, equipo de ' || r.nombre || ' 👋</h2>' ||
      '<p style="color:#444;line-height:1.6">' ||
      case when v_dias = 0
        then 'Hoy termina tu mes de prueba gratis en FitControl.'
        else 'Tu mes de prueba gratis termina en <b>' || v_dias || ' días</b>.'
      end ||
      ' Para seguir sin interrupciones, activa tu plan <b>' || initcap(r.plan_slug) ||
      '</b> (S/ ' || r.monto || '/mes) desde tu panel — y tu primer cobro recién saldrá 1 mes después de activarlo.</p>' ||
      '<p style="margin:22px 0"><a href="https://app.fitcorecenter.com/configuracion" ' ||
      'style="background:#FF6B35;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Activar mi plan</a></p>' ||
      '<p style="color:#888;font-size:12px">¿Dudas? Escríbenos por WhatsApp al +51 986 110 558 o a soporte@fitcorecenter.com — FitControl</p>' ||
      '</div>';

    begin
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'FitControl <avisos@fitcorecenter.com>',
          'to', jsonb_build_array(r.email_contacto),
          'subject', v_asunto,
          'html', v_html
        )
      );
    exception when others then
      null;
    end;
  end loop;
end;
$$;

-- 3) Libro de Reclamaciones (era 042) — solo cambia el 'from'
create or replace function public.crear_reclamacion(
  p_tipo text,
  p_nombre text,
  p_documento text,
  p_email text,
  p_bien text,
  p_detalle text,
  p_pedido text,
  p_direccion text default null,
  p_telefono text default null,
  p_monto numeric default null,
  p_es_menor boolean default false,
  p_apoderado text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_num int;
  v_corr text;
  v_key text;
  v_html text;
begin
  if p_tipo not in ('reclamo', 'queja') then
    raise exception 'Tipo inválido';
  end if;
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_documento), '') = ''
     or coalesce(trim(p_email), '') = '' or coalesce(trim(p_detalle), '') = ''
     or coalesce(trim(p_pedido), '') = '' or coalesce(trim(p_bien), '') = '' then
    raise exception 'Completa todos los campos obligatorios';
  end if;

  v_num := nextval('public.reclamacion_seq');
  v_corr := 'LR-' || to_char(now(), 'YYYY') || '-' || lpad(v_num::text, 4, '0');

  insert into public.reclamacion (
    correlativo, tipo, nombre, documento, direccion, telefono, email,
    es_menor, apoderado, bien, monto, detalle, pedido
  ) values (
    v_corr, p_tipo, trim(p_nombre), trim(p_documento), nullif(trim(coalesce(p_direccion,'')),''),
    nullif(trim(coalesce(p_telefono,'')),''), trim(p_email),
    coalesce(p_es_menor, false), nullif(trim(coalesce(p_apoderado,'')),''),
    trim(p_bien), p_monto, trim(p_detalle), trim(p_pedido)
  );

  begin
    select valor into v_key from privado.secreto where clave = 'resend_api_key';
    if v_key is not null then
      v_html :=
        '<div style="font-family:sans-serif;max-width:520px">' ||
        '<h2 style="margin:0 0 4px">📖 ' || initcap(p_tipo) || ' ' || v_corr || '</h2>' ||
        '<p style="color:#B00;margin:0 0 14px"><b>Plazo legal de respuesta: 15 días hábiles.</b></p>' ||
        '<table style="font-size:14px;line-height:1.9">' ||
        '<tr><td style="color:#888;padding-right:12px">Consumidor</td><td><b>' || p_nombre || '</b> (' || p_documento || ')</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Contacto</td><td>' || p_email || coalesce(' · ' || p_telefono, '') || '</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Servicio</td><td>' || p_bien || coalesce(' · S/ ' || p_monto::text, '') || '</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Detalle</td><td>' || p_detalle || '</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Pedido</td><td>' || p_pedido || '</td></tr>' ||
        '</table></div>';
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'FitControl <avisos@fitcorecenter.com>',
          'to', jsonb_build_array('fitcorecenterpe@gmail.com'),
          'subject', '📖 Libro de Reclamaciones: ' || initcap(p_tipo) || ' ' || v_corr,
          'html', v_html
        )
      );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object('correlativo', v_corr);
end;
$$;
