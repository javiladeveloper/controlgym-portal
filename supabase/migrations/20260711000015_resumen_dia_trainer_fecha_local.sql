-- Fix: "Hoy del trainer" en la app mostraba 0 presentes/entrenaron/adherencia
-- durante la noche. La RPC comparaba (ocurrido_en at time zone TZ)::date =
-- current_date, pero current_date es la fecha del servidor (UTC). Cuando en Perú
-- pasan de ~19:00, en UTC ya es "mañana" → ningún check-in/entreno de "hoy local"
-- coincidía → todo daba 0.
--
-- Solución: calcular v_hoy := (now() at time zone v_tz)::date (hoy en la zona del
-- gym) y usarlo en todos los conteos. Además, presentes cuenta
-- coalesce(socio_id, usuario_id) para no perder ingresos sin socio_id (staff/kiosco),
-- igual que aforo_mi_sede.
--
-- Reportado desde la app (modo trainer). Ya aplicado en prod vía MCP el 2026-07-11.
CREATE OR REPLACE FUNCTION public.resumen_dia_trainer(p_empresa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tz text;
  v_hoy date;
  v_presentes_hoy int := 0;
  v_socios_activos int := 0;
  v_adherencia int := 0;
  v_entrenaron_hoy int := 0;
  v_entrenos_14d int := 0;
  v_socios_con_rutina int := 0;
begin
  if p_empresa_id is null or public.auth_empresa_id() is distinct from p_empresa_id then
    return jsonb_build_object(
      'presentes_hoy', 0, 'socios_activos', 0, 'adherencia_promedio', 0, 'entrenaron_hoy', 0
    );
  end if;

  select coalesce(zona_horaria, 'America/Lima') into v_tz
  from public.empresa where id = p_empresa_id;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;   -- HOY en la zona del gym, no UTC

  select greatest(0,
    ( select count(distinct coalesce(c.socio_id, c.usuario_id)) from public.checkin c
       where c.empresa_id = p_empresa_id and c.direccion = 'entrada' and c.resultado = 'permitido'
         and coalesce(c.socio_id, c.usuario_id) is not null
         and (c.ocurrido_en at time zone v_tz)::date = v_hoy )
    -
    ( select count(distinct coalesce(c.socio_id, c.usuario_id)) from public.checkin c
       where c.empresa_id = p_empresa_id and c.direccion = 'salida' and c.resultado = 'permitido'
         and coalesce(c.socio_id, c.usuario_id) is not null
         and (c.ocurrido_en at time zone v_tz)::date = v_hoy )
  ) into v_presentes_hoy;

  select count(*) into v_socios_activos
  from public.socio s
  where s.empresa_id = p_empresa_id and s.estado = 'activo' and s.deleted_at is null;

  select count(*) into v_entrenaron_hoy
  from public.registro_entreno re
  where re.empresa_id = p_empresa_id and re.fecha = v_hoy and re.completado = true;

  select count(*) into v_socios_con_rutina
  from public.socio s
  where s.empresa_id = p_empresa_id and s.estado = 'activo' and s.deleted_at is null
    and exists (select 1 from public.rutina r where r.socio_id = s.id and r.activa);

  select count(*) into v_entrenos_14d
  from public.registro_entreno re
  join public.socio s on s.id = re.socio_id
  where re.empresa_id = p_empresa_id and re.completado = true
    and re.fecha >= v_hoy - interval '13 days'
    and re.fecha <= v_hoy
    and s.estado = 'activo' and s.deleted_at is null;

  if v_socios_con_rutina > 0 then
    v_adherencia := round(100.0 * v_entrenos_14d / (14 * v_socios_con_rutina));
    v_adherencia := greatest(0, least(100, v_adherencia));
  else
    v_adherencia := 0;
  end if;

  return jsonb_build_object(
    'presentes_hoy', v_presentes_hoy,
    'socios_activos', v_socios_activos,
    'adherencia_promedio', v_adherencia,
    'entrenaron_hoy', v_entrenaron_hoy
  );
end;
$function$;
