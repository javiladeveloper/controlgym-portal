-- Ola 2 (CRM comercial Pro) — Task 1/4: metas de vendedor, RPCs comerciales
-- (reporte_comercial, agenda_comercial, ex_socios) y 2 crons (SLA de leads sin
-- seguimiento + cumpleaños de socios).
--
-- Estilo: security definer, search_path fijo a 'public', primera línea resuelve
-- v_empresa := auth_empresa_id() con excepción si es null, TODO filtrado por esa
-- empresa. Zona horaria: "hoy" = (now() at time zone coalesce(empresa.zona_horaria,
-- 'America/Lima'))::date — nunca current_date a secas.
--
-- Valores reales verificados en la BD antes de escribir esto:
--   · lead.etapa ∈ {'nuevo','contactado','clase_prueba','inscrito'} (CHECK constraint).
--   · rol.codigo ∈ {'admin','recepcion','entrenador','nutricionista','mantenimiento'},
--     roles son globales (empresa_id null) — el admin de una empresa se resuelve vía
--     usuario_empresa ue join rol r on r.id=ue.rol_id where r.codigo='admin' and ue.activo.
--   · anular_movimiento_financiero (20260703000049_anulaciones.sql) inserta un
--     contra-asiento con tipo invertido (ingreso→gasto), ref_tipo='anulacion',
--     ref_id = id del movimiento original, registrado_por = quien anuló (no
--     necesariamente el vendedor original). Decisión de atribución de ventas:
--     se excluyen del total del vendedor los movimientos de ingreso cuyo id
--     aparece como ref_id de un contra-asiento de anulación (la venta anulada no
--     cuenta como venta de nadie), y no se cuenta el contra-asiento en sí (es
--     tipo='gasto', ya queda fuera del filtro tipo='ingreso'). Documentado también
--     en task-1-report.md.
--   · cron pattern copiado de `fitcontrol-vencimientos-socios` (cron.schedule con
--     nombre + invocación simple `select public.fn()`), y de recordar_vencimientos_socios
--     / push_diario (loop por empresa+zona, encolar_push, exception when others then null
--     para que un fallo individual no frene el resto).

-- =====================================================================
-- 1) Tabla meta_vendedor
-- =====================================================================
create table if not exists public.meta_vendedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  monto_diario numeric(12,2) not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, usuario_id)
);

create trigger trg_meta_vendedor_updated
  before update on public.meta_vendedor
  for each row execute function public.set_updated_at();

alter table public.meta_vendedor enable row level security;

-- Select: cualquier autenticado de la empresa (para pintar "meta del día" del
-- equipo comercial). Escritura: solo vía guardar_meta_vendedor (security definer),
-- por eso no hay policy de insert/update/delete.
create policy meta_vendedor_select on public.meta_vendedor
  for select
  to authenticated
  using (empresa_id = public.auth_empresa_id());

-- =====================================================================
-- 2) guardar_meta_vendedor: upsert de la meta diaria de un vendedor (admin).
-- =====================================================================
create or replace function public.guardar_meta_vendedor(
  p_usuario_id uuid,
  p_monto_diario numeric
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;
  if not public.auth_is_admin() then
    raise exception 'Solo un administrador puede fijar metas comerciales';
  end if;
  if p_monto_diario is null or p_monto_diario < 0 then
    raise exception 'Monto diario inválido';
  end if;
  if not exists (
    select 1 from public.usuario_empresa
    where usuario_id = p_usuario_id and empresa_id = v_empresa and activo
  ) then
    raise exception 'El usuario no pertenece a esta empresa';
  end if;

  insert into public.meta_vendedor (empresa_id, usuario_id, monto_diario, activo)
  values (v_empresa, p_usuario_id, p_monto_diario, true)
  on conflict (empresa_id, usuario_id)
  do update set monto_diario = excluded.monto_diario, activo = true, updated_at = now();
end;
$function$;

grant execute on function public.guardar_meta_vendedor(uuid, numeric) to authenticated;

-- =====================================================================
-- 3) reporte_comercial: ventas + conversión por vendedor.
-- =====================================================================
create or replace function public.reporte_comercial(
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
  equipo_hoy as (
    select usuario_id from public.meta_vendedor where empresa_id = v_empresa and activo
    union
    select usuario_id from hoy_ventas
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'usuario_id', eq.usuario_id,
      'nombre', u.nombre,
      'hoy', coalesce(hv.hoy, 0),
      'meta_diaria', coalesce(mv.monto_diario, 0)
    )
    order by u.nombre
  ), '[]'::jsonb)
  into v_por_dia_hoy
  from equipo_hoy eq
  join public.usuario u on u.id = eq.usuario_id
  left join hoy_ventas hv on hv.usuario_id = eq.usuario_id
  left join public.meta_vendedor mv on mv.usuario_id = eq.usuario_id and mv.empresa_id = v_empresa;

  return jsonb_build_object('vendedores', v_vendedores, 'por_dia_hoy', v_por_dia_hoy);
end;
$function$;

grant execute on function public.reporte_comercial(date, date) to authenticated;

-- =====================================================================
-- 4) agenda_comercial: tareas de leads pendientes (vencidas / hoy / próximas).
-- =====================================================================
create or replace function public.agenda_comercial()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_vencidas jsonb;
  v_hoy_j jsonb;
  v_proximas jsonb;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'lead_id', t.lead_id, 'lead_nombre', l.nombre,
      'lead_telefono', l.telefono, 'tipo', t.tipo, 'detalle', t.detalle,
      'vence_at', t.vence_at, 'asignado_a', t.asignado_a, 'asignado_nombre', u.nombre
    ) order by t.vence_at asc
  ), '[]'::jsonb)
  into v_vencidas
  from public.lead_tarea t
  join public.lead l on l.id = t.lead_id
  left join public.usuario u on u.id = t.asignado_a
  where t.empresa_id = v_empresa and not t.completada
    and t.vence_at is not null and t.vence_at < now()
  limit 50;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'lead_id', t.lead_id, 'lead_nombre', l.nombre,
      'lead_telefono', l.telefono, 'tipo', t.tipo, 'detalle', t.detalle,
      'vence_at', t.vence_at, 'asignado_a', t.asignado_a, 'asignado_nombre', u.nombre
    ) order by t.vence_at asc
  ), '[]'::jsonb)
  into v_hoy_j
  from public.lead_tarea t
  join public.lead l on l.id = t.lead_id
  left join public.usuario u on u.id = t.asignado_a
  where t.empresa_id = v_empresa and not t.completada
    and t.vence_at is not null and (t.vence_at at time zone v_tz)::date = v_hoy
  limit 50;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'lead_id', t.lead_id, 'lead_nombre', l.nombre,
      'lead_telefono', l.telefono, 'tipo', t.tipo, 'detalle', t.detalle,
      'vence_at', t.vence_at, 'asignado_a', t.asignado_a, 'asignado_nombre', u.nombre
    ) order by t.vence_at asc
  ), '[]'::jsonb)
  into v_proximas
  from public.lead_tarea t
  join public.lead l on l.id = t.lead_id
  left join public.usuario u on u.id = t.asignado_a
  where t.empresa_id = v_empresa and not t.completada
    and t.vence_at is not null
    and (t.vence_at at time zone v_tz)::date > v_hoy
    and (t.vence_at at time zone v_tz)::date <= v_hoy + 7
  limit 50;

  return jsonb_build_object('vencidas', v_vencidas, 'hoy', v_hoy_j, 'proximas', v_proximas);
end;
$function$;

grant execute on function public.agenda_comercial() to authenticated;

-- =====================================================================
-- 5) ex_socios: socios cuya última membresía venció hace ≤ p_meses y no
--    tienen ninguna activa hoy.
-- =====================================================================
create or replace function public.ex_socios(p_meses int default 6)
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
    select distinct on (m.socio_id)
      m.socio_id, m.fecha_fin, p.nombre as plan
    from public.membresia m
    join public.plan p on p.id = m.plan_id
    where m.empresa_id = v_empresa and m.deleted_at is null
    order by m.socio_id, m.fecha_fin desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'socio_id', s.id, 'nombre', s.nombre, 'telefono', s.telefono,
      'ultimo_plan', u.plan, 'vencio_hace_dias', v_hoy - u.fecha_fin
    ) order by u.fecha_fin desc
  ), '[]'::jsonb)
  into v_result
  from ultima u
  join public.socio s on s.id = u.socio_id and s.empresa_id = v_empresa and s.deleted_at is null
  where u.fecha_fin < v_hoy
    and u.fecha_fin >= v_hoy - (p_meses || ' months')::interval
    and not exists (
      select 1 from public.membresia m2
      where m2.socio_id = u.socio_id and m2.empresa_id = v_empresa
        and m2.deleted_at is null and m2.estado = 'activa'
    );

  return v_result;
end;
$function$;

grant execute on function public.ex_socios(int) to authenticated;

-- =====================================================================
-- 6) Cron: SLA de leads sin seguimiento (cada hora).
-- =====================================================================
-- Idempotencia: un aviso por lead por día (fecha local de SU empresa).
create table if not exists public.sla_lead_avisado (
  lead_id uuid not null references public.lead(id) on delete cascade,
  fecha date not null,
  primary key (lead_id, fecha)
);

create or replace function public.sla_leads_sin_seguimiento()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r_empresa record;
  v_tz text;
  v_hoy date;
  r_lead record;
  v_admin uuid;
begin
  for r_empresa in
    select id, zona_horaria from public.empresa where estado = 'activa' and deleted_at is null
  loop
    v_tz := coalesce(r_empresa.zona_horaria, 'America/Lima');
    v_hoy := (now() at time zone v_tz)::date;

    for r_lead in
      select l.id, l.nombre, l.asignado_a
      from public.lead l
      where l.empresa_id = r_empresa.id
        and l.deleted_at is null
        and l.etapa in ('nuevo', 'contactado')
        and l.created_at < now() - interval '24 hours'
        and not exists (
          select 1 from public.lead_tarea t
          where t.lead_id = l.id and t.created_at > now() - interval '24 hours'
        )
        and not exists (
          select 1 from public.sla_lead_avisado a
          where a.lead_id = l.id and a.fecha = v_hoy
        )
    loop
      begin
        if r_lead.asignado_a is not null then
          perform public.encolar_push(
            r_lead.asignado_a,
            '⏰ Lead sin seguimiento',
            'Lead ' || r_lead.nombre || ' lleva más de 24h sin seguimiento.',
            jsonb_build_object('tipo', 'sla_lead', 'lead_id', r_lead.id)
          );
        else
          for v_admin in
            select ue.usuario_id
            from public.usuario_empresa ue
            join public.rol r on r.id = ue.rol_id
            where ue.empresa_id = r_empresa.id and ue.activo and r.codigo = 'admin'
          loop
            perform public.encolar_push(
              v_admin,
              '⏰ Lead sin seguimiento',
              'Lead ' || r_lead.nombre || ' lleva más de 24h sin seguimiento.',
              jsonb_build_object('tipo', 'sla_lead', 'lead_id', r_lead.id)
            );
          end loop;
        end if;

        insert into public.sla_lead_avisado (lead_id, fecha)
        values (r_lead.id, v_hoy)
        on conflict do nothing;
      exception when others then
        null; -- un fallo individual no frena a los demás leads/empresas
      end;
    end loop;
  end loop;

  perform public.llamar_push_worker();
end;
$function$;

-- =====================================================================
-- 7) Cron: push de cumpleaños de socios (13:00 UTC).
-- =====================================================================
-- Idempotencia: un aviso por socio por año (evita reenvío si el cron corre
-- de nuevo el mismo día, y no depende de la hora exacta de "hoy" por empresa).
create table if not exists public.cumple_avisado (
  socio_id uuid not null references public.socio(id) on delete cascade,
  anio int not null,
  primary key (socio_id, anio)
);

create or replace function public.push_cumpleanos()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r_empresa record;
  v_tz text;
  v_hoy date;
  v_anio int;
  r_socio record;
  v_admin uuid;
  v_nombres text[];
  v_count int;
begin
  for r_empresa in
    select id, nombre, zona_horaria from public.empresa where estado = 'activa' and deleted_at is null
  loop
    v_tz := coalesce(r_empresa.zona_horaria, 'America/Lima');
    v_hoy := (now() at time zone v_tz)::date;
    v_anio := extract(year from v_hoy)::int;
    v_nombres := array[]::text[];
    v_count := 0;

    for r_socio in
      select s.id, s.nombre, s.usuario_id
      from public.socio s
      where s.empresa_id = r_empresa.id
        and s.deleted_at is null
        and s.estado = 'activo'
        and s.fecha_nacimiento is not null
        and extract(month from s.fecha_nacimiento) = extract(month from v_hoy)
        and extract(day from s.fecha_nacimiento) = extract(day from v_hoy)
        and not exists (
          select 1 from public.cumple_avisado a
          where a.socio_id = s.id and a.anio = v_anio
        )
    loop
      begin
        if r_socio.usuario_id is not null then
          perform public.encolar_push(
            r_socio.usuario_id,
            '🎂 ¡Feliz cumpleaños, ' || r_socio.nombre || '!',
            'Todo el equipo de ' || r_empresa.nombre || ' te desea un año increíble. ¡Ven a celebrarlo entrenando! 🎉',
            jsonb_build_object('tipo', 'cumple', 'socio_id', r_socio.id)
          );
        end if;

        insert into public.cumple_avisado (socio_id, anio) values (r_socio.id, v_anio)
        on conflict do nothing;

        v_nombres := v_nombres || r_socio.nombre;
        v_count := v_count + 1;
      exception when others then
        null;
      end;
    end loop;

    if v_count > 0 then
      for v_admin in
        select ue.usuario_id
        from public.usuario_empresa ue
        join public.rol r on r.id = ue.rol_id
        where ue.empresa_id = r_empresa.id and ue.activo and r.codigo in ('admin', 'recepcion')
      loop
        begin
          perform public.encolar_push(
            v_admin,
            '🎂 Cumpleaños de hoy',
            'Hoy cumplen: ' || array_to_string(v_nombres, ', '),
            jsonb_build_object('tipo', 'cumple_resumen', 'socios', v_count)
          );
        exception when others then
          null;
        end;
      end loop;
    end if;
  end loop;

  perform public.llamar_push_worker();
end;
$function$;

-- =====================================================================
-- 8) Registrar los crons (mismo estilo que fitcontrol-vencimientos-socios).
-- =====================================================================
select cron.schedule('fitcontrol-sla-leads', '0 * * * *', $$select public.sla_leads_sin_seguimiento()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-sla-leads');

select cron.schedule('fitcontrol-cumpleanos', '0 13 * * *', $$select public.push_cumpleanos()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-cumpleanos');
