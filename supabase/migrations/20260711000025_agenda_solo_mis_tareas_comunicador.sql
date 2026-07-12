-- Agenda comercial: el COMUNICADOR ve solo SUS tareas (pedido del owner:
-- "solo que vea los mios"); admin y recepcion siguen viendo la agenda del
-- equipo completo con responsable por fila (vista de supervision).

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
    and (public.auth_rol() <> 'comunicador' or t.asignado_a = auth.uid())
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
    and (public.auth_rol() <> 'comunicador' or t.asignado_a = auth.uid())
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
    and (public.auth_rol() <> 'comunicador' or t.asignado_a = auth.uid())
    and t.vence_at is not null
    and (t.vence_at at time zone v_tz)::date > v_hoy
    and (t.vence_at at time zone v_tz)::date <= v_hoy + 7
  limit 50;

  return jsonb_build_object('vencidas', v_vencidas, 'hoy', v_hoy_j, 'proximas', v_proximas);
end;
$function$;