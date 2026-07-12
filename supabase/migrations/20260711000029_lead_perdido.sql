-- Etapa terminal 'perdido' (pedido del owner: "no todos al final se
-- convierten... algunos simplemente no contestan"). Un lead perdido sale del
-- embudo, guarda su MOTIVO, cierra sus tareas pendientes y deja de contar
-- como carga en el reparto/rotación. Se puede reabrir (vuelve a 'contactado').

-- 1) CHECK de etapa con 'perdido' + columnas de motivo
do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
  where conrelid = 'public.lead'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%etapa%';
  if v_con is not null then
    execute format('alter table public.lead drop constraint %I', v_con);
  end if;
end $$;
alter table public.lead add constraint lead_etapa_check
  check (etapa = any (array['nuevo','contactado','clase_prueba','inscrito','perdido']));

alter table public.lead add column if not exists motivo_perdida text;
alter table public.lead add column if not exists perdido_at timestamptz;

-- 2) Marcar perdido: valida empresa, cierra tareas, sella motivo y fecha.
create or replace function public.marcar_lead_perdido(p_lead_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lead public.lead;
begin
  select * into v_lead from public.lead where id = p_lead_id and deleted_at is null;
  if v_lead.id is null then return jsonb_build_object('ok', false, 'motivo', 'lead_inexistente'); end if;
  if public.auth_empresa_id() is distinct from v_lead.empresa_id then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  if v_lead.socio_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ya_es_socio'); end if;

  update public.lead
    set etapa = 'perdido', motivo_perdida = nullif(trim(p_motivo), ''), perdido_at = now()
    where id = p_lead_id;
  update public.lead_tarea set completada = true where lead_id = p_lead_id and not completada;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.marcar_lead_perdido(uuid, text) from public;
grant execute on function public.marcar_lead_perdido(uuid, text) to authenticated;

-- 3) El reparto y la rotación ya no cuentan perdidos como carga
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
        and l.etapa not in ('inscrito','perdido')
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
          and l2.etapa not in ('inscrito','perdido')
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

