-- FIX (auditoría pre-demo): "En la sede ahora" (v_dashboard_sede.en_sede_hoy)
-- contaba TODAS las entradas del día sin restar las salidas → el aforo podía
-- marcar más del 100% con el gym vacío. Ahora es entradas − salidas del día
-- (nunca negativo). Se usa la hora local del gym para el corte del día.
create or replace view public.v_dashboard_sede as
select
  s.empresa_id,
  s.id as sede_id,
  s.nombre as sede_nombre,
  s.aforo_max,
  greatest(0,
    ( select count(*) from checkin c
       where c.sede_id = s.id and c.direccion = 'entrada' and c.resultado = 'permitido'
         and (c.ocurrido_en at time zone coalesce((select zona_horaria from empresa where id = s.empresa_id), 'America/Lima'))::date = current_date )
    -
    ( select count(*) from checkin c
       where c.sede_id = s.id and c.direccion = 'salida' and c.resultado = 'permitido'
         and (c.ocurrido_en at time zone coalesce((select zona_horaria from empresa where id = s.empresa_id), 'America/Lima'))::date = current_date )
  ) as en_sede_hoy,
  ( select count(*) from socio so
     where so.sede_id = s.id and so.estado = 'activo' and so.deleted_at is null ) as socios_activos,
  ( select count(*) from membresia m
     where m.sede_id = s.id and m.estado = 'activa'
       and m.fecha_fin >= current_date and m.fecha_fin <= (current_date + 7) ) as por_vencer_7d,
  ( select coalesce(sum(mf.monto), 0) from movimiento_financiero mf
     where mf.sede_id = s.id and mf.tipo = 'ingreso'
       and date_trunc('month', mf.fecha) = date_trunc('month', current_date::timestamptz) ) as ingresos_mes
from sede s
where s.deleted_at is null;
