-- Fix: al cancelar una reserva y volver a reservar la MISMA clase/fecha, el INSERT
-- chocaba con el índice único (clase_id, socio_id, fecha) que incluye las canceladas,
-- devolviendo "duplicate key" (que la app mostraba como genérico "No se pudo reservar").
-- Solución: si existe una reserva cancelada para esa clase/socio/fecha, se REACTIVA
-- (UPDATE estado='reservada') en vez de insertar. Todas las validaciones previas
-- (membresía vigente, acceso del plan, cupo) se conservan intactas.
--
-- Reportado desde la app (socio cancela una clase y no puede volver a reservarla).
-- Ya aplicado en producción vía MCP el 2026-07-11; este archivo lo versiona.
CREATE OR REPLACE FUNCTION public.reservar_clase(p_clase_id uuid, p_fecha date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_clase public.clase;
  v_socio public.socio;
  v_mem public.membresia;
  v_ocupados int;
  v_reserva uuid;
  v_cancelada uuid;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  select * into v_clase from public.clase where id = p_clase_id and activa and deleted_at is null;
  if v_clase.id is null then raise exception 'Clase no encontrada o inactiva'; end if;

  select * into v_socio from public.socio
   where usuario_id = v_uid and empresa_id = v_clase.empresa_id and deleted_at is null limit 1;
  if v_socio.id is null then raise exception 'No estás vinculado a este gimnasio'; end if;
  if v_socio.estado <> 'activo' then raise exception 'Tu registro de socio no está activo — consulta en recepción'; end if;

  if p_fecha < current_date then raise exception 'La fecha ya pasó'; end if;
  if p_fecha > current_date + 14 then raise exception 'Solo se puede reservar hasta con 2 semanas de anticipación'; end if;
  if extract(isodow from p_fecha) <> v_clase.dia_semana then
    raise exception 'Esa clase no se dicta ese día';
  end if;

  select * into v_mem from public.membresia
   where socio_id = v_socio.id and estado = 'activa' and deleted_at is null
     and fecha_fin >= p_fecha
   order by fecha_fin desc limit 1;
  if v_mem.id is null then raise exception 'Necesitas una membresía vigente para esa fecha'; end if;

  -- Acceso del plan: la clase es de área libre o está incluida en su plan
  if not exists (select 1 from public.tipo_clase tc where tc.id = v_clase.tipo_clase_id and tc.acceso_libre)
     and not exists (select 1 from public.plan_acceso_clase pac
                      where pac.plan_id = v_mem.plan_id and pac.tipo_clase_id = v_clase.tipo_clase_id and pac.incluido) then
    raise exception 'Tu plan no incluye esta clase';
  end if;

  -- ¿Ya tiene una reserva ACTIVA (no cancelada)? → error amigable.
  if exists (select 1 from public.reserva_clase
              where socio_id = v_socio.id and clase_id = p_clase_id and fecha = p_fecha and estado <> 'cancelada') then
    raise exception 'Ya tienes reserva para esta clase';
  end if;

  -- Cupo (contando solo las activas)
  select count(*) into v_ocupados from public.reserva_clase
   where clase_id = p_clase_id and fecha = p_fecha and estado <> 'cancelada';
  if v_clase.cupo_max is not null and v_ocupados >= v_clase.cupo_max then
    raise exception 'Clase llena (% de % cupos)', v_ocupados, v_clase.cupo_max;
  end if;

  -- Si existe una reserva CANCELADA para esta clase/socio/fecha, reactivarla en vez
  -- de insertar (el índice único la incluye y un INSERT chocaría con duplicate key).
  select id into v_cancelada from public.reserva_clase
   where socio_id = v_socio.id and clase_id = p_clase_id and fecha = p_fecha and estado = 'cancelada'
   limit 1;

  if v_cancelada is not null then
    update public.reserva_clase
       set estado = 'reservada'
     where id = v_cancelada
     returning id into v_reserva;
  else
    insert into public.reserva_clase (empresa_id, sede_id, clase_id, socio_id, fecha, estado)
    values (v_clase.empresa_id, v_clase.sede_id, p_clase_id, v_socio.id, p_fecha, 'reservada')
    returning id into v_reserva;
  end if;

  return jsonb_build_object('reserva_id', v_reserva, 'cupos_restantes',
    case when v_clase.cupo_max is null then null else v_clase.cupo_max - v_ocupados - 1 end);
end;
$function$;
