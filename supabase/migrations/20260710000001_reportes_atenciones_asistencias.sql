-- Reportes para toma de decisiones:
--  1) reporte_asistencias  → check-ins (entradas permitidas) por fecha y hora
--     local del gym, en un rango. El frontend deriva de aquí: total, por hora,
--     por día de la semana, mapa de calor día×hora, serie por día y el filtro
--     por rango de horas (todo cliente-side sobre esta salida granular).
--  2) reporte_atenciones   → trabajo de los entrenadores/nutricionistas por
--     fecha y tipo (ayuda, carga, rutina, dieta) en un rango. El frontend deriva
--     el ranking por persona y la tendencia diaria.
-- Ambas: SECURITY DEFINER, scope a la empresa activa (auth_empresa_id) y grant a
-- authenticated, siguiendo el patrón de get_bootstrap/renew_membership.

-- 1) ASISTENCIAS ------------------------------------------------------------
create or replace function public.reporte_asistencias(
  p_sede_id uuid,
  p_desde date default (now() - interval '29 days')::date,
  p_hasta date default now()::date
) returns table (fecha date, hora int, total bigint)
language sql stable security definer
set search_path = public
as $$
  select (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima'))::date as fecha,
         extract(hour from (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima')))::int as hora,
         count(*)::bigint as total
  from public.checkin c
  join public.sede s on s.id = c.sede_id
  join public.empresa e on e.id = s.empresa_id
  where c.empresa_id = public.auth_empresa_id()
    and c.sede_id = p_sede_id
    and c.sede_id in (select public.auth_sede_ids())   -- el usuario puede ver esa sede
    and c.direccion = 'entrada'
    and c.resultado = 'permitido'
    and (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima'))::date between p_desde and p_hasta
  group by 1, 2
  order by 1, 2;
$$;

grant execute on function public.reporte_asistencias(uuid, date, date) to authenticated;

-- 2) ATENCIONES DE ENTRENADORES --------------------------------------------
create or replace function public.reporte_atenciones(
  p_desde date default (now() - interval '29 days')::date,
  p_hasta date default now()::date
) returns table (fecha date, usuario_id uuid, nombre text, rol text, tipo text, total bigint)
language sql stable security definer
set search_path = public
as $$
  with emp as (
    select public.auth_empresa_id() as id
  ),
  tz as (
    select coalesce(e.zona_horaria, 'America/Lima') as zona
    from public.empresa e where e.id = (select id from emp)
  ),
  eventos as (
    -- Ayudas que el trainer tomó
    select (sa.tomada_at at time zone (select zona from tz))::date as fecha,
           sa.atendida_por as uid, 'ayuda'::text as tipo
    from public.solicitud_ayuda sa
    where sa.empresa_id = (select id from emp) and sa.atendida_por is not null
      and (sa.tomada_at at time zone (select zona from tz))::date between p_desde and p_hasta
    union all
    -- Pedidos de subir carga que respondió
    select (sc.respondido_at at time zone (select zona from tz))::date,
           sc.respondido_por, 'carga'
    from public.solicitud_carga sc
    where sc.empresa_id = (select id from emp) and sc.respondido_por is not null
      and (sc.respondido_at at time zone (select zona from tz))::date between p_desde and p_hasta
    union all
    -- Rutinas que envió a la app
    select (r.enviado_at at time zone (select zona from tz))::date,
           r.entrenador_id, 'rutina'
    from public.rutina r
    where r.empresa_id = (select id from emp) and r.entrenador_id is not null and r.enviado_at is not null
      and (r.enviado_at at time zone (select zona from tz))::date between p_desde and p_hasta
    union all
    -- Dietas que envió a la app
    select (d.enviado_at at time zone (select zona from tz))::date,
           d.nutricionista_id, 'dieta'
    from public.dieta d
    where d.empresa_id = (select id from emp) and d.nutricionista_id is not null and d.enviado_at is not null
      and (d.enviado_at at time zone (select zona from tz))::date between p_desde and p_hasta
  ),
  agg as (
    select ev.fecha, ev.uid, ev.tipo, count(*)::bigint as total
    from eventos ev
    group by ev.fecha, ev.uid, ev.tipo
  )
  select a.fecha, a.uid as usuario_id, u.nombre,
         coalesce(ro.codigo, '') as rol, a.tipo, a.total
  from agg a
  join public.usuario u on u.id = a.uid
  left join public.usuario_empresa ue on ue.usuario_id = a.uid and ue.empresa_id = (select id from emp)
  left join public.rol ro on ro.id = ue.rol_id
  order by a.fecha, u.nombre;
$$;

grant execute on function public.reporte_atenciones(date, date) to authenticated;
