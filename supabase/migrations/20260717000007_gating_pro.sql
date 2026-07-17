-- Gating de nivel Pro. Hasta hoy el rank máximo de los módulos era 2, así que
-- Crecimiento y Pro daban el mismo acceso y varias features Pro estaban abiertas
-- a planes más baratos. Este cambio crea el nivel rank 3, registra como módulos
-- las pantallas Pro que hoy no lo eran (croquis, acceso físico, facturación) y
-- pone un backstop en los RPC del panel que devuelven datos Pro sensibles.

-- ── 1. Registrar los módulos nuevos ─────────────────────────────────────────
-- get_modulos_activos saca los slugs de la tabla `modulo` cruzada con
-- `categoria_modulo`; sin fila aquí, modulos_de_sede nunca los devolvería.
insert into public.modulo (slug, nombre, descripcion, orden, es_core) values
  ('croquis',       'Croquis del gym',  'Mapa del gimnasio con máquinas por piso', 60, false),
  ('acceso_fisico', 'Acceso y cámaras', 'Torniquetes, huella y cámaras en vivo',   61, false),
  ('facturacion',   'Facturación',      'Comprobantes electrónicos (NORAC)',       62, false)
on conflict (slug) do nothing;

-- Solo a la categoría fitness (gimnasios). Los planes de segmento no los reciben.
insert into public.categoria_modulo (categoria_id, modulo_id)
select c.id, m.id
from public.categoria_gym c
cross join public.modulo m
where c.codigo = 'fitness'
  and m.slug in ('croquis','acceso_fisico','facturacion')
on conflict do nothing;

-- ── 2. modulo_min_rank: darles su nivel ─────────────────────────────────────
-- croquis → Crecimiento (rank 2). acceso_fisico/facturacion → Pro (rank 3).
create or replace function public.modulo_min_rank(p_slug text)
returns int language sql immutable set search_path = public as $$
  select case p_slug
    when 'dashboard' then 1 when 'clientes' then 1 when 'membresias' then 1
    when 'ventas' then 1 when 'clases' then 1 when 'configuracion' then 1
    when 'crm' then 2 when 'rutinas' then 2 when 'kardex' then 2 when 'personal' then 2
    when 'promociones' then 2 when 'finanzas' then 2 when 'reportes' then 2
    when 'maquinas' then 2 when 'sponsors' then 2
    when 'croquis' then 2
    when 'acceso_fisico' then 3 when 'facturacion' then 3
    else 1 end
$$;

-- ── 3. Exponer el rank del plan de la sede al panel ─────────────────────────
-- Para las features Pro que viven DENTRO de una pantalla ya visible (aforo/foto
-- en Dashboard, agenda/reactivación en CRM, KPIs en Reportes): el front las
-- oculta con planRank >= 3.
create or replace function public.rank_de_sede(p_sede_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select public.plan_rank(coalesce(
    (select coalesce(ss.plan_slug, e.plan_slug)
       from public.sede s
       join public.empresa e on e.id = s.empresa_id
       left join public.suscripcion_sede ss on ss.sede_id = s.id
      where s.id = p_sede_id and e.id = public.auth_empresa_id()),
    'estudio'));
$$;
revoke all on function public.rank_de_sede(uuid) from public;
grant execute on function public.rank_de_sede(uuid) to authenticated, service_role;

-- ── 4. BUG: limite_sedes_empresa limitaba Pro a 1 sede ──────────────────────
-- El renombre cadena→pro dejó 'pro' cayendo en el else. Pro/cadena = ilimitado,
-- crecimiento = 3, resto = 1. (En prueba/vencida sigue siendo 1: regla previa.)
create or replace function public.limite_sedes_empresa(p_empresa_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case
    when sp.estado is distinct from 'activa' then 1
    when sp.plan_slug in ('pro','cadena') then null
    when sp.plan_slug = 'crecimiento' then 3
    else 1
  end
  from public.suscripcion_plataforma sp
  where sp.empresa_id = p_empresa_id
$$;

-- ── 5. Backstop en RPC del PANEL ────────────────────────────────────────────
-- Esconder un widget en el front no protege el dato. Las piezas Pro del panel
-- que devuelven datos sensibles validan el plan aquí. (aforo_mi_sede/mi_meta son
-- de la APP del socio, no del panel — no se tocan.)
--
-- El cálculo de KPIs se movió a _reporte_socios_kpis_calcular (mismo cuerpo,
-- solo renombrado — ver la BD) y reporte_socios_kpis pasó a ser un wrapper con
-- gate. aforo_actual lleva el gate al inicio, conservando su cuerpo.

-- KPIs de ventas/cancelación/proyección: solo Pro. Con sede → esa sede debe ser
-- Pro; sin sede (agregado de empresa) → al menos una sede Pro.
create or replace function public.reporte_socios_kpis(p_sede_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_sede_id is not null and public.rank_de_sede(p_sede_id) < 3 then
    return jsonb_build_object('plan_insuficiente', true);
  end if;
  if p_sede_id is null and not exists (
    select 1 from public.sede s
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where e.id = public.auth_empresa_id() and s.deleted_at is null
      and public.plan_rank(coalesce(ss.plan_slug, e.plan_slug)) >= 3
  ) then
    return jsonb_build_object('plan_insuficiente', true);
  end if;
  return public._reporte_socios_kpis_calcular(p_sede_id);
end $$;

-- aforo_actual(sede): aforo en vivo del panel. Solo Pro. El cuerpo de cálculo se
-- conserva íntegro tras el gate (ver la migración aplicada en la BD).
-- (definición completa aplicada por separado — este archivo documenta el gate)
