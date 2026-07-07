-- FIX (auditoría pre-demo): rpc_asistencia_por_hora agrupaba por hora en UTC.
-- En Perú (UTC-5) las visitas de tarde/noche caían en la barra equivocada del
-- gráfico "Asistencia de hoy por hora" (o en el día siguiente). Ahora la hora y
-- el corte del día se evalúan en la zona horaria del gimnasio.
create or replace function public.rpc_asistencia_por_hora(p_sede_id uuid, p_fecha date default current_date)
returns table(hora integer, total bigint)
language sql
stable
as $function$
  select extract(hour from (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima')))::int as hora,
         count(*) as total
  from public.checkin c
  join public.sede s on s.id = c.sede_id
  join public.empresa e on e.id = s.empresa_id
  where c.sede_id = p_sede_id
    and c.direccion = 'entrada'
    and c.resultado = 'permitido'
    and (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima'))::date = p_fecha
  group by 1
  order by 1;
$function$;
