-- Task 3 de permisos granulares: la ROTACIÓN de leads sin contacto y la
-- AGENDA "solo mis tareas" pasan de mirar el rol 'comunicador' a mirar el
-- permiso 'leads' (usuario_tiene_permiso / auth_tiene_permiso, Task 1 y 2).
-- ADITIVA: el comunicador conserva su comportamiento EXACTO (tiene 'leads'
-- por rol base en el mapa fijo). Solo se SUMA quien tenga el permiso extra.

-- 1) Rotación: "otro comunicador menos cargado" -> "otro usuario con permiso
-- 'leads' menos cargado". Dentro del loop se evalúan OTROS usuarios (los
-- candidatos a recibir el lead), así que usamos usuario_tiene_permiso
-- (mismo patrón que asignar_lead_automatico en Task 2).
CREATE OR REPLACE FUNCTION public.rotar_leads_sin_contacto(p_dias integer DEFAULT 7)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

-- 2) Agenda "solo mis tareas": quien atiende leads (permiso 'leads', ya sea
-- por rol base comunicador o extra) solo ve SUS tareas; quien no, ve todas
-- (admin/recepción, vista de supervisión). Usamos auth_tiene_permiso porque
-- evalúa al usuario logueado (auth.uid()/JWT), no a un usuario arbitrario.
CREATE OR REPLACE FUNCTION public.agenda_comercial()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_vencidas jsonb;
  v_hoy_j jsonb;
  v_proximas jsonb;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'lead_id', t.lead_id, 'lead_nombre', l.nombre,
      'lead_telefono', l.telefono, 'tipo', t.tipo, 'detalle', t.detalle,
      'vence_at', t.vence_at, 'asignado_a', t.asignado_a, 'asignado_nombre', u.nombre
    ) order by t.vence_at asc
  ), '[]'::jsonb)
  into v_vencidas
  from public.lead_tarea t
  join public.lead l on l.id = t.lead_id
  left join public.usuario u on u.id = t.asignado_a
  where t.empresa_id = v_empresa and not t.completada
    and (not public.auth_tiene_permiso('leads') or t.asignado_a = auth.uid())
    and t.vence_at is not null and t.vence_at < now()
  limit 50;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'lead_id', t.lead_id, 'lead_nombre', l.nombre,
      'lead_telefono', l.telefono, 'tipo', t.tipo, 'detalle', t.detalle,
      'vence_at', t.vence_at, 'asignado_a', t.asignado_a, 'asignado_nombre', u.nombre
    ) order by t.vence_at asc
  ), '[]'::jsonb)
  into v_hoy_j
  from public.lead_tarea t
  join public.lead l on l.id = t.lead_id
  left join public.usuario u on u.id = t.asignado_a
  where t.empresa_id = v_empresa and not t.completada
    and (not public.auth_tiene_permiso('leads') or t.asignado_a = auth.uid())
    and t.vence_at is not null and (t.vence_at at time zone v_tz)::date = v_hoy
  limit 50;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'lead_id', t.lead_id, 'lead_nombre', l.nombre,
      'lead_telefono', l.telefono, 'tipo', t.tipo, 'detalle', t.detalle,
      'vence_at', t.vence_at, 'asignado_a', t.asignado_a, 'asignado_nombre', u.nombre
    ) order by t.vence_at asc
  ), '[]'::jsonb)
  into v_proximas
  from public.lead_tarea t
  join public.lead l on l.id = t.lead_id
  left join public.usuario u on u.id = t.asignado_a
  where t.empresa_id = v_empresa and not t.completada
    and (not public.auth_tiene_permiso('leads') or t.asignado_a = auth.uid())
    and t.vence_at is not null
    and (t.vence_at at time zone v_tz)::date > v_hoy
    and (t.vence_at at time zone v_tz)::date <= v_hoy + 7
  limit 50;

  return jsonb_build_object('vencidas', v_vencidas, 'hoy', v_hoy_j, 'proximas', v_proximas);
end;
$function$;
