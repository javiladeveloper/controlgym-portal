-- ============================================================================
-- Ola 3 quick-wins: (1) alerta preventiva de mantenimiento de máquinas,
-- (2) alerta de aforo alto al admin, (3) aforo visible para el SOCIO (app).
-- Sigue el patrón de push existente: encolar_push() + llamar_push_worker(),
-- jobs pg_cron 'fitcontrol-*' (ver 20260704000003_push_worker.sql).
-- ============================================================================

-- ── 1) MANTENIMIENTO PREVENTIVO ─────────────────────────────────────────────
-- Idempotencia: un aviso por mantenimiento y por día (hoy vs mañana son
-- fechas distintas, así que si un mantenimiento pasa de "mañana" a "hoy"
-- se avisa de nuevo, que es lo esperado).
create table if not exists public.mant_avisado (
  mantenimiento_id uuid not null references public.mantenimiento(id) on delete cascade,
  fecha             date not null,
  creado_at         timestamptz not null default now(),
  primary key (mantenimiento_id, fecha)
);

create or replace function public.avisar_mantenimientos_proximos()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  v_cuando text;
  v_titulo_maquina text;
  v_admin record;
begin
  for r in
    select m.id as mantenimiento_id, m.empresa_id, m.tipo, m.detalle, m.fecha_programada,
           mq.nombre as maquina_nombre,
           e.zona_horaria,
           (m.fecha_programada = (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::date) as es_hoy
    from public.mantenimiento m
    join public.empresa e on e.id = m.empresa_id and e.estado = 'activa' and e.deleted_at is null
    left join public.maquina mq on mq.id = m.maquina_id
    where m.fecha_realizada is null
      and m.estado not in ('completado', 'cancelado')
      and m.fecha_programada in (
        (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::date,
        (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::date + 1
      )
      and not exists (
        select 1 from public.mant_avisado ma
        where ma.mantenimiento_id = m.id and ma.fecha = m.fecha_programada
      )
  loop
    v_cuando := case when r.es_hoy then 'hoy' else 'mañana' end;
    v_titulo_maquina := coalesce(r.maquina_nombre, 'Máquina');

    for v_admin in
      select ue.usuario_id
      from public.usuario_empresa ue
      join public.rol rl on rl.id = ue.rol_id
      where ue.empresa_id = r.empresa_id and ue.activo and rl.codigo = 'admin'
    loop
      perform public.encolar_push(
        v_admin.usuario_id,
        '🔧 Mantenimiento ' || v_cuando,
        v_titulo_maquina || ' — ' || coalesce(r.detalle, r.tipo),
        jsonb_build_object('tipo', 'mantenimiento', 'mantenimiento_id', r.mantenimiento_id)
      );
    end loop;

    insert into public.mant_avisado (mantenimiento_id, fecha)
    values (r.mantenimiento_id, r.fecha_programada)
    on conflict do nothing;
  end loop;

  perform public.llamar_push_worker();
end;
$$;

select cron.schedule('fitcontrol-mantenimientos', '30 13 * * *', $$select public.avisar_mantenimientos_proximos()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-mantenimientos');

-- ── 2) ALERTA DE AFORO ALTO ─────────────────────────────────────────────────
-- Idempotencia por nivel: se avisa una vez al cruzar 80% y una vez al cruzar
-- 100% por sede y por día (hora local de la empresa).
create table if not exists public.aforo_avisado (
  sede_id   uuid not null references public.sede(id) on delete cascade,
  fecha     date not null,
  nivel     int not null check (nivel in (80, 100)),
  creado_at timestamptz not null default now(),
  primary key (sede_id, fecha, nivel)
);

create or replace function public.avisar_aforo_alto()
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  v_tz text;
  v_hoy date;
  v_dentro int;
  v_pct numeric;
  v_nivel int;
  v_admin record;
begin
  for r in
    select s.id as sede_id, s.nombre as sede_nombre, s.empresa_id, s.aforo_max, e.zona_horaria
    from public.sede s
    join public.empresa e on e.id = s.empresa_id and e.estado = 'activa' and e.deleted_at is null
    where s.aforo_max is not null and s.aforo_max > 0
  loop
    v_tz := coalesce(r.zona_horaria, 'America/Lima');
    v_hoy := (now() at time zone v_tz)::date;

    -- Misma regla que aforo_actual: entradas de HOY (hora local) de hace
    -- menos de 2h sin una salida posterior de la misma persona.
    with entradas_hoy as (
      select coalesce(c.socio_id, c.usuario_id) as persona, c.ocurrido_en
      from public.checkin c
      where c.empresa_id = r.empresa_id
        and c.sede_id = r.sede_id
        and c.direccion = 'entrada'
        and c.resultado = 'permitido'
        and (c.ocurrido_en at time zone v_tz)::date = v_hoy
        and c.ocurrido_en >= now() - interval '2 hours'
        and coalesce(c.socio_id, c.usuario_id) is not null
    ),
    salidas_hoy as (
      select coalesce(c.socio_id, c.usuario_id) as persona, c.ocurrido_en
      from public.checkin c
      where c.empresa_id = r.empresa_id
        and c.sede_id = r.sede_id
        and c.direccion = 'salida'
        and c.resultado = 'permitido'
        and (c.ocurrido_en at time zone v_tz)::date = v_hoy
        and coalesce(c.socio_id, c.usuario_id) is not null
    )
    select count(*)
    into v_dentro
    from entradas_hoy en
    where not exists (
      select 1 from salidas_hoy sa
      where sa.persona = en.persona and sa.ocurrido_en > en.ocurrido_en
    );

    v_pct := round((v_dentro::numeric / r.aforo_max) * 100, 1);

    v_nivel := case when v_pct >= 100 then 100 when v_pct >= 80 then 80 else null end;
    if v_nivel is null then
      continue;
    end if;

    if exists (select 1 from public.aforo_avisado where sede_id = r.sede_id and fecha = v_hoy and nivel = v_nivel) then
      continue;
    end if;

    for v_admin in
      select ue.usuario_id
      from public.usuario_empresa ue
      join public.rol rl on rl.id = ue.rol_id
      where ue.empresa_id = r.empresa_id and ue.activo and rl.codigo = 'admin'
    loop
      perform public.encolar_push(
        v_admin.usuario_id,
        '🏟️ ' || r.sede_nombre || ' al ' || v_pct::text || '% de aforo',
        v_dentro::text || '/' || r.aforo_max::text || ' personas dentro',
        jsonb_build_object('tipo', 'aforo', 'sede_id', r.sede_id, 'pct', v_pct)
      );
    end loop;

    insert into public.aforo_avisado (sede_id, fecha, nivel)
    values (r.sede_id, v_hoy, v_nivel)
    on conflict do nothing;
  end loop;

  perform public.llamar_push_worker();
end;
$$;

select cron.schedule('fitcontrol-aforo', '*/15 * * * *', $$select public.avisar_aforo_alto()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-aforo');

-- ── 3) AFORO PARA EL SOCIO (app) ────────────────────────────────────────────
-- Resuelve el socio por auth.uid(). Si el usuario es socio en varios gyms,
-- elige el de la membresía ACTIVA más reciente (fecha_fin desc); si no tiene
-- ninguna membresía activa en ningún gym, cae al registro de socio más
-- reciente (created_at desc) como fallback razonable.
create or replace function public.aforo_mi_sede()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_socio record;
  v_sede record;
  v_tz text;
  v_hoy date;
  v_dentro int;
  v_pct numeric;
  v_nivel text;
begin
  if v_uid is null then
    return jsonb_build_object('encontrado', false);
  end if;

  select s.id as socio_id, s.sede_id, s.empresa_id
  into v_socio
  from public.socio s
  where s.usuario_id = v_uid and s.deleted_at is null
  order by
    (select max(m.fecha_fin) from public.membresia m
      where m.socio_id = s.id and m.estado = 'activa' and m.deleted_at is null) desc nulls last,
    s.created_at desc
  limit 1;

  if v_socio.socio_id is null then
    return jsonb_build_object('encontrado', false);
  end if;

  select se.aforo_max, coalesce(e.zona_horaria, 'America/Lima') as zona_horaria
  into v_sede
  from public.sede se
  join public.empresa e on e.id = se.empresa_id
  where se.id = v_socio.sede_id;

  if v_sede.aforo_max is null or v_sede.aforo_max <= 0 then
    return jsonb_build_object('encontrado', true, 'dentro', null, 'aforo_max', null, 'pct', null, 'nivel', null);
  end if;

  v_tz := v_sede.zona_horaria;
  v_hoy := (now() at time zone v_tz)::date;

  with entradas_hoy as (
    select coalesce(c.socio_id, c.usuario_id) as persona, c.ocurrido_en
    from public.checkin c
    where c.empresa_id = v_socio.empresa_id
      and c.sede_id = v_socio.sede_id
      and c.direccion = 'entrada'
      and c.resultado = 'permitido'
      and (c.ocurrido_en at time zone v_tz)::date = v_hoy
      and c.ocurrido_en >= now() - interval '2 hours'
      and coalesce(c.socio_id, c.usuario_id) is not null
  ),
  salidas_hoy as (
    select coalesce(c.socio_id, c.usuario_id) as persona, c.ocurrido_en
    from public.checkin c
    where c.empresa_id = v_socio.empresa_id
      and c.sede_id = v_socio.sede_id
      and c.direccion = 'salida'
      and c.resultado = 'permitido'
      and (c.ocurrido_en at time zone v_tz)::date = v_hoy
      and coalesce(c.socio_id, c.usuario_id) is not null
  )
  select count(*)
  into v_dentro
  from entradas_hoy en
  where not exists (
    select 1 from salidas_hoy sa
    where sa.persona = en.persona and sa.ocurrido_en > en.ocurrido_en
  );

  v_pct := round((v_dentro::numeric / v_sede.aforo_max) * 100, 1);
  v_nivel := case when v_pct >= 80 then 'alto' when v_pct >= 50 then 'moderado' else 'bajo' end;

  return jsonb_build_object(
    'encontrado', true,
    'dentro', v_dentro,
    'aforo_max', v_sede.aforo_max,
    'pct', v_pct,
    'nivel', v_nivel
  );
end;
$$;

grant execute on function public.aforo_mi_sede() to authenticated;
