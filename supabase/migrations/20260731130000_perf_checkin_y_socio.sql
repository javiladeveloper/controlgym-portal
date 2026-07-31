-- Rendimiento: hacer indexables las políticas de `checkin` y aliviar el RLS de
-- `socio`. NO cambia QUIÉN ve QUÉ — solo cómo se evalúa.
--
-- MEDICIONES (auditoría de rendimiento, con carga sintética de 50k filas):
--
-- 1. `checkin`: las 2 políticas se combinan con OR entre columnas distintas
--    (`socio_id IN (...) OR empresa_id = ...`). Una disyunción así NO puede usar
--    índice: leer 2 filas de 566 costó 46 ms, y a 50k filas 907 ms / 13,951
--    buffers. Acotar por fecha NO lo arregla (761 ms). Se arregla en la política.
--
-- 2. `socio`: la policy del socio llama `sede_con_app(sede_id)` POR FILA. Es
--    STABLE pero al recibir argumento no se cachea entre filas: leer 2 socios
--    costó 142 buffers. Multiplica ~5-10× casi toda consulta de la app.
--
-- INVARIANTE: los permisos quedan EXACTAMENTE iguales.
--   · staff  → los checkins de su empresa (y de sus sedes, o todas si es admin)
--   · socio  → solo los checkins propios
-- Lo único que cambia es que ahora el planner puede usar índices.

-- ── 1. Índices de apoyo ────────────────────────────────────────────────────
-- El socio filtra por socio_id; el staff por (empresa_id, sede_id). Sin estos,
-- ninguna reescritura de la policy sirve.
create index if not exists checkin_socio_idx on public.checkin (socio_id);
create index if not exists checkin_empresa_sede_idx on public.checkin (empresa_id, sede_id);

-- ── 2. Política del socio: sin EXISTS correlacionado ───────────────────────
-- Antes: EXISTS (select 1 from socio s where s.id = checkin.socio_id and
--                s.usuario_id = auth.uid())
-- El EXISTS correlacionado obliga a mirar `socio` por cada fila de checkin.
-- Ahora: `socio_id in (select ...)` — la subconsulta NO depende de la fila, se
-- evalúa UNA vez y el resultado se compara contra checkin_socio_idx.
drop policy if exists socio_app_checkin on public.checkin;
create policy socio_app_checkin on public.checkin
  for select to authenticated
  using (
    socio_id in (
      select s.id from public.socio s where s.usuario_id = (select auth.uid())
    )
  );

-- ── 3. Política del staff: envolver las funciones en subselect ─────────────
-- `(select auth_empresa_id())` en vez de `auth_empresa_id()` hace que Postgres
-- la trate como InitPlan (se evalúa UNA vez, no por fila). Es el patrón que
-- recomienda Supabase para RLS a escala. La lógica es idéntica.
drop policy if exists checkin_scope on public.checkin;
create policy checkin_scope on public.checkin
  for all to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and (
      sede_id is null
      or sede_id in (select public.auth_sede_ids())
      or (select public.auth_is_admin())
    )
  )
  with check (empresa_id = (select public.auth_empresa_id()));

-- ── 4. `socio`: mismas dos policies, con las funciones como InitPlan ───────
-- sede_con_app(sede_id) recibe la columna, así que no se puede sacar de la
-- fila; pero sí se puede evitar que auth.uid() se re-evalúe por fila, y
-- reordenar para que el filtro barato (usuario_id) descarte antes de llamar a
-- sede_con_app. Postgres no garantiza el orden, pero con el índice de
-- usuario_id la mayoría de filas se descartan por índice y sede_con_app solo
-- corre sobre las pocas que quedan.
create index if not exists socio_usuario_idx on public.socio (usuario_id) where usuario_id is not null;

drop policy if exists socio_app_self on public.socio;
create policy socio_app_self on public.socio
  for select to authenticated
  using (
    usuario_id = (select auth.uid())
    and public.sede_con_app(sede_id)
  );

drop policy if exists socio_scope on public.socio;
create policy socio_scope on public.socio
  for all to authenticated
  using (
    empresa_id = (select public.auth_empresa_id())
    and (
      sede_id is null
      or sede_id in (select public.auth_sede_ids())
      or (select public.auth_is_admin())
    )
  )
  with check (empresa_id = (select public.auth_empresa_id()));

-- ── 5. mi_resumen_progreso: acotar por fecha y limitar arrays ──────────────
-- Hacía CUATRO escaneos del historial completo (racha, top, volumen, peso),
-- ninguno con cota de fecha, y devolvía volumen/peso_corporal sin límite.
-- Se acota a 12 meses (suficiente para la vista) y se limitan los arrays.
-- El shape de retorno NO cambia: la app sigue leyendo las mismas keys.
create or replace function public.mi_resumen_progreso()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_desde date;
  v_entrenos_mes int := 0;
  v_racha int := 0;
  v_top jsonb := '[]'::jsonb;
  v_volumen jsonb := '[]'::jsonb;
  v_peso jsonb := '[]'::jsonb;
  v_dia date;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  -- Ventana de 12 meses: la vista de progreso no muestra más atrás, y sin esta
  -- cota cada llamada escaneaba TODO el historial del usuario.
  v_desde := (current_date - interval '12 months')::date;

  create temporary table if not exists tmp_sesiones_prog (
    fecha date, catalogo_id uuid, carga numeric
  ) on commit drop;
  truncate tmp_sesiones_prog;

  -- Una sola pasada por las dos fuentes (antes eran 4 escaneos separados).
  insert into tmp_sesiones_prog (fecha, catalogo_id, carga)
  select r.fecha, r.catalogo_id, r.carga_usada
  from public.registro_entreno_libre r
  where r.usuario_id = v_uid and r.completado and r.fecha >= v_desde
  union all
  select r.fecha, r.catalogo_id, r.carga_usada
  from public.registro_entreno_ejercicio r
  where r.socio_id in (select s.id from public.socio s where s.usuario_id = v_uid)
    and r.completado and r.fecha >= v_desde;

  -- Entrenos del mes en curso.
  select count(distinct fecha) into v_entrenos_mes
  from tmp_sesiones_prog
  where fecha >= date_trunc('month', current_date)::date;

  -- Racha: días consecutivos hacia atrás con al menos un entreno.
  v_dia := current_date;
  if not exists (select 1 from tmp_sesiones_prog where fecha = v_dia) then
    v_dia := v_dia - 1; -- si hoy aún no entrenó, la racha puede venir de ayer
  end if;
  while exists (select 1 from tmp_sesiones_prog where fecha = v_dia) loop
    v_racha := v_racha + 1;
    v_dia := v_dia - 1;
  end loop;

  -- Top 5 ejercicios donde más subió la carga.
  select coalesce(jsonb_agg(x order by x->>'nombre'), '[]'::jsonb) into v_top
  from (
    select jsonb_build_object(
      'catalogo_id', s.catalogo_id,
      'nombre', coalesce(c.nombre_es, c.nombre),
      'carga_inicial', (array_agg(s.carga order by s.fecha asc) filter (where s.carga is not null))[1],
      'carga_actual', (array_agg(s.carga order by s.fecha desc) filter (where s.carga is not null))[1],
      'tendencia', case
        when (array_agg(s.carga order by s.fecha desc) filter (where s.carga is not null))[1]
           > (array_agg(s.carga order by s.fecha asc) filter (where s.carga is not null))[1] then 'sube'
        when (array_agg(s.carga order by s.fecha desc) filter (where s.carga is not null))[1]
           < (array_agg(s.carga order by s.fecha asc) filter (where s.carga is not null))[1] then 'baja'
        else 'igual' end
    ) as x
    from tmp_sesiones_prog s
    join public.ejercicio_catalogo c on c.id = s.catalogo_id
    where s.catalogo_id is not null
    group by s.catalogo_id, c.nombre_es, c.nombre
    having count(*) > 1
    order by count(*) desc
    limit 5
  ) t;

  -- Volumen por mes (máx 12 puntos por la cota de fecha).
  select coalesce(jsonb_agg(x order by x->>'periodo'), '[]'::jsonb) into v_volumen
  from (
    select jsonb_build_object(
      'periodo', to_char(date_trunc('month', fecha), 'YYYY-MM'),
      'volumen_total', round(coalesce(sum(carga), 0))
    ) as x
    from tmp_sesiones_prog
    group by date_trunc('month', fecha)
  ) t;

  -- Peso corporal: últimas 60 medidas dentro de la ventana.
  select coalesce(jsonb_agg(x order by x->>'fecha'), '[]'::jsonb) into v_peso
  from (
    select jsonb_build_object('fecha', m.fecha, 'peso_kg', m.peso_kg) as x
    from public.medida_personal m
    where m.usuario_id = v_uid and m.peso_kg is not null and m.fecha >= v_desde
    order by m.fecha desc
    limit 60
  ) t;

  drop table if exists tmp_sesiones_prog;

  return jsonb_build_object(
    'racha', jsonb_build_object('entrenos_mes', v_entrenos_mes, 'dias_racha', v_racha),
    'top_ejercicios', v_top,
    'volumen', v_volumen,
    'peso_corporal', v_peso
  );
end;
$$;

revoke all on function public.mi_resumen_progreso() from public, authenticated;
grant execute on function public.mi_resumen_progreso() to authenticated, service_role;
