-- ============================================================================
-- 87 (20260704000022) · Desempeño de trainers para PREMIAR eficiencia
--
-- Pedido del cliente: cuando un trainer responde una solicitud (de ayuda o de
-- subir carga), el panel debe mostrar QUIÉN la atendió, porque el admin de
-- cada gym puede premiar la eficiencia (bonos de productividad — backlog).
--
-- Los datos ya se guardan (solicitud_carga.respondido_por/at,
-- solicitud_ayuda.atendida_por/tomada_at/cerrada_at). Esta RPC los AGREGA por
-- trainer en un rango de fechas: cuántas atendió y qué tan rápido.
-- ============================================================================

create or replace function public.desempeno_trainers(
  p_desde date default (now() - interval '30 days')::date,
  p_hasta date default now()::date
) returns table (
  usuario_id uuid,
  nombre text,
  rol text,
  cargas_respondidas int,
  cargas_aprobadas int,
  ayudas_atendidas int,
  ayuda_min_promedio numeric,      -- minutos promedio en llegar (pedido→"voy yo")
  total_interacciones int
)
language sql stable security definer
set search_path = public
as $$
  with emp as (select public.auth_empresa_id() as id),
  staff as (
    select ue.usuario_id, u.nombre, ro.codigo as rol
    from public.usuario_empresa ue
    join public.usuario u on u.id = ue.usuario_id
    join public.rol ro on ro.id = ue.rol_id
    where ue.empresa_id = (select id from emp) and ue.activo
      and ro.codigo in ('entrenador','nutricionista','admin','recepcion')
  ),
  cargas as (
    select respondido_por as uid,
           count(*) as respondidas,
           count(*) filter (where estado='aprobada') as aprobadas
    from public.solicitud_carga
    where empresa_id = (select id from emp) and respondido_por is not null
      and respondido_at::date between p_desde and p_hasta
    group by respondido_por
  ),
  ayudas as (
    select atendida_por as uid,
           count(*) as atendidas,
           round(avg(extract(epoch from (tomada_at - creado_at))/60.0)::numeric, 1) as min_prom
    from public.solicitud_ayuda
    where empresa_id = (select id from emp) and atendida_por is not null
      and tomada_at::date between p_desde and p_hasta
    group by atendida_por
  )
  select
    s.usuario_id, s.nombre, s.rol,
    coalesce(c.respondidas,0)::int,
    coalesce(c.aprobadas,0)::int,
    coalesce(a.atendidas,0)::int,
    a.min_prom,
    (coalesce(c.respondidas,0) + coalesce(a.atendidas,0))::int as total
  from staff s
  left join cargas c on c.uid = s.usuario_id
  left join ayudas a on a.uid = s.usuario_id
  where coalesce(c.respondidas,0) + coalesce(a.atendidas,0) > 0
  order by total desc, a.min_prom asc nulls last;
$$;

comment on function public.desempeno_trainers is
  'Ranking de trainers por solicitudes atendidas (carga + ayuda) y rapidez, para que el admin premie la eficiencia.';
