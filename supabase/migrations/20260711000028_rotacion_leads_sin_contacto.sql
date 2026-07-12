-- Regla del cliente (jul 2026): un lead tiene una VENTANA con su asesor. Si en
-- 7 días el comunicador no logra contactarlo (el lead sigue en etapa 'nuevo'),
-- se le retira y pasa a otro asesor. "Contactado" = avanzó de etapa; ahí la
-- rotación ya no aplica.

-- 1) ¿Desde cuándo lo tiene? La ventana corre desde la ASIGNACIÓN (no desde
-- que el lead se creó): cada reasignación reinicia el reloj.
alter table public.lead add column if not exists asignado_at timestamptz;
update public.lead set asignado_at = created_at where asignado_at is null and asignado_a is not null;

create or replace function public.stamp_lead_asignado_at()
returns trigger language plpgsql as $$
begin
  if new.asignado_a is distinct from old.asignado_a then
    new.asignado_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_lead_stamp_asignado on public.lead;
create trigger trg_lead_stamp_asignado
  before update on public.lead
  for each row execute function public.stamp_lead_asignado_at();

-- El insert lo cubre el trigger de asignación automática: sellamos ahí también.
create or replace function public.asignar_lead_automatico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_com uuid;
begin
  if new.asignado_a is not null then
    new.asignado_at := coalesce(new.asignado_at, now());
    return new;
  end if;

  -- ¿El que registra es comunicador de esta empresa? Es su prospecto.
  if auth.uid() is not null and exists (
    select 1 from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id and r.codigo = 'comunicador'
    where ue.usuario_id = auth.uid() and ue.empresa_id = new.empresa_id
  ) then
    new.asignado_a := auth.uid();
    new.asignado_at := now();
    return new;
  end if;

  -- Canal del gym (web/app/admin sin responsable): reparto equitativo.
  select ue.usuario_id into v_com
  from public.usuario_empresa ue
  join public.rol r on r.id = ue.rol_id and r.codigo = 'comunicador'
  join public.usuario u on u.id = ue.usuario_id and coalesce(u.activo, true)
  where ue.empresa_id = new.empresa_id
  order by (
      select count(*) from public.lead l
      where l.empresa_id = new.empresa_id
        and l.asignado_a = ue.usuario_id
        and l.etapa <> 'inscrito'
    ) asc, u.nombre asc
  limit 1;

  if v_com is not null then
    new.asignado_a := v_com;
    new.asignado_at := now();
    perform public.encolar_push(v_com, 'Nuevo prospecto 🎯',
      coalesce(new.nombre, 'Alguien') || ' llegó por ' || coalesce(new.fuente, 'la web') || '. Contáctalo pronto.',
      jsonb_build_object('tipo', 'lead_asignado', 'lead_id', new.id));
  end if;

  return new;
end $$;

-- 2) La rotación: corre a diario (cron). Devuelve cuántos rotó.
create or replace function public.rotar_leads_sin_contacto(p_dias int default 7)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; v_nuevo uuid; v_rotados int := 0;
begin
  for r in
    select l.id, l.empresa_id, l.nombre, l.asignado_a
    from public.lead l
    where l.etapa = 'nuevo'            -- nunca lo contactó: si avanzó de etapa, no se rota
      and l.asignado_a is not null
      and l.deleted_at is null
      and coalesce(l.asignado_at, l.created_at) < now() - make_interval(days => p_dias)
  loop
    -- Otro comunicador activo de la misma empresa, el menos cargado.
    select ue.usuario_id into v_nuevo
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id and ro.codigo = 'comunicador'
    join public.usuario u on u.id = ue.usuario_id and coalesce(u.activo, true)
    where ue.empresa_id = r.empresa_id
      and ue.usuario_id <> r.asignado_a  -- si es el único comunicador, no hay a quién rotar
    order by (
        select count(*) from public.lead l2
        where l2.empresa_id = r.empresa_id
          and l2.asignado_a = ue.usuario_id
          and l2.etapa <> 'inscrito'
      ) asc, u.nombre asc
    limit 1;

    if v_nuevo is null then
      continue;
    end if;

    update public.lead set asignado_a = v_nuevo where id = r.id; -- el trigger reinicia asignado_at

    perform public.encolar_push(v_nuevo, 'Prospecto reasignado a ti 🔁',
      coalesce(r.nombre, 'Un prospecto') || ' llevaba ' || p_dias || ' días sin ser contactado. Ahora es tuyo — dale prioridad.',
      jsonb_build_object('tipo', 'lead_rotado', 'lead_id', r.id));
    perform public.encolar_push(r.asignado_a, 'Prospecto rotado a otro asesor',
      coalesce(r.nombre, 'Un prospecto') || ' pasó a otro compañero tras ' || p_dias || ' días sin contacto.',
      jsonb_build_object('tipo', 'lead_rotado_saliente', 'lead_id', r.id));

    v_rotados := v_rotados + 1;
  end loop;

  return v_rotados;
end $$;

revoke all on function public.rotar_leads_sin_contacto(int) from public;

-- 3) Cron diario 13:45 UTC = 08:45 en Lima (hora útil para el push matinal).
select cron.unschedule(jobid) from cron.job where jobname = 'fitcontrol-rotacion-leads';
select cron.schedule('fitcontrol-rotacion-leads', '45 13 * * *', 'select public.rotar_leads_sin_contacto(7)');
