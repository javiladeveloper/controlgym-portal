-- Resumen de actividad del trainer para su perfil en la app: ayudas atendidas y
-- días asistidos (últimos 30d) + sus sedes asignadas. Un solo viaje.
-- Creado para el rediseño del perfil del trainer (app). Aplicado en prod vía MCP.
CREATE OR REPLACE FUNCTION public.resumen_trainer(p_empresa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_ayudas int := 0;
  v_dias int := 0;
  v_sedes text;
begin
  if v_uid is null then
    return jsonb_build_object('ayudas_30d', 0, 'dias_30d', 0, 'sedes', null);
  end if;

  select count(*) into v_ayudas
  from public.solicitud_ayuda
  where atendida_por = v_uid
    and (p_empresa_id is null or empresa_id = p_empresa_id)
    and creado_at >= now() - interval '30 days';

  select count(distinct fecha) into v_dias
  from public.asistencia_staff
  where usuario_id = v_uid
    and (p_empresa_id is null or empresa_id = p_empresa_id)
    and fecha >= current_date - interval '30 days';

  select string_agg(s.nombre, ', ' order by s.nombre) into v_sedes
  from public.usuario_sede us
  join public.sede s on s.id = us.sede_id
  where us.usuario_id = v_uid
    and (p_empresa_id is null or s.empresa_id = p_empresa_id);

  return jsonb_build_object(
    'ayudas_30d', v_ayudas,
    'dias_30d', v_dias,
    'sedes', v_sedes
  );
end;
$function$;
