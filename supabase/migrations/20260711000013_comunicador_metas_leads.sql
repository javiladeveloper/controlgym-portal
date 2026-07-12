-- Feedback del owner (QA en vivo):
-- 1) Rol nuevo 'comunicador' (atencion al cliente / marketing): gestiona leads.
-- 2) Las metas comerciales miden LEADS del dia ademas de soles.

insert into public.rol (codigo, nombre, es_sistema)
select 'comunicador', 'Comunicador (atención al cliente)', true
where not exists (select 1 from public.rol where codigo = 'comunicador' and empresa_id is null);

alter table public.meta_vendedor add column if not exists leads_diarios int;

-- guardar_meta_vendedor gana la meta de leads (drop de la firma vieja para no dejar overload ambiguo)
drop function if exists public.guardar_meta_vendedor(uuid, numeric);
create or replace function public.guardar_meta_vendedor(p_usuario_id uuid, p_monto_diario numeric, p_leads_diarios int default null)
returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador configura metas';
  end if;
  insert into public.meta_vendedor (empresa_id, usuario_id, monto_diario, leads_diarios, activo)
  values (v_empresa, p_usuario_id, coalesce(p_monto_diario, 0), p_leads_diarios, true)
  on conflict (empresa_id, usuario_id) do update set
    monto_diario = coalesce(excluded.monto_diario, meta_vendedor.monto_diario),
    leads_diarios = coalesce(excluded.leads_diarios, meta_vendedor.leads_diarios),
    activo = true;
end;
$fn$;
grant execute on function public.guardar_meta_vendedor(uuid, numeric, int) to authenticated;

CREATE OR REPLACE FUNCTION public.reporte_comercial(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_desde date;
  v_hasta date;
  v_vendedores jsonb;
  v_por_dia_hoy jsonb;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;

  -- Default: mes actual.
  v_hasta := coalesce(p_hasta, v_hoy);
  v_desde := coalesce(p_desde, date_trunc('month', v_hoy)::date);

  with ventas as (
    -- Ingresos netos por vendedor: se excluyen los movimientos de ingreso que
    -- fueron anulados (su id aparece como ref_id de un contra-asiento
    -- ref_tipo='anulacion'). El propio contra-asiento es tipo='gasto', ya
    -- queda fuera del filtro tipo='ingreso'.
    select
      mf.registrado_por as usuario_id,
      sum(mf.monto) as total,
      count(*) as n_ventas
    from public.movimiento_financiero mf
    where mf.empresa_id = v_empresa
      and mf.tipo = 'ingreso'
      and mf.registrado_por is not null
      and (mf.fecha at time zone v_tz)::date between v_desde and v_hasta
      and not exists (
        select 1 from public.movimiento_financiero anu
        where anu.ref_tipo = 'anulacion' and anu.ref_id = mf.id
      )
    group by mf.registrado_por
  ),
  leads_asig as (
    select asignado_a as usuario_id, count(*) as n
    from public.lead
    where empresa_id = v_empresa and asignado_a is not null and deleted_at is null
    group by asignado_a
  ),
  leads_conv as (
    select asignado_a as usuario_id, count(*) as n
    from public.lead
    where empresa_id = v_empresa and asignado_a is not null and deleted_at is null
      and etapa = 'inscrito'
    group by asignado_a
  ),
  equipo as (
    -- Universo de "vendedores": cualquiera con venta, meta, o lead asignado
    -- en la empresa (activo o no, para no perder histórico si se desactivó).
    select usuario_id from ventas
    union
    select usuario_id from public.meta_vendedor where empresa_id = v_empresa
    union
    select usuario_id from leads_asig
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'usuario_id', eq.usuario_id,
      'nombre', u.nombre,
      'ventas_total', coalesce(v.total, 0),
      'n_ventas', coalesce(v.n_ventas, 0),
      'meta_diaria', coalesce(mv.monto_diario, 0),
      'leads_asignados', coalesce(la.n, 0),
      'leads_convertidos', coalesce(lc.n, 0),
      'conversion', case when coalesce(la.n, 0) = 0 then 0
                          else round(coalesce(lc.n, 0)::numeric / la.n, 4) end
    )
    order by coalesce(v.total, 0) desc, u.nombre
  ), '[]'::jsonb)
  into v_vendedores
  from equipo eq
  join public.usuario u on u.id = eq.usuario_id
  left join ventas v on v.usuario_id = eq.usuario_id
  left join leads_asig la on la.usuario_id = eq.usuario_id
  left join leads_conv lc on lc.usuario_id = eq.usuario_id
  left join public.meta_vendedor mv on mv.usuario_id = eq.usuario_id and mv.empresa_id = v_empresa;

  with hoy_ventas as (
    select mf.registrado_por as usuario_id, sum(mf.monto) as hoy
    from public.movimiento_financiero mf
    where mf.empresa_id = v_empresa
      and mf.tipo = 'ingreso'
      and mf.registrado_por is not null
      and (mf.fecha at time zone v_tz)::date = v_hoy
      and not exists (
        select 1 from public.movimiento_financiero anu
        where anu.ref_tipo = 'anulacion' and anu.ref_id = mf.id
      )
    group by mf.registrado_por
  ),
  -- Metas de captacion (feedback del owner): la meta comercial real es
  -- CUANTOS LEADS gestiona la persona hoy, no solo soles cobrados.
  hoy_leads as (
    select l.asignado_a as usuario_id, count(*) as leads_hoy
    from public.lead l
    where l.empresa_id = v_empresa and l.asignado_a is not null
      and l.deleted_at is null
      and (l.created_at at time zone v_tz)::date = v_hoy
    group by l.asignado_a
  ),
  equipo_hoy as (
    select usuario_id from public.meta_vendedor where empresa_id = v_empresa and activo
    union
    select usuario_id from hoy_ventas
    union
    select usuario_id from hoy_leads
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'usuario_id', eq.usuario_id,
      'nombre', u.nombre,
      'hoy', coalesce(hv.hoy, 0),
      'meta_diaria', coalesce(mv.monto_diario, 0),
      'leads_hoy', coalesce(hl.leads_hoy, 0),
      'meta_leads', coalesce(mv.leads_diarios, 0)
    )
    order by u.nombre
  ), '[]'::jsonb)
  into v_por_dia_hoy
  from equipo_hoy eq
  join public.usuario u on u.id = eq.usuario_id
  left join hoy_ventas hv on hv.usuario_id = eq.usuario_id
  left join hoy_leads hl on hl.usuario_id = eq.usuario_id
  left join public.meta_vendedor mv on mv.usuario_id = eq.usuario_id and mv.empresa_id = v_empresa;

  return jsonb_build_object('vendedores', v_vendedores, 'por_dia_hoy', v_por_dia_hoy);
end;
$function$;
