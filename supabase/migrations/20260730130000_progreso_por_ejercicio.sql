-- BLOQUE 4 (spec 2026-07-30-entrenamiento-completo-app-design.md): progreso
-- por ejercicio (propio usuario) + resumen general.
--
-- Un usuario del app puede tener registros en dos mundos:
--   - registro_entreno_libre     (usuario_id = auth.uid())          -- rutina libre
--   - registro_entreno_ejercicio (socio_id in sus socios)           -- rutina de gym
-- Ambos ganaron catalogo_id en el BLOQUE 1 (20260730100000). Aquí se cruzan
-- POR catalogo_id para reconstruir "todo lo que hice de Sentadilla" sin
-- importar en qué rutina/gym haya estado, y para armar el resumen general.
--
--   mi_historial_ejercicio(p_catalogo_id) -> serie temporal de un ejercicio.
--   mi_resumen_progreso()                 -> racha + top ejercicios + volumen + peso corporal.

-- ============================================================
-- Índices: las consultas cruzan por catalogo_id + fecha.
-- ============================================================

create index if not exists reg_libre_cat_idx on public.registro_entreno_libre(catalogo_id, fecha);
create index if not exists reg_ej_cat_idx on public.registro_entreno_ejercicio(catalogo_id, fecha);

-- ============================================================
-- mi_historial_ejercicio: serie temporal del PROPIO usuario para un
-- ejercicio del catálogo, uniendo rutina libre + rutina(s) de gym.
-- ============================================================

create or replace function public.mi_historial_ejercicio(p_catalogo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_nombre text;
  v_grupo text;
  v_sesiones jsonb;
  v_veces int;
  v_carga_inicial numeric;
  v_carga_actual numeric;
  v_tendencia text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if p_catalogo_id is null then raise exception 'falta el ejercicio'; end if;

  select coalesce(ec.nombre_es, ec.nombre), ec.grupo_muscular
    into v_nombre, v_grupo
  from public.ejercicio_catalogo ec
  where ec.id = p_catalogo_id;

  with sesiones as (
    select rel.fecha, rel.carga_usada
    from public.registro_entreno_libre rel
    where rel.usuario_id = v_uid
      and rel.catalogo_id = p_catalogo_id
      and rel.completado
    union all
    select ree.fecha, ree.carga_usada
    from public.registro_entreno_ejercicio ree
    where ree.socio_id in (select s.id from public.socio s where s.usuario_id = v_uid)
      and ree.catalogo_id = p_catalogo_id
      and ree.completado
  ),
  ordenadas as (
    select fecha, carga_usada from sesiones order by fecha asc
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('fecha', fecha, 'carga_usada', carga_usada) order by fecha asc), '[]'::jsonb),
    count(*),
    (array_agg(carga_usada order by fecha asc) filter (where carga_usada is not null))[1],
    (array_agg(carga_usada order by fecha desc) filter (where carga_usada is not null))[1]
  into v_sesiones, v_veces, v_carga_inicial, v_carga_actual
  from ordenadas;

  v_tendencia := case
    when v_carga_inicial is null or v_carga_actual is null then null
    when v_carga_actual > v_carga_inicial then 'sube'
    when v_carga_actual < v_carga_inicial then 'baja'
    else 'igual'
  end;

  return jsonb_build_object(
    'catalogo_id', p_catalogo_id,
    'nombre', v_nombre,
    'grupo_muscular', v_grupo,
    'sesiones', v_sesiones,
    'veces', coalesce(v_veces, 0),
    'carga_inicial', v_carga_inicial,
    'carga_actual', v_carga_actual,
    'tendencia', v_tendencia
  );
end;
$$;

revoke all on function public.mi_historial_ejercicio(uuid) from public, authenticated;
grant execute on function public.mi_historial_ejercicio(uuid) to authenticated, service_role;

-- ============================================================
-- mi_resumen_progreso: GENERAL del propio usuario, uniendo ambos mundos.
--   racha: entrenos del mes actual + días consecutivos con >=1 entreno.
--   top_ejercicios: top 5 por catalogo_id donde más subió la carga.
--   volumen: Σ carga_usada por mes (aprox de volumen; no hay series×reps en
--            el registro, solo en el slot -- se usa carga_usada por sesión
--            completada, que es lo disponible hoy).
--   peso_corporal: de medida_personal, con fallback al peso puntual de usuario.
-- Sin datos -> arrays vacíos, nunca null ni excepción.
-- ============================================================

create or replace function public.mi_resumen_progreso()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_dias_entreno date[];
  v_entrenos_mes int;
  v_dias_racha int;
  v_top jsonb;
  v_volumen jsonb;
  v_peso jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- días distintos (de cualquiera de los dos mundos) con >=1 entreno completado.
  select coalesce(array_agg(distinct fecha order by fecha desc), '{}'::date[])
    into v_dias_entreno
  from (
    select rel.fecha
    from public.registro_entreno_libre rel
    where rel.usuario_id = v_uid and rel.completado
    union
    select ree.fecha
    from public.registro_entreno_ejercicio ree
    where ree.socio_id in (select s.id from public.socio s where s.usuario_id = v_uid)
      and ree.completado
  ) d;

  select count(*) into v_entrenos_mes
  from unnest(v_dias_entreno) as fecha
  where date_trunc('month', fecha) = date_trunc('month', current_date);

  -- racha: días consecutivos hasta hoy (o hasta ayer si hoy aún no entrenó).
  with dias as (
    select fecha from unnest(v_dias_entreno) as fecha where fecha <= current_date
  ),
  numeradas as (
    select fecha, row_number() over (order by fecha desc) as rn
    from dias
  ),
  racha as (
    select fecha, rn, fecha + rn::int as grupo
    from numeradas
  ),
  primer_grupo as (
    select grupo, count(*) as largo
    from racha
    group by grupo
    order by grupo desc
    limit 1
  )
  select coalesce(largo, 0) into v_dias_racha
  from primer_grupo;

  if v_dias_racha is null then v_dias_racha := 0; end if;

  -- si el día más reciente con entreno no es hoy ni ayer, la racha activa es 0.
  if not (current_date = any(v_dias_entreno) or (current_date - 1) = any(v_dias_entreno)) then
    v_dias_racha := 0;
  end if;

  -- top ejercicios: por catalogo_id, comparando primera vs última carga registrada.
  with sesiones as (
    select rel.catalogo_id, rel.fecha, rel.carga_usada
    from public.registro_entreno_libre rel
    where rel.usuario_id = v_uid and rel.completado and rel.catalogo_id is not null
    union all
    select ree.catalogo_id, ree.fecha, ree.carga_usada
    from public.registro_entreno_ejercicio ree
    where ree.socio_id in (select s.id from public.socio s where s.usuario_id = v_uid)
      and ree.completado and ree.catalogo_id is not null
  ),
  agregada as (
    select
      catalogo_id,
      (array_agg(carga_usada order by fecha asc) filter (where carga_usada is not null))[1] as carga_inicial,
      (array_agg(carga_usada order by fecha desc) filter (where carga_usada is not null))[1] as carga_actual
    from sesiones
    group by catalogo_id
  ),
  con_delta as (
    select a.catalogo_id, coalesce(ec.nombre_es, ec.nombre) as nombre,
      a.carga_inicial, a.carga_actual,
      case
        when a.carga_inicial is null or a.carga_actual is null then null
        when a.carga_actual > a.carga_inicial then 'sube'
        when a.carga_actual < a.carga_inicial then 'baja'
        else 'igual'
      end as tendencia,
      coalesce(a.carga_actual - a.carga_inicial, -1) as delta
    from agregada a
    left join public.ejercicio_catalogo ec on ec.id = a.catalogo_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'catalogo_id', catalogo_id,
      'nombre', nombre,
      'carga_inicial', carga_inicial,
      'carga_actual', carga_actual,
      'tendencia', tendencia
    ) order by delta desc nulls last), '[]'::jsonb)
    into v_top
  from (
    select * from con_delta order by delta desc nulls last limit 5
  ) x;

  -- volumen: Σ carga_usada por mes (aprox — no hay series×reps en el registro).
  with sesiones as (
    select rel.fecha, rel.carga_usada
    from public.registro_entreno_libre rel
    where rel.usuario_id = v_uid and rel.completado
    union all
    select ree.fecha, ree.carga_usada
    from public.registro_entreno_ejercicio ree
    where ree.socio_id in (select s.id from public.socio s where s.usuario_id = v_uid)
      and ree.completado
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'mes', to_char(mes, 'YYYY-MM'),
      'volumen_total', volumen_total
    ) order by mes asc), '[]'::jsonb)
    into v_volumen
  from (
    select date_trunc('month', fecha) as mes, sum(coalesce(carga_usada, 0)) as volumen_total
    from sesiones
    group by date_trunc('month', fecha)
  ) x;

  -- peso corporal: medida_personal (histórico); si no hay, cae al valor puntual de usuario.
  select coalesce(jsonb_agg(jsonb_build_object('fecha', fecha, 'peso_kg', peso_kg) order by fecha asc), '[]'::jsonb)
    into v_peso
  from public.medida_personal
  where usuario_id = v_uid and peso_kg is not null;

  if v_peso = '[]'::jsonb then
    select coalesce(jsonb_agg(jsonb_build_object('fecha', current_date, 'peso_kg', u.peso_kg)), '[]'::jsonb)
      into v_peso
    from public.usuario u
    where u.id = v_uid and u.peso_kg is not null;
  end if;

  return jsonb_build_object(
    'racha', jsonb_build_object('entrenos_mes', coalesce(v_entrenos_mes, 0), 'dias_racha', coalesce(v_dias_racha, 0)),
    'top_ejercicios', v_top,
    'volumen', v_volumen,
    'peso_corporal', v_peso
  );
end;
$$;

revoke all on function public.mi_resumen_progreso() from public, authenticated;
grant execute on function public.mi_resumen_progreso() to authenticated, service_role;
