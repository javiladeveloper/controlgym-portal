-- Los avisos de leads dejan de perseguir al equipo para siempre.
--
-- PROBLEMA reportado por el owner (2026-09-02, con captura de su celular):
-- recibía cada mañana el mismo bloque de "⏰ Lead sin seguimiento" con nombres
-- de leads de JULIO. Su frase: "no pueden llegarme... oye este lead no lo
-- atiendes hace 1 año".
--
-- Medido en producción ese día: los 22 leads abiertos (nuevo/contactado) tenían
-- entre 52 y 61 días. El más reciente era del 12 de julio. CERO leads nuevos en
-- dos meses, y aun así 7 avisos de SLA esa mañana.
--
-- CAUSA 1 — el SLA tenía piso pero no techo:
--     and l.created_at < now() - interval '24 hours'
-- "más de 24h" lo cumple un lead de ayer y uno de hace un año por igual. El
-- guard de sla_lead_avisado es por DÍA (no acumula dentro del día), así que el
-- lead reaparecía puntualmente cada mañana, indefinidamente.
--
-- CAUSA 2 — la rotación no terminaba nunca. Un lead en etapa 'nuevo' rotaba de
-- asesor cada 7 días de por vida, y cada vuelta disparaba DOS push (al que lo
-- recibe y al que lo pierde). Evidencia: "Cynthia Alvarado (demo)", creada el
-- 2026-07-09, seguía siendo reasignada el 2026-09-01 — ~7 vueltas.
--
-- EL DAÑO no es el volumen, es que los avisos muertos ENTIERRAN a los vivos: un
-- lead real de Finny llega a la misma bandeja que siete fantasmas de julio, y el
-- comunicador ya aprendió a deslizar sin leer.
--
-- FIX (decisiones del owner):
-- 1. El SLA avisa solo dentro de una VENTANA (7 días por defecto). Pasado eso el
--    lead no es "sin seguimiento", es frío: se trabaja en el CRM, no con un push.
-- 2. La rotación cuenta vueltas y se detiene: a las 2 vueltas sin contacto el
--    lead pasa a 'perdido' con motivo, sale del circuito y del ruido.

-- ── 1. Contador de vueltas de rotación ─────────────────────────────────────
-- Sin esto no hay forma de saber si un lead ya dio la vuelta o recién entra.
alter table public.lead add column if not exists veces_rotado int not null default 0;

comment on column public.lead.veces_rotado is
  'Cuántas veces la rotación automática cambió de asesor a este lead sin lograr contacto. Al llegar al tope (ver rotar_leads_sin_contacto) el lead se marca perdido en vez de seguir girando.';

-- Una reasignación MANUAL (un admin moviendo el lead a dedo) es una decisión
-- humana nueva, no una vuelta más del automático: reinicia el contador para que
-- el lead tenga su ventana completa con el nuevo dueño. El automático vuelve a
-- subirlo él mismo tras el update.
create or replace function public.stamp_lead_asignado_at()
returns trigger language plpgsql as $$
begin
  if new.asignado_a is distinct from old.asignado_a then
    new.asignado_at := now();
    -- Si quien reasigna es una persona (hay sesión), el contador vuelve a cero.
    -- La rotación automática corre por cron, sin auth.uid(), y conserva la cuenta.
    if auth.uid() is not null then
      new.veces_rotado := 0;
    end if;
  end if;
  return new;
end $$;

-- ── 2. El SLA avisa dentro de una ventana, no para siempre ─────────────────
-- OJO con la sobrecarga: el cron 'fitcontrol-sla-leads' llama
-- `sla_leads_sin_seguimiento()` SIN argumentos. Añadir un parámetro con default
-- NO reemplaza esa firma — crea una segunda función y la vieja (la rota, sin
-- techo) seguiría siendo la que corre cada hora. Por eso se borra primero.
drop function if exists public.sla_leads_sin_seguimiento();

-- p_dias_ventana: hasta qué antigüedad tiene sentido el recordatorio diario.
create or replace function public.sla_leads_sin_seguimiento(p_dias_ventana int default 7)
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
        -- EL TECHO. Sin esta línea el aviso persigue al equipo indefinidamente:
        -- un lead de hace un año cumple "más de 24h" igual que uno de ayer.
        and l.created_at >= now() - make_interval(days => p_dias_ventana)
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

revoke all on function public.sla_leads_sin_seguimiento(int) from public, anon, authenticated;

-- ── 3. La rotación termina: 2 vueltas y el lead se marca perdido ───────────
-- Base: la versión de 20260716000003 (mira el PERMISO 'leads', no el rol).
-- Se le suma el corte por vueltas.
-- Mismo cuidado que arriba con la sobrecarga: la firma vieja de un solo
-- parámetro debe morir, o quedaría una rotación sin fin invocable.
drop function if exists public.rotar_leads_sin_contacto(int);

create or replace function public.rotar_leads_sin_contacto(
  p_dias int default 7,
  p_max_vueltas int default 2
)
returns int language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record; v_nuevo uuid; v_rotados int := 0;
begin
  for r in
    select l.id, l.empresa_id, l.nombre, l.asignado_a, l.veces_rotado
    from public.lead l
    where l.etapa = 'nuevo'            -- nunca lo contactó: si avanzó de etapa, no se rota
      and l.asignado_a is not null
      and l.deleted_at is null
      and coalesce(l.asignado_at, l.created_at) < now() - make_interval(days => p_dias)
  loop
    -- FIN DEL CIRCUITO. Si ya dio las vueltas permitidas y nadie lo contactó,
    -- otro asesor no lo va a lograr: rotarlo de nuevo solo reparte la culpa y
    -- genera dos push más. Se cierra con motivo y queda en el CRM con su
    -- historial, reactivable por campaña.
    if r.veces_rotado >= p_max_vueltas then
      update public.lead
        set etapa = 'perdido',
            motivo_perdida = coalesce(motivo_perdida,
              'Sin contacto tras ' || r.veces_rotado || ' reasignaciones automáticas'),
            perdido_at = now()
        where id = r.id;
      update public.lead_tarea set completada = true where lead_id = r.id and not completada;
      continue;
    end if;

    -- Otro usuario con permiso 'leads', activo, de la misma empresa, el menos cargado.
    select ue.usuario_id into v_nuevo
    from public.usuario_empresa ue
    join public.usuario u on u.id = ue.usuario_id and coalesce(u.activo, true)
    where ue.empresa_id = r.empresa_id
      and public.usuario_tiene_permiso(ue.usuario_id, ue.empresa_id, 'leads')
      and ue.usuario_id <> r.asignado_a  -- si es el único que atiende leads, no hay a quién rotar
    order by (
        select count(*) from public.lead l2
        where l2.empresa_id = r.empresa_id
          and l2.asignado_a = ue.usuario_id
          and l2.etapa not in ('inscrito','perdido')
      ) asc, u.nombre asc
    limit 1;

    if v_nuevo is null then
      continue;
    end if;

    -- El trigger reinicia asignado_at; el contador sube aquí porque esta vuelta
    -- la decidió el automático (sin auth.uid(), así que el trigger no lo pisa).
    update public.lead
      set asignado_a = v_nuevo, veces_rotado = r.veces_rotado + 1
      where id = r.id;

    perform public.encolar_push(v_nuevo, 'Prospecto reasignado a ti 🔁',
      coalesce(r.nombre, 'Un prospecto') || ' llevaba ' || p_dias || ' días sin ser contactado. Ahora es tuyo — dale prioridad.',
      jsonb_build_object('tipo', 'lead_rotado', 'lead_id', r.id));
    perform public.encolar_push(r.asignado_a, 'Prospecto rotado a otro asesor',
      coalesce(r.nombre, 'Un prospecto') || ' pasó a otro compañero tras ' || p_dias || ' días sin contacto.',
      jsonb_build_object('tipo', 'lead_rotado_saliente', 'lead_id', r.id));

    v_rotados := v_rotados + 1;
  end loop;

  return v_rotados;
end $function$;

revoke all on function public.rotar_leads_sin_contacto(int, int) from public, anon, authenticated;

-- ── 4. Los leads viejos que ya venían girando arrancan con su deuda ────────
-- Sin esto, un lead que lleva 7 vueltas empezaría en 0 y se ganaría 2 vueltas
-- más de ruido. Los que ya superaron la ventana del SLA se dan por rotados.
update public.lead
  set veces_rotado = greatest(veces_rotado, 2)
  where etapa = 'nuevo'
    and deleted_at is null
    and asignado_a is not null
    and created_at < now() - interval '14 days';

-- ── 5. El cron pasa a la firma nueva ───────────────────────────────────────
-- (mismo horario: 13:45 UTC = 08:45 en Lima)
select cron.unschedule(jobid) from cron.job where jobname = 'fitcontrol-rotacion-leads';
select cron.schedule('fitcontrol-rotacion-leads', '45 13 * * *',
  'select public.rotar_leads_sin_contacto(7, 2)');
