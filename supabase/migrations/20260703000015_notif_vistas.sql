-- ============================================================================
-- 15 · Notificaciones y vistas/funciones de dashboard y reportes
-- ============================================================================

create table public.notificacion (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,         -- TENANT
  sede_id    uuid references public.sede(id),
  tipo       text,
  titulo     text not null,
  subtitulo  text,
  nivel      text not null default 'info' check (nivel in ('info','warning','danger','success')),
  leida      boolean not null default false,
  ref_tipo   text,
  ref_id     uuid,
  created_at timestamptz not null default now()
);
create index idx_notificacion_empresa_sede on public.notificacion(empresa_id, sede_id);
create index idx_notificacion_no_leidas on public.notificacion(empresa_id, leida) where not leida;

-- ── Vista: KPIs del dashboard por sede ──────────────────────────────────────
-- security_invoker => respeta RLS del usuario que consulta.
create or replace view public.v_dashboard_sede
with (security_invoker = true) as
select
  s.empresa_id,
  s.id as sede_id,
  s.nombre as sede_nombre,
  s.aforo_max,
  -- En la sede ahora (entradas de hoy sin salida posterior) — aproximación por entradas de hoy
  (select count(*) from public.checkin c
     where c.sede_id = s.id and c.direccion = 'entrada'
       and c.resultado = 'permitido'
       and c.ocurrido_en::date = current_date) as en_sede_hoy,
  -- Socios activos de la sede
  (select count(*) from public.socio so
     where so.sede_id = s.id and so.estado = 'activo' and so.deleted_at is null) as socios_activos,
  -- Membresías por vencer en 7 días
  (select count(*) from public.membresia m
     where m.sede_id = s.id and m.estado = 'activa'
       and m.fecha_fin between current_date and current_date + 7) as por_vencer_7d,
  -- Ingresos del mes en curso
  (select coalesce(sum(mf.monto),0) from public.movimiento_financiero mf
     where mf.sede_id = s.id and mf.tipo = 'ingreso'
       and date_trunc('month', mf.fecha) = date_trunc('month', current_date)) as ingresos_mes
from public.sede s
where s.deleted_at is null;

comment on view public.v_dashboard_sede is 'KPIs agregados por sede para el dashboard (respeta RLS).';

-- ── Vista: membresías por vencer (próximos 7 días) ──────────────────────────
create or replace view public.v_membresias_por_vencer
with (security_invoker = true) as
select
  m.empresa_id, m.sede_id, m.id as membresia_id,
  so.nombre as socio_nombre, so.codigo as socio_codigo,
  p.nombre as plan_nombre, m.fecha_fin,
  (m.fecha_fin - current_date) as dias_restantes
from public.membresia m
join public.socio so on so.id = m.socio_id
join public.plan  p  on p.id  = m.plan_id
where m.estado = 'activa'
  and m.fecha_fin between current_date and current_date + 7
order by m.fecha_fin;

-- ── Función: asistencia por hora de una sede en una fecha ───────────────────
create or replace function public.rpc_asistencia_por_hora(p_sede_id uuid, p_fecha date default current_date)
returns table (hora int, total bigint)
language sql stable security invoker
as $$
  select extract(hour from ocurrido_en)::int as hora, count(*) as total
  from public.checkin
  where sede_id = p_sede_id
    and direccion = 'entrada'
    and resultado = 'permitido'
    and ocurrido_en::date = p_fecha
  group by 1
  order by 1;
$$;
