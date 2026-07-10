-- ============================================================================
-- PEDIDO 22 · 3 RPCs para el tab "Hoy" del entrenador en la app
--   · resumen_dia_trainer   : tarjetas resumen (presentes, activos, adherencia, entrenaron hoy)
--   · cargas_pendientes_gym : solicitudes de carga pendientes de todo el gym
--   · socios_en_riesgo      : socios con membresía vigente que no vienen hace N días
-- Todas: security definer, gating por auth_empresa_id() = p_empresa_id (patrón del proyecto).
-- ============================================================================

-- ── 1) resumen_dia_trainer ──────────────────────────────────────────────────
create or replace function public.resumen_dia_trainer(p_empresa_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_tz text;
  v_presentes_hoy int := 0;
  v_socios_activos int := 0;
  v_adherencia int := 0;
  v_entrenaron_hoy int := 0;
  v_entrenos_14d int := 0;
  v_socios_con_rutina int := 0;
begin
  if p_empresa_id is null or public.auth_empresa_id() is distinct from p_empresa_id then
    return jsonb_build_object(
      'presentes_hoy', 0, 'socios_activos', 0, 'adherencia_promedio', 0, 'entrenaron_hoy', 0
    );
  end if;

  select coalesce(zona_horaria, 'America/Lima') into v_tz
  from public.empresa where id = p_empresa_id;
  v_tz := coalesce(v_tz, 'America/Lima');

  -- presentes_hoy: entradas distintas hoy (hora local) menos salidas distintas hoy, nunca negativo
  select greatest(0,
    ( select count(distinct c.socio_id) from public.checkin c
       where c.empresa_id = p_empresa_id and c.direccion = 'entrada' and c.resultado = 'permitido'
         and (c.ocurrido_en at time zone v_tz)::date = current_date )
    -
    ( select count(distinct c.socio_id) from public.checkin c
       where c.empresa_id = p_empresa_id and c.direccion = 'salida' and c.resultado = 'permitido'
         and (c.ocurrido_en at time zone v_tz)::date = current_date )
  ) into v_presentes_hoy;

  select count(*) into v_socios_activos
  from public.socio s
  where s.empresa_id = p_empresa_id and s.estado = 'activo' and s.deleted_at is null;

  select count(*) into v_entrenaron_hoy
  from public.registro_entreno re
  where re.empresa_id = p_empresa_id and re.fecha = current_date and re.completado = true;

  -- adherencia_promedio: % de días entrenados vs. esperados, últimos 14 días,
  -- normalizado sobre socios activos que tienen al menos una rutina activa.
  select count(*) into v_socios_con_rutina
  from public.socio s
  where s.empresa_id = p_empresa_id and s.estado = 'activo' and s.deleted_at is null
    and exists (select 1 from public.rutina r where r.socio_id = s.id and r.activa);

  select count(*) into v_entrenos_14d
  from public.registro_entreno re
  join public.socio s on s.id = re.socio_id
  where re.empresa_id = p_empresa_id and re.completado = true
    and re.fecha >= current_date - interval '13 days'
    and re.fecha <= current_date
    and s.estado = 'activo' and s.deleted_at is null;

  if v_socios_con_rutina > 0 then
    v_adherencia := round(100.0 * v_entrenos_14d / (14 * v_socios_con_rutina));
    v_adherencia := greatest(0, least(100, v_adherencia));
  else
    v_adherencia := 0;
  end if;

  return jsonb_build_object(
    'presentes_hoy', v_presentes_hoy,
    'socios_activos', v_socios_activos,
    'adherencia_promedio', v_adherencia,
    'entrenaron_hoy', v_entrenaron_hoy
  );
end;
$function$;
grant execute on function public.resumen_dia_trainer(uuid) to authenticated;


-- ── 2) cargas_pendientes_gym ─────────────────────────────────────────────────
create or replace function public.cargas_pendientes_gym(p_empresa_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_result jsonb;
begin
  if p_empresa_id is null or public.auth_empresa_id() is distinct from p_empresa_id then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'socio_id', sc.socio_id,
      'socio_nombre', s.nombre,
      'ejercicio', sc.ejercicio_nombre,
      'carga_pedida', sc.carga_deseada
    ) as row
    from public.solicitud_carga sc
    join public.socio s on s.id = sc.socio_id
    where sc.empresa_id = p_empresa_id and sc.estado = 'pendiente'
    order by sc.creado_at desc
  ) t;

  return v_result;
end;
$function$;
grant execute on function public.cargas_pendientes_gym(uuid) to authenticated;


-- ── 3) socios_en_riesgo ──────────────────────────────────────────────────────
create or replace function public.socios_en_riesgo(p_empresa_id uuid, p_dias int)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_result jsonb;
  v_dias int := coalesce(p_dias, 7);
  v_tz text;
begin
  if p_empresa_id is null or public.auth_empresa_id() is distinct from p_empresa_id then
    return '[]'::jsonb;
  end if;

  select coalesce(zona_horaria, 'America/Lima') into v_tz
  from public.empresa where id = p_empresa_id;
  v_tz := coalesce(v_tz, 'America/Lima');

  select coalesce(jsonb_agg(row order by dias_sin_venir desc), '[]'::jsonb) into v_result
  from (
    select
      jsonb_build_object(
        'socio_id', s.id,
        'nombre', s.nombre,
        'dias_sin_venir', case
          when u.ultimo_checkin is null then greatest(0, current_date - s.created_at::date)
          else current_date - u.ultimo_checkin
        end
      ) as row,
      case
        when u.ultimo_checkin is null then greatest(999, current_date - s.created_at::date)
        else current_date - u.ultimo_checkin
      end as dias_sin_venir
    from public.socio s
    join public.membresia m on m.socio_id = s.id
      and m.empresa_id = p_empresa_id and m.estado = 'activa' and m.fecha_fin >= current_date
    left join lateral (
      select max((c.ocurrido_en at time zone v_tz)::date) as ultimo_checkin
      from public.checkin c
      where c.socio_id = s.id and c.direccion = 'entrada' and c.resultado = 'permitido'
    ) u on true
    where s.empresa_id = p_empresa_id and s.estado = 'activo' and s.deleted_at is null
      and (u.ultimo_checkin is null or u.ultimo_checkin < current_date - v_dias)
  ) t;

  return v_result;
end;
$function$;
grant execute on function public.socios_en_riesgo(uuid, int) to authenticated;
