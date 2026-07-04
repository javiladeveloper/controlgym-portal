-- 043: Ciclo de vida del trial, automático (pg_cron diario, 9am Lima).
--  1) Marca 'vencida' toda prueba pasada de fecha (global, no solo lazy).
--  2) Invita por email a activar el plan: 5 días antes y el día del vencimiento.
--     El email va al correo de contacto de la empresa vía Resend (pg_net).

create extension if not exists pg_cron;

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
  -- 1) vencer pruebas pasadas
  update public.suscripcion_plataforma
  set estado = 'vencida'
  where estado = 'prueba' and trial_hasta < current_date;

  -- 2) recordatorios (5 días antes y el mismo día)
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
          'from', 'FitControl <onboarding@resend.dev>',
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

-- Corre todos los días a las 14:00 UTC (9:00 am en Lima)
select cron.schedule('fitcontrol-trials', '0 14 * * *', $$select public.mantener_trials()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-trials');
