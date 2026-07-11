-- Ola 1 (reportes) — Task 1/4: RPCs read-only que alimentan Reportes, el aforo
-- del Dashboard y el historial de pagos de la ficha del socio.
--
-- Todas: security definer, search_path fijo a 'public', primera línea resuelve
-- v_empresa := auth_empresa_id() con excepción si es null, y filtran TODO por
-- esa empresa. p_sede_id null = todas las sedes de la empresa.
--
-- Zona horaria: "hoy/del día" siempre se calcula como
--   (now() at time zone coalesce(empresa.zona_horaria, 'America/Lima'))::date
-- nunca current_date a secas (bug UTC ya mordió 2 veces en este proyecto).

-- =====================================================================
-- 1) reporte_ventas_serie: serie diaria de ingresos + desglose por método.
-- =====================================================================
create or replace function public.reporte_ventas_serie(
  p_sede_id uuid default null,
  p_desde date default null,
  p_hasta date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_desde date;
  v_hasta date;
  v_result jsonb;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;

  v_hasta := coalesce(p_hasta, v_hoy);
  v_desde := coalesce(p_desde, v_hasta - 29);

  with dias as (
    select generate_series(v_desde, v_hasta, interval '1 day')::date as fecha
  ),
  mov as (
    select
      (mf.fecha at time zone v_tz)::date as fecha,
      mf.monto,
      coalesce(nullif(mf.metodo_pago, ''), 'otro') as metodo
    from public.movimiento_financiero mf
    where mf.empresa_id = v_empresa
      and mf.tipo = 'ingreso'
      and (p_sede_id is null or mf.sede_id = p_sede_id)
      and (mf.fecha at time zone v_tz)::date between v_desde and v_hasta
  )
  select jsonb_agg(
           jsonb_build_object('fecha', d.fecha, 'total', x.total, 'por_metodo', x.por_metodo)
           order by d.fecha
         )
  into v_result
  from dias d
  cross join lateral (
    select
      coalesce((select sum(mov.monto) from mov where mov.fecha = d.fecha), 0) as total,
      coalesce((
        select jsonb_object_agg(sub.metodo, sub.suma)
        from (
          select mov.metodo, sum(mov.monto) as suma
          from mov
          where mov.fecha = d.fecha
          group by mov.metodo
        ) sub
      ), '{}'::jsonb) as por_metodo
  ) x;

  return coalesce(v_result, '[]'::jsonb);
end;
$function$;

grant execute on function public.reporte_ventas_serie(uuid, date, date) to authenticated;

-- =====================================================================
-- 2) reporte_socios_kpis: nuevos, churn 6m, proyección del mes, congeladas.
-- =====================================================================
create or replace function public.reporte_socios_kpis(
  p_sede_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_mes_inicio date;
  v_mes_fin date;
  v_nuevos jsonb;
  v_churn jsonb;
  v_ingresado numeric;
  v_por_renovar numeric;
  v_congeladas jsonb;
  v_total_activos int;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;
  v_mes_inicio := date_trunc('month', v_hoy)::date;
  v_mes_fin := (date_trunc('month', v_hoy) + interval '1 month' - interval '1 day')::date;

  -- nuevos_30d: socios creados (fecha local) en los últimos 30 días.
  with dias as (
    select generate_series(v_hoy - 29, v_hoy, interval '1 day')::date as fecha
  ),
  altas as (
    select (s.created_at at time zone v_tz)::date as fecha, s.id
    from public.socio s
    where s.empresa_id = v_empresa
      and s.deleted_at is null
      and (p_sede_id is null or s.sede_id = p_sede_id)
      and (s.created_at at time zone v_tz)::date between v_hoy - 29 and v_hoy
  )
  select jsonb_agg(jsonb_build_object('fecha', d.fecha, 'n', coalesce(a.n, 0)) order by d.fecha)
  into v_nuevos
  from dias d
  left join (select fecha, count(*) as n from altas group by fecha) a on a.fecha = d.fecha;

  -- churn_6m: por cada uno de los 6 meses anteriores (incluye el actual hasta hoy):
  --   vencidas = membresías cuyo fecha_fin cae en ese mes
  --   no_renovadas = de esas, el socio no tiene una membresía activa/renovada posterior
  --                  (es decir: no existe otra membresía del mismo socio cuyo fecha_inicio
  --                   sea posterior al fecha_fin vencido, o cuyo estado sea 'activa' con
  --                   fecha_fin >= hoy)
  --   activas_inicio = membresías activas al primer día de ese mes (fecha_inicio <= inicio
  --                     de mes y fecha_fin >= inicio de mes)
  --   tasa = no_renovadas / nullif(activas_inicio, 0)
  with meses as (
    select date_trunc('month', v_hoy - (interval '1 month' * gs))::date as mes_inicio
    from generate_series(0, 5) as gs
  ),
  vencidas_mes as (
    select
      me.mes_inicio,
      m.id as membresia_id,
      m.socio_id,
      m.fecha_fin
    from meses me
    join public.membresia m
      on m.empresa_id = v_empresa
     and (p_sede_id is null or m.sede_id = p_sede_id)
     and m.fecha_fin >= me.mes_inicio
     and m.fecha_fin <= (me.mes_inicio + interval '1 month' - interval '1 day')::date
  ),
  no_renovadas as (
    select vm.*
    from vencidas_mes vm
    where not exists (
      select 1 from public.membresia m2
      where m2.socio_id = vm.socio_id
        and m2.empresa_id = v_empresa
        and m2.id <> vm.membresia_id
        and (
          m2.fecha_inicio > vm.fecha_fin
          or (m2.estado = 'activa' and m2.fecha_fin >= v_hoy)
        )
    )
  ),
  activas_inicio_mes as (
    select
      me.mes_inicio,
      count(*) as n
    from meses me
    join public.membresia m
      on m.empresa_id = v_empresa
     and (p_sede_id is null or m.sede_id = p_sede_id)
     and m.fecha_inicio <= me.mes_inicio
     and m.fecha_fin >= me.mes_inicio
    group by me.mes_inicio
  ),
  agregado as (
    select
      me.mes_inicio,
      count(vm.membresia_id) as vencidas,
      count(nr.membresia_id) as no_renovadas,
      coalesce(ai.n, 0) as activas_inicio
    from meses me
    left join vencidas_mes vm on vm.mes_inicio = me.mes_inicio
    left join no_renovadas nr on nr.mes_inicio = me.mes_inicio and nr.membresia_id = vm.membresia_id
    left join activas_inicio_mes ai on ai.mes_inicio = me.mes_inicio
    group by me.mes_inicio, ai.n
  )
  select jsonb_agg(
    jsonb_build_object(
      'mes', to_char(mes_inicio, 'YYYY-MM'),
      'vencidas', vencidas,
      'no_renovadas', no_renovadas,
      'activas_inicio', activas_inicio,
      'tasa', case when activas_inicio > 0
                   then round(no_renovadas::numeric / activas_inicio, 4)
                   else 0 end
    ) order by mes_inicio
  )
  into v_churn
  from agregado;

  -- proyeccion_mes: ingresado (movimientos tipo ingreso ya registrados este mes)
  -- + por_renovar (precio de plan de membresías activas que vencen en lo que
  -- resta del mes, es decir entre hoy y fin de mes).
  select coalesce(sum(mf.monto), 0)
  into v_ingresado
  from public.movimiento_financiero mf
  where mf.empresa_id = v_empresa
    and mf.tipo = 'ingreso'
    and (p_sede_id is null or mf.sede_id = p_sede_id)
    and (mf.fecha at time zone v_tz)::date between v_mes_inicio and v_mes_fin;

  select coalesce(sum(p.precio), 0)
  into v_por_renovar
  from public.membresia m
  join public.plan p on p.id = m.plan_id
  where m.empresa_id = v_empresa
    and (p_sede_id is null or m.sede_id = p_sede_id)
    and m.estado = 'activa'
    and m.fecha_fin >= v_hoy
    and m.fecha_fin <= v_mes_fin;

  -- congeladas: membresías actualmente congeladas (estado='congelada' +
  -- congelamiento vigente sin cerrar, estado='aprobado' y fecha_fin aún null).
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'socio', s.nombre,
      'plan', pl.nombre,
      'desde', c.fecha_inicio,
      'hasta', c.fecha_fin
    ) order by c.fecha_inicio desc
  ), '[]'::jsonb)
  into v_congeladas
  from public.congelamiento c
  join public.membresia m on m.id = c.membresia_id
  join public.socio s on s.id = m.socio_id
  join public.plan pl on pl.id = m.plan_id
  where c.empresa_id = v_empresa
    and (p_sede_id is null or m.sede_id = p_sede_id)
    and m.estado = 'congelada'
    and c.estado = 'aprobado';

  select count(*)
  into v_total_activos
  from public.membresia m
  where m.empresa_id = v_empresa
    and (p_sede_id is null or m.sede_id = p_sede_id)
    and m.estado = 'activa'
    and m.fecha_fin >= v_hoy;

  return jsonb_build_object(
    'nuevos_30d', coalesce(v_nuevos, '[]'::jsonb),
    'churn_6m', coalesce(v_churn, '[]'::jsonb),
    'proyeccion_mes', jsonb_build_object(
      'ingresado', v_ingresado,
      'por_renovar', v_por_renovar,
      'total', v_ingresado + v_por_renovar
    ),
    'congeladas', v_congeladas,
    'total_activos', v_total_activos
  );
end;
$function$;

grant execute on function public.reporte_socios_kpis(uuid) to authenticated;

-- =====================================================================
-- 3) reporte_ausentes: socios activos sin check-in de entrada hace >= p_dias.
-- =====================================================================
create or replace function public.reporte_ausentes(
  p_sede_id uuid default null,
  p_dias int default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_result jsonb;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;

  with ultima as (
    select c.socio_id, max(c.ocurrido_en) as ultima_visita
    from public.checkin c
    where c.empresa_id = v_empresa
      and c.direccion = 'entrada'
      and c.resultado = 'permitido'
      and c.socio_id is not null
      and (p_sede_id is null or c.sede_id = p_sede_id)
    group by c.socio_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'socio_id', s.id,
      'nombre', s.nombre,
      'codigo', s.codigo,
      'telefono', s.telefono,
      'ultima_visita', u.ultima_visita,
      'dias_ausente', case
        when u.ultima_visita is null then null
        else (v_hoy - (u.ultima_visita at time zone v_tz)::date)
      end
    ) order by
      -- desc por días ausente: nulls (nunca visitaron) primero (son los "más ausentes")
      (case when u.ultima_visita is null then 1 else 0 end) desc,
      (v_hoy - (u.ultima_visita at time zone v_tz)::date) desc nulls first
  ), '[]'::jsonb)
  into v_result
  from public.socio s
  left join ultima u on u.socio_id = s.id
  where s.empresa_id = v_empresa
    and s.estado = 'activo'
    and s.deleted_at is null
    and (p_sede_id is null or s.sede_id = p_sede_id)
    and (
      u.ultima_visita is null
      or (v_hoy - (u.ultima_visita at time zone v_tz)::date) >= p_dias
    );

  return v_result;
end;
$function$;

grant execute on function public.reporte_ausentes(uuid, int) to authenticated;

-- =====================================================================
-- 4) aforo_actual: dentro = entradas de HOY (hora local) de hace < 2h sin
--    una salida posterior del mismo socio/usuario. p_sede_id es obligatorio
--    (una sede física concreta).
-- =====================================================================
create or replace function public.aforo_actual(
  p_sede_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_aforo_max int;
  v_dentro int;
  v_pct numeric;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  if p_sede_id is null then
    raise exception 'p_sede_id es obligatorio';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;

  select s.aforo_max into v_aforo_max
  from public.sede s
  where s.id = p_sede_id and s.empresa_id = v_empresa;

  if v_aforo_max is null then
    raise exception 'Sede no encontrada o sin acceso';
  end if;

  with entradas_hoy as (
    select
      c.id,
      coalesce(c.socio_id, c.usuario_id) as persona,
      c.ocurrido_en
    from public.checkin c
    where c.empresa_id = v_empresa
      and c.sede_id = p_sede_id
      and c.direccion = 'entrada'
      and c.resultado = 'permitido'
      and (c.ocurrido_en at time zone v_tz)::date = v_hoy
      and c.ocurrido_en >= now() - interval '2 hours'
      and coalesce(c.socio_id, c.usuario_id) is not null
  ),
  salidas_hoy as (
    select
      coalesce(c.socio_id, c.usuario_id) as persona,
      c.ocurrido_en
    from public.checkin c
    where c.empresa_id = v_empresa
      and c.sede_id = p_sede_id
      and c.direccion = 'salida'
      and c.resultado = 'permitido'
      and (c.ocurrido_en at time zone v_tz)::date = v_hoy
      and coalesce(c.socio_id, c.usuario_id) is not null
  )
  select count(*)
  into v_dentro
  from entradas_hoy e
  where not exists (
    select 1 from salidas_hoy sa
    where sa.persona = e.persona
      and sa.ocurrido_en > e.ocurrido_en
  );

  v_pct := case when v_aforo_max > 0
                then round((v_dentro::numeric / v_aforo_max) * 100, 1)
                else 0 end;

  return jsonb_build_object(
    'dentro', v_dentro,
    'aforo_max', v_aforo_max,
    'pct', v_pct
  );
end;
$function$;

grant execute on function public.aforo_actual(uuid) to authenticated;

-- =====================================================================
-- 5) historial_pagos_socio: pagos del socio (ingresos de caja ligados a sus
--    membresías/cobros del socio + sus pago_app aprobados). Valida que el
--    socio pertenezca a la empresa del caller.
--
-- Decisión de enlace (verificado en el esquema real):
--   - movimiento_financiero.ref_tipo = 'membresia' -> ref_id = membresia.id
--     -> membresia.socio_id = p_socio_id (verificado con join real: sí enlaza).
--   - movimiento_financiero.ref_tipo = 'socio' -> ref_id = socio.id directamente
--     (cobros de caja ligados al socio sin pasar por una membresía, p.ej.
--     matrícula o cobro suelto).
--   - pago_app.socio_id = p_socio_id y estado_pago = 'aprobado' (pagos por
--     pasarela, app o mostrador).
-- =====================================================================
create or replace function public.historial_pagos_socio(
  p_socio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_socio_empresa uuid;
  v_result jsonb;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select s.empresa_id into v_socio_empresa
  from public.socio s
  where s.id = p_socio_id;

  if v_socio_empresa is null or v_socio_empresa <> v_empresa then
    raise exception 'Socio no encontrado o sin acceso';
  end if;

  with caja_membresia as (
    select
      mf.fecha,
      coalesce(nullif(mf.descripcion, ''), initcap(mf.categoria)) as concepto,
      mf.monto,
      mf.metodo_pago as metodo,
      'caja'::text as origen
    from public.movimiento_financiero mf
    join public.membresia m on m.id = mf.ref_id
    where mf.empresa_id = v_empresa
      and mf.tipo = 'ingreso'
      and mf.ref_tipo = 'membresia'
      and m.socio_id = p_socio_id
  ),
  caja_socio as (
    select
      mf.fecha,
      coalesce(nullif(mf.descripcion, ''), initcap(mf.categoria)) as concepto,
      mf.monto,
      mf.metodo_pago as metodo,
      'caja'::text as origen
    from public.movimiento_financiero mf
    where mf.empresa_id = v_empresa
      and mf.tipo = 'ingreso'
      and mf.ref_tipo = 'socio'
      and mf.ref_id = p_socio_id
  ),
  app as (
    select
      coalesce(pa.pagado_at, pa.creado_at) as fecha,
      pa.concepto,
      pa.monto,
      'app'::text as metodo,
      case when pa.canal = 'mostrador' then 'mostrador' else 'app' end as origen
    from public.pago_app pa
    where pa.empresa_id = v_empresa
      and pa.socio_id = p_socio_id
      and pa.estado_pago = 'aprobado'
  ),
  todos as (
    select * from caja_membresia
    union all
    select * from caja_socio
    union all
    select * from app
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'fecha', fecha,
      'concepto', concepto,
      'monto', monto,
      'metodo', metodo,
      'origen', origen
    ) order by fecha desc
  ), '[]'::jsonb)
  into v_result
  from todos;

  return v_result;
end;
$function$;

grant execute on function public.historial_pagos_socio(uuid) to authenticated;
