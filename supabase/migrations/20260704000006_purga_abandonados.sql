-- ============================================================================
-- 77 (20260704000006) · Ciclo de vida de gyms abandonados
-- Un negocio que venció su prueba y NUNCA pagó:
--   · día 45 tras el vencimiento → email de aviso al creador (15 días de gracia)
--   · día 60 → se ARCHIVA: soft-delete, página apagada, vínculos removidos,
--     subdominio eliminado de Vercel → el slug queda libre para otro gym
-- Los que alguna vez pagaron o tienen suscripción Culqi jamás se tocan.
-- ============================================================================

create or replace function public.purgar_abandonados()
returns void
language plpgsql security definer
set search_path = public, net
as $$
declare
  r record;
  v_key text;
  v_vercel text;
begin
  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  select valor into v_vercel from privado.secreto where clave = 'vercel_token';

  -- ── Aviso a los 45 días de vencida (día exacto: el cron diario no duplica) ─
  for r in
    select e.id, e.nombre, e.slug, e.email_contacto, sp.trial_hasta
    from public.empresa e
    join public.suscripcion_plataforma sp on sp.empresa_id = e.id
    where e.deleted_at is null
      and sp.estado = 'vencida'
      and sp.proveedor_suscripcion_id is null
      and not exists (select 1 from public.pago_plataforma p where p.empresa_id = e.id and p.estado = 'exitoso')
      and sp.trial_hasta = current_date - 45
  loop
    if v_key is not null and r.email_contacto is not null then
      begin
        perform net.http_post(
          url := 'https://api.resend.com/emails',
          headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
          body := jsonb_build_object(
            'from', 'FitControl <avisos@fitcorecenter.com>',
            'to', jsonb_build_array(r.email_contacto),
            'subject', '⏳ ' || r.nombre || ' se archivará en 15 días',
            'html', '<div style="font-family:sans-serif;max-width:480px">' ||
              '<h2 style="margin:0 0 8px">Tu espacio está por archivarse</h2>' ||
              '<p style="color:#444;line-height:1.6">La prueba de <b>' || r.nombre || '</b> terminó hace 45 días y el plan no se activó. ' ||
              'En <b>15 días</b> archivaremos el espacio y su dirección <b>' || r.slug || '.fitcorecenter.com</b> quedará disponible para otro negocio.</p>' ||
              '<p style="color:#444;line-height:1.6">Si quieres conservarlo (tus socios, tu página, todo sigue guardado), solo activa tu plan:</p>' ||
              '<p style="margin:22px 0"><a href="https://app.fitcorecenter.com/configuracion?tab=plan" style="background:#FF6B35;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Activar mi plan</a></p>' ||
              '<p style="color:#888;font-size:12px">— FitControl</p></div>'
          )
        );
      exception when others then null;
      end;
    end if;
  end loop;

  -- ── Archivo a los 60 días ───────────────────────────────────────────────
  for r in
    select e.id, e.slug
    from public.empresa e
    join public.suscripcion_plataforma sp on sp.empresa_id = e.id
    where e.deleted_at is null
      and sp.estado = 'vencida'
      and sp.proveedor_suscripcion_id is null
      and not exists (select 1 from public.pago_plataforma p where p.empresa_id = e.id and p.estado = 'exitoso')
      and sp.trial_hasta <= current_date - 60
  loop
    update public.empresa set deleted_at = now(), landing_activa = false where id = r.id;
    update public.suscripcion_plataforma set estado = 'cancelada' where empresa_id = r.id;
    delete from public.usuario_sede where empresa_id = r.id;
    delete from public.usuario_empresa where empresa_id = r.id;

    -- Liberar el subdominio en Vercel (el slug ya quedó libre en la BD porque
    -- la unicidad ignora empresas borradas)
    if v_vercel is not null then
      begin
        perform net.http_delete(
          url := 'https://api.vercel.com/v9/projects/fitcore/domains/' || r.slug ||
                 '.fitcorecenter.com?teamId=team_kr4GLmjqzYi9UCOFFz8MPoR6',
          headers := jsonb_build_object('Authorization', 'Bearer ' || v_vercel)
        );
      exception when others then null;
      end;
    end if;
  end loop;
end;
$$;

-- Diario a las 14:10 UTC (tras mantener_trials, que es quien pone 'vencida')
select cron.schedule('fitcontrol-purgar-abandonados', '10 14 * * *', $$select public.purgar_abandonados()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-purgar-abandonados');
