-- Aforo: "dentro" = entro HOY y no ha marcado salida. Se elimina la regla
-- heuristica de expirar entradas a las 2 horas (pedido del owner: "mientras
-- no salgan, en teoria siguen ahi"). Aplica a las 3 funciones que la usaban:
-- aforo_actual (panel), aforo_mi_sede (app) y avisar_aforo_alto (cron alerta).
--
-- Complemento: job nocturno que CIERRA las entradas de dias anteriores que
-- quedaron sin salida (inserta la salida a las 23:59 hora local del dia de la
-- entrada), para higiene de datos. El conteo del aforo igual se reinicia solo
-- a medianoche local porque esta acotado a "hoy".

CREATE OR REPLACE FUNCTION public.aforo_actual(p_sede_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Existencia/tenencia de la sede SEPARADA del aforo_max: una sede legitima
  -- sin aforo configurado devuelve aforo_max null (la UI oculta la tarjeta),
  -- no un error enganoso.
  if not exists (select 1 from public.sede s
                  where s.id = p_sede_id and s.empresa_id = v_empresa) then
    raise exception 'Sede no encontrada o sin acceso';
  end if;
  select s.aforo_max into v_aforo_max
  from public.sede s
  where s.id = p_sede_id and s.empresa_id = v_empresa;

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

  -- Sin aforo configurado -> pct null (la UI no muestra porcentaje ni barra).
  v_pct := case when v_aforo_max > 0
                then round((v_dentro::numeric / v_aforo_max) * 100, 1)
                else null end;

  return jsonb_build_object(
    'dentro', v_dentro,
    'aforo_max', v_aforo_max,
    'pct', v_pct
  );
end;
$function$;


-- =====

CREATE OR REPLACE FUNCTION public.aforo_mi_sede()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


-- =====

CREATE OR REPLACE FUNCTION public.avisar_aforo_alto()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ============================================================
-- Cierre nocturno: salidas automaticas para entradas huerfanas
-- ============================================================
-- 'auto' como metodo valido: distingue estas salidas del resto en reportes.
alter table public.checkin drop constraint if exists checkin_metodo_check;
alter table public.checkin add constraint checkin_metodo_check
  check (metodo = any (array['huella','tarjeta','facial','tactil','qr','app','manual','auto']));

create or replace function public.cerrar_checkins_abiertos()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_cerrados int := 0;
begin
  -- Entradas permitidas de DIAS LOCALES ANTERIORES sin salida posterior en su
  -- mismo dia local -> se les inserta la salida a las 23:59 (hora local del
  -- gym) de ese dia. Idempotente: la salida insertada hace que la proxima
  -- corrida ya no las considere abiertas.
  with abiertas as (
    select c.*, coalesce(e.zona_horaria, 'America/Lima') as tz,
           (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima'))::date as dia_local
    from public.checkin c
    join public.empresa e on e.id = c.empresa_id
    where c.direccion = 'entrada'
      and c.resultado = 'permitido'
      and coalesce(c.socio_id, c.usuario_id) is not null
      and (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima'))::date
          < (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::date
      and not exists (
        select 1 from public.checkin s
        where s.empresa_id = c.empresa_id and s.sede_id = c.sede_id
          and s.direccion = 'salida' and s.resultado = 'permitido'
          and coalesce(s.socio_id, s.usuario_id) = coalesce(c.socio_id, c.usuario_id)
          and s.ocurrido_en > c.ocurrido_en
          and (s.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima'))::date
              = (c.ocurrido_en at time zone coalesce(e.zona_horaria, 'America/Lima'))::date
      )
  ),
  ins as (
    insert into public.checkin (empresa_id, sede_id, socio_id, usuario_id, rol,
                                direccion, metodo, resultado, motivo, ocurrido_en)
    select a.empresa_id, a.sede_id, a.socio_id, a.usuario_id, a.rol,
           'salida', 'auto', 'permitido', 'Cierre automatico del dia',
           (a.dia_local::timestamp + time '23:59') at time zone a.tz
    from abiertas a
    returning 1
  )
  select count(*) into v_cerrados from ins;
  return v_cerrados;
end; $$;

revoke all on function public.cerrar_checkins_abiertos() from public;

-- Cron diario 08:00 UTC = 03:00 America/Lima (mismo huso que los demas jobs)
select cron.unschedule(jobid) from cron.job where jobname = 'fitcontrol-cierre-checkins';
select cron.schedule('fitcontrol-cierre-checkins', '0 8 * * *', 'select public.cerrar_checkins_abiertos()');
