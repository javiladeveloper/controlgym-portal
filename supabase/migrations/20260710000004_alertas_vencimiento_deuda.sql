-- Idea Image Gym #1 — Alertas de vencimiento y deuda.
-- 1) recordar_vencimientos_socios: ventana 1-2 días antes (antes hoy/+3) + PUSH
--    a la app además del email.
-- 2) socios_por_cobrar(sede): lista de socios con deuda (vencidos/moroso) o por
--    vencer (1-2 días) para el panel.
-- 3) alertar_socio(socio_id): recordatorio manual (push + email) al instante.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Recordatorio automático (cron diario). Ahora 1-2 días antes + push.
create or replace function public.recordar_vencimientos_socios()
returns void
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
declare
  v_key text;
  r record;
  v_html text;
  v_cuando text;
begin
  select valor into v_key from privado.secreto where clave = 'resend_api_key';

  for r in
    select m.fecha_fin, s.id as socio_id, s.usuario_id, s.nombre as socio, s.email,
           e.nombre as gym, e.email_contacto, e.telefono_contacto,
           p.nombre as plan, p.precio, e.moneda
    from public.membresia m
    join public.socio s on s.id = m.socio_id and s.deleted_at is null
    join public.empresa e on e.id = m.empresa_id and e.estado = 'activa' and e.deleted_at is null
    join public.plan p on p.id = m.plan_id
    where m.estado = 'activa' and m.deleted_at is null
      -- 1-2 días antes (y el mismo día) — Image Gym pidió avisar 1-2 días antes.
      and m.fecha_fin in (current_date, current_date + 1, current_date + 2)
  loop
    v_cuando := case when r.fecha_fin = current_date then 'vence HOY'
                     when r.fecha_fin = current_date + 1 then 'vence mañana'
                     else 'vence en 2 días' end;

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

    -- EMAIL (si tiene correo y hay API key configurada).
    if v_key is not null and r.email is not null and trim(r.email) <> '' then
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lista para el panel: socios con DEUDA o POR VENCER.
--    · con_deuda: membresía activa ya vencida (fecha_fin < hoy) o socio 'moroso',
--      o con saldo pendiente (monto_pagado < precio_pagado+matricula).
--    · por_vencer: membresía activa que vence hoy / +1 / +2.
create or replace function public.socios_por_cobrar(p_sede_id uuid default null)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.orden, t.fecha_fin), '[]'::jsonb)
  from (
    select distinct on (s.id)
      s.id as socio_id, s.nombre, s.codigo, s.telefono, s.email,
      s.usuario_id is not null as tiene_app,
      m.fecha_fin, p.nombre as plan,
      greatest(0, coalesce(m.precio_pagado,0) + coalesce(m.matricula_pagada,0) - coalesce(m.monto_pagado,0)) as saldo,
      case
        when m.fecha_fin < current_date or s.estado = 'moroso' then 'deuda'
        else 'por_vencer' end as tipo,
      case
        when m.fecha_fin < current_date or s.estado = 'moroso' then 0  -- deuda primero
        else 1 end as orden
    from public.socio s
    join public.membresia m on m.socio_id = s.id and m.estado = 'activa' and m.deleted_at is null
    join public.plan p on p.id = m.plan_id
    where s.empresa_id = public.auth_empresa_id() and s.deleted_at is null
      and (p_sede_id is null or s.sede_id = p_sede_id)
      and (
        m.fecha_fin < current_date                                   -- vencida
        or s.estado = 'moroso'                                       -- marcado moroso
        or m.fecha_fin in (current_date, current_date+1, current_date+2)  -- por vencer 1-2d
        or greatest(0, coalesce(m.precio_pagado,0)+coalesce(m.matricula_pagada,0)-coalesce(m.monto_pagado,0)) > 0  -- saldo
      )
    order by s.id, m.fecha_fin desc
  ) t;
$function$;

grant execute on function public.socios_por_cobrar(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Recordatorio MANUAL a un socio (push + email al instante). Solo admin/recepción.
create or replace function public.alertar_socio(p_socio_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_s record; v_key text; v_html text; v_via text := '';
begin
  if v_empresa is null or not (public.auth_is_admin() or public.auth_rol() in ('admin','recepcion')) then
    raise exception 'No autorizado';
  end if;

  select s.nombre, s.usuario_id, s.email, e.nombre as gym, e.email_contacto,
         p.nombre as plan, m.fecha_fin
    into v_s
    from public.socio s
    join public.membresia m on m.socio_id = s.id and m.estado = 'activa' and m.deleted_at is null
    join public.plan p on p.id = m.plan_id
    join public.empresa e on e.id = s.empresa_id
   where s.id = p_socio_id and s.empresa_id = v_empresa and s.deleted_at is null
   order by m.fecha_fin desc limit 1;
  if v_s.nombre is null then raise exception 'Socio o membresía no encontrada'; end if;

  -- Push
  if v_s.usuario_id is not null then
    begin
      perform public.encolar_push(
        v_s.usuario_id, '💳 Recordatorio de pago',
        'Tu membresía ' || v_s.plan || ' en ' || v_s.gym || ' está por vencer (' ||
          to_char(v_s.fecha_fin, 'DD/MM') || '). Acércate a renovar.',
        jsonb_build_object('tipo', 'recordatorio_pago', 'socio_id', p_socio_id));
      v_via := 'push';
    exception when others then null; end;
  end if;

  -- Email
  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  if v_key is not null and v_s.email is not null and trim(v_s.email) <> '' then
    v_html := '<div style="font-family:sans-serif;max-width:480px"><h2>Hola ' || split_part(v_s.nombre,' ',1) ||
      ' 👋</h2><p style="color:#444;line-height:1.6">Te recordamos que tu membresía <b>' || v_s.plan ||
      '</b> en <b>' || v_s.gym || '</b> vence el ' || to_char(v_s.fecha_fin,'DD/MM/YYYY') ||
      '. Acércate a recepción para renovar y seguir entrenando.</p></div>';
    begin
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object('from', v_s.gym || ' <avisos@fitcorecenter.com>',
          'reply_to', coalesce(v_s.email_contacto,'soporte@fitcorecenter.com'),
          'to', jsonb_build_array(v_s.email::text),
          'subject', '💳 Recordatorio de pago — ' || v_s.gym, 'html', v_html));
      v_via := trim(both ' +' from v_via || ' + email');
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true, 'via', nullif(v_via, ''), 'socio', v_s.nombre);
end;
$function$;

grant execute on function public.alertar_socio(uuid) to authenticated;
