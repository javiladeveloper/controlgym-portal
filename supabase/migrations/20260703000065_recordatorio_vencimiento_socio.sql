-- ============================================================================
-- 65 · Recordatorio automático al SOCIO antes de vencer su membresía
-- Diario 15:00 UTC (10 am Lima): a los socios con email cuya membresía vence
-- en 3 días o vence HOY se les escribe a nombre de su gym (reply-to al gym).
-- Como corre una vez al día y filtra por fecha exacta, no se duplica.
-- Cierra el círculo de cobranza: el gym ve a quién cobrar en "Cobros
-- pendientes" y el socio recibe el aviso solo.
-- ============================================================================

create or replace function public.recordar_vencimientos_socios()
returns void
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_key text;
  r record;
  v_html text;
  v_cuando text;
begin
  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  if v_key is null then return; end if;

  for r in
    select m.fecha_fin, s.nombre as socio, s.email,
           e.nombre as gym, e.email_contacto, e.telefono_contacto,
           p.nombre as plan, p.precio, e.moneda
    from public.membresia m
    join public.socio s on s.id = m.socio_id and s.deleted_at is null and s.email is not null and trim(s.email) <> ''
    join public.empresa e on e.id = m.empresa_id and e.estado = 'activa' and e.deleted_at is null
    join public.plan p on p.id = m.plan_id
    where m.estado = 'activa' and m.deleted_at is null
      and m.fecha_fin in (current_date, current_date + 3)
  loop
    v_cuando := case when r.fecha_fin = current_date then 'vence HOY' else 'vence en 3 días' end;

    v_html :=
      '<div style="font-family:sans-serif;max-width:480px">' ||
      '<h2 style="margin:0 0 8px">Hola ' || split_part(r.socio, ' ', 1) || ' 👋</h2>' ||
      '<p style="color:#444;line-height:1.6">Tu membresía <b>' || r.plan || '</b> en <b>' || r.gym || '</b> ' ||
      v_cuando || ' (' || to_char(r.fecha_fin, 'DD/MM/YYYY') || ').</p>' ||
      '<p style="color:#444;line-height:1.6">Renuévala en recepción para seguir entrenando sin cortes' ||
      case when r.precio is not null then ' — ' || coalesce(r.moneda, 'PEN') || ' ' || trim(to_char(r.precio, 'FM999990.00')) || ' el período' else '' end || '.</p>' ||
      coalesce('<p style="color:#666;font-size:13px">¿Dudas? Escríbenos: ' || r.email_contacto || coalesce(' · ' || r.telefono_contacto, '') || '</p>', '') ||
      '<p style="color:#aaa;font-size:11px;margin-top:18px">Enviado por ' || r.gym || ' a través de FitControl.</p>' ||
      '</div>';

    begin
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', r.gym || ' <avisos@fitcorecenter.com>',
          'reply_to', coalesce(r.email_contacto, 'soporte@fitcorecenter.com'),
          'to', jsonb_build_array(r.email::text),
          'subject', case when r.fecha_fin = current_date
                       then '⏰ Tu membresía en ' || r.gym || ' vence HOY'
                       else 'Tu membresía en ' || r.gym || ' vence en 3 días' end,
          'html', v_html
        )
      );
    exception when others then
      null; -- un email fallido no debe frenar a los demás
    end;
  end loop;
end;
$$;

-- Diario a las 15:00 UTC (10:00 am en Lima)
select cron.schedule('fitcontrol-vencimientos-socios', '0 15 * * *', $$select public.recordar_vencimientos_socios()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-vencimientos-socios');
