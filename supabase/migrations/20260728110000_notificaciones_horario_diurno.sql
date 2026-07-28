-- Notificaciones push a horario diurno: no despertar al gym de madrugada.
--
-- PROBLEMA reportado por el owner: llegaban notificaciones a medianoche. Dos causas:
--
-- 1. sla_leads_sin_seguimiento() corría CADA HORA (fitcontrol-sla-leads, 0 * * * *)
--    y avisaba de leads sin atender a cualquier hora. Medido: 163 avisos "Lead sin
--    seguimiento" a las 00:00 (hora Perú) vs 12 en horario diurno.
--
-- 2. encolar_avisos_rutina_por_vencer() se llamaba desde el cron de facturación de
--    Vercel (4am UTC = 11pm Perú), así que el push "Rutina por vencer" llegaba de
--    noche al trainer.
--
-- FIX:
-- 1. sla_leads solo avisa en horario laboral (8:00–19:59 en la zona del gym). El
--    job sigue corriendo cada hora; fuera de ese rango simplemente no encola. Un
--    lead detectado de madrugada se avisa en la 1ª corrida de la mañana
--    (idempotente por día vía sla_lead_avisado, no se acumula).
-- 2. el aviso de rutina por vencer se movió del cron de facturación (nocturno) a un
--    pg_cron diurno `fitcontrol-rutinas-por-vencer` (10:05am Perú). Se quitó de
--    api/facturacion/index.js.

-- ── 1. Guard de horario en el SLA de leads ─────────────────────────────────
create or replace function public.sla_leads_sin_seguimiento()
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  r_empresa record; v_tz text; v_hoy date; v_hora int; r_lead record; v_admin uuid;
begin
  for r_empresa in
    select id, zona_horaria from public.empresa where estado = 'activa' and deleted_at is null
  loop
    v_tz := coalesce(r_empresa.zona_horaria, 'America/Lima');
    v_hoy := (now() at time zone v_tz)::date;
    -- No molestar de noche: solo se avisa en horario laboral (8:00–19:59 hora del
    -- gym). El job corre cada hora, así que un lead detectado de madrugada se
    -- avisa en la primera corrida de la mañana.
    v_hora := extract(hour from now() at time zone v_tz)::int;
    if v_hora < 8 or v_hora >= 20 then
      continue;
    end if;

    for r_lead in
      select l.id, l.nombre, l.asignado_a
      from public.lead l
      where l.empresa_id = r_empresa.id and l.deleted_at is null
        and l.etapa in ('nuevo', 'contactado')
        and l.created_at < now() - interval '24 hours'
        and not exists (select 1 from public.lead_tarea t where t.lead_id = l.id and t.created_at > now() - interval '24 hours')
        and not exists (select 1 from public.sla_lead_avisado a where a.lead_id = l.id and a.fecha = v_hoy)
    loop
      begin
        if r_lead.asignado_a is not null then
          perform public.encolar_push(r_lead.asignado_a, '⏰ Lead sin seguimiento',
            'Lead ' || r_lead.nombre || ' lleva más de 24h sin seguimiento.',
            jsonb_build_object('tipo','sla_lead','lead_id',r_lead.id));
        else
          for v_admin in
            select ue.usuario_id from public.usuario_empresa ue
            join public.rol r on r.id = ue.rol_id
            where ue.empresa_id = r_empresa.id and ue.activo and r.codigo = 'admin'
          loop
            perform public.encolar_push(v_admin, '⏰ Lead sin seguimiento',
              'Lead ' || r_lead.nombre || ' lleva más de 24h sin seguimiento.',
              jsonb_build_object('tipo','sla_lead','lead_id',r_lead.id));
          end loop;
        end if;
        insert into public.sla_lead_avisado (lead_id, fecha) values (r_lead.id, v_hoy) on conflict do nothing;
      exception when others then null; -- un fallo individual no frena a los demás
      end;
    end loop;
  end loop;
  perform public.llamar_push_worker();
end;
$function$;

-- ── 2. Aviso de rutina por vencer → pg_cron diurno (10:05am Perú) ───────────
-- Antes se llamaba desde el cron de facturación de Vercel (11pm Perú).
select cron.schedule('fitcontrol-rutinas-por-vencer', '5 15 * * *',
  $$ select public.encolar_avisos_rutina_por_vencer(); select public.llamar_push_worker(); $$);
