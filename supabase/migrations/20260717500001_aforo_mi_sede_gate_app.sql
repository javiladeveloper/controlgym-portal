-- Fix: aforo_mi_sede() elegía la sede del socio por membresía activa más
-- reciente SIN filtrar por sede_con_app. Resultado: para un socio de varios
-- gyms, podía elegir una sede en plan SIN app (que ni siquiera es visible en la
-- app por el PEDIDO 43) → mostraba el aforo (o 0) de la sede equivocada.
--
-- Caso real: jonathan es socio de MaximusGym (con app, con check-ins) y de
-- Jonathan Trainer (plan sin app). La RPC elegía Jonathan Trainer → dentro=0
-- aunque MaximusGym tuviera gente. Además, mostrar el aforo de una sede sin app
-- contradice el gate del PEDIDO 43.
--
-- Fix: la selección de la sede excluye las que no tienen app
-- (and public.sede_con_app(s.sede_id)). El resto de la lógica queda igual.
create or replace function public.aforo_mi_sede()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    and public.sede_con_app(s.sede_id)   -- solo sedes visibles en la app (PEDIDO 43)
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
