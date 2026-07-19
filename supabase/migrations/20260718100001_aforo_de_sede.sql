-- aforo_de_sede(p_sede_id): aforo de la sede que la app tiene ABIERTA, no de
-- "una sede elegida por el backend". Devuelve dato solo si el usuario es socio
-- de esa sede con membresía VIGENTE (activa y sin vencer). Reemplaza el uso de
-- aforo_mi_sede desde la app (esa se conserva por compatibilidad).
--
-- Motivación: un socio puede pertenecer a varios gyms. aforo_mi_sede elegía
-- "una sola sede" por membresía más reciente, mostrando el aforo de la sede
-- equivocada (o 0). Ahora la app pasa la sede que tiene abierta y el aforo la
-- sigue. Además, el aforo es beneficio de socio activo: con membresía vencida
-- no se muestra.
create or replace function public.aforo_de_sede(p_sede_id uuid)
 returns jsonb
 language plpgsql stable security definer set search_path to 'public'
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
  if v_uid is null or p_sede_id is null then
    return jsonb_build_object('encontrado', false);
  end if;
  -- Gate PEDIDO 43: sede sin app no expone aforo.
  if not public.sede_con_app(p_sede_id) then
    return jsonb_build_object('encontrado', false);
  end if;

  -- El socio del usuario EN esa sede.
  select s.id as socio_id, s.sede_id, s.empresa_id
  into v_socio
  from public.socio s
  where s.usuario_id = v_uid and s.sede_id = p_sede_id and s.deleted_at is null
  limit 1;
  if v_socio.socio_id is null then
    return jsonb_build_object('encontrado', false);
  end if;

  select se.aforo_max, coalesce(e.zona_horaria, 'America/Lima') as zona_horaria
  into v_sede
  from public.sede se join public.empresa e on e.id = se.empresa_id
  where se.id = p_sede_id;

  v_tz := v_sede.zona_horaria;
  v_hoy := (now() at time zone v_tz)::date;

  -- Solo con membresía VIGENTE (activa y fecha_fin >= hoy) se muestra aforo.
  if not exists (
    select 1 from public.membresia m
    where m.socio_id = v_socio.socio_id and m.deleted_at is null
      and m.estado = 'activa'
      and (m.fecha_fin is null or m.fecha_fin >= v_hoy)
  ) then
    return jsonb_build_object('encontrado', true, 'dentro', null, 'aforo_max', null, 'pct', null, 'nivel', null);
  end if;

  if v_sede.aforo_max is null or v_sede.aforo_max <= 0 then
    return jsonb_build_object('encontrado', true, 'dentro', null, 'aforo_max', null, 'pct', null, 'nivel', null);
  end if;

  with entradas_hoy as (
    select coalesce(c.socio_id, c.usuario_id) as persona, c.ocurrido_en
    from public.checkin c
    where c.empresa_id = v_socio.empresa_id and c.sede_id = p_sede_id
      and c.direccion = 'entrada' and c.resultado = 'permitido'
      and (c.ocurrido_en at time zone v_tz)::date = v_hoy
      and coalesce(c.socio_id, c.usuario_id) is not null
  ),
  salidas_hoy as (
    select coalesce(c.socio_id, c.usuario_id) as persona, c.ocurrido_en
    from public.checkin c
    where c.empresa_id = v_socio.empresa_id and c.sede_id = p_sede_id
      and c.direccion = 'salida' and c.resultado = 'permitido'
      and (c.ocurrido_en at time zone v_tz)::date = v_hoy
      and coalesce(c.socio_id, c.usuario_id) is not null
  )
  select count(*) into v_dentro
  from entradas_hoy en
  where not exists (
    select 1 from salidas_hoy sa where sa.persona = en.persona and sa.ocurrido_en > en.ocurrido_en
  );

  v_pct := round((v_dentro::numeric / v_sede.aforo_max) * 100, 1);
  v_nivel := case when v_pct >= 80 then 'alto' when v_pct >= 50 then 'moderado' else 'bajo' end;

  return jsonb_build_object('encontrado', true, 'dentro', v_dentro,
    'aforo_max', v_sede.aforo_max, 'pct', v_pct, 'nivel', v_nivel);
end;
$function$;

-- Solo usuarios autenticados (mismo patrón que aforo_mi_sede). Por defecto
-- Postgres da EXECUTE a PUBLIC en funciones nuevas; lo revocamos.
revoke execute on function public.aforo_de_sede(uuid) from anon, public;
grant execute on function public.aforo_de_sede(uuid) to authenticated;