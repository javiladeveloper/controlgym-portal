-- RPCs de progresión para el SOCIO autenticado (PEDIDO 48b de la app).
-- A diferencia de analizar_progresion_socio (staff, exige empresa activa y
-- devuelve serie cruda), estas las llama el SOCIO (gate por socio.usuario_id =
-- auth.uid(), sin empresa activa) y devuelven el VEREDICTO ya clasificado por el
-- motor SQL (_progresion_clasificar) + un mensaje listo para mostrar en la app.
--
--   mi_progresion()        → rutina ASIGNADA del gym (mundo A)
--   mi_progresion_libre()  → rutina LIBRE del socio (mundo B)
--
-- Salida por ejercicio: { rutina_ejercicio_id | rutina_libre_ejercicio_id,
--   ejercicio, grupo_muscular, estado, carga_actual, sugerencia_kg, mensaje }.

-- ── Mundo A: rutina asignada ────────────────────────────────────────────────
-- "veces_esperado" = semanas TRANSCURRIDAS hasta hoy (no toda la vigencia
-- futura): el socio ve su avance en vivo, sin que arrancar una rutina larga lo
-- haga parecer que "evita" todo por tener pocas sesiones aún.
create or replace function public.mi_progresion()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_socio_id uuid;
  v_rutina_id uuid;
  v_inicio date;
  v_fin date;
  v_semanas int;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- un usuario puede ser socio en varias empresas: elegir el que tiene rutina activa.
  select s.id, ru.id, ru.vigencia_inicio, ru.vigencia_fin
    into v_socio_id, v_rutina_id, v_inicio, v_fin
  from public.socio s
  join public.rutina ru on ru.socio_id = s.id and ru.activa
  where s.usuario_id = v_uid and s.deleted_at is null
  order by ru.created_at desc
  limit 1;

  if v_rutina_id is null then
    return jsonb_build_object('tiene_rutina', false, 'ejercicios', '[]'::jsonb);
  end if;

  if v_inicio is null then v_inicio := current_date - 60; end if;
  if v_fin is null then v_fin := current_date; end if;
  v_semanas := greatest(1, ceil((least(v_fin, current_date) - v_inicio + 1) / 7.0))::int;

  select coalesce(jsonb_agg(jsonb_build_object(
      'rutina_ejercicio_id', x.id,
      'ejercicio', x.nombre,
      'grupo_muscular', x.grupo,
      'estado', (x.v->>'estado'),
      'carga_actual', (x.v->'carga_actual'),
      'sugerencia_kg', (x.v->'sugerencia_kg'),
      'mensaje', case (x.v->>'estado')
        when 'adaptado' then 'Ya dominas ' || x.nombre ||
          case when (x.v->'sugerencia_kg') is not null and (x.v->>'carga_actual') is not null
               then ' — ¿subimos a ' || (x.v->>'sugerencia_kg') || ' kg?'
               else ' — ¿subimos el peso?' end
        when 'estancado' then x.nombre || ' se estancó — baja un poco el peso y vuelve a subir, o cámbialo.'
        when 'evitado' then 'Casi no haces ' || x.nombre || ' — ¿lo cambiamos por otro?'
        else null end
    ) order by x.dia_semana nulls last, x.orden nulls last, x.nombre), '[]'::jsonb)
    into v_out
  from (
    select re.id, re.nombre, re.orden, rd.dia_semana, ej.grupo_muscular as grupo,
      public._progresion_clasificar(
        ej.grupo_muscular, v_semanas,
        coalesce((
          select jsonb_agg(jsonb_build_object('completado', ree.completado, 'carga', ree.carga_usada) order by ree.fecha)
          from public.registro_entreno_ejercicio ree
          where ree.rutina_ejercicio_id = re.id and ree.socio_id = v_socio_id
            and ree.fecha between v_inicio and v_fin
        ), '[]'::jsonb)
      ) as v
    from public.rutina_ejercicio re
    join public.rutina_dia rd on rd.id = re.rutina_dia_id
    left join public.ejercicio ej on ej.id = re.ejercicio_id
    where rd.rutina_id = v_rutina_id
  ) x;

  return jsonb_build_object('tiene_rutina', true, 'periodo',
    jsonb_build_object('inicio', v_inicio, 'fin', v_fin), 'ejercicios', v_out);
end $$;

revoke all on function public.mi_progresion() from public, authenticated;
grant execute on function public.mi_progresion() to authenticated;

-- ── Mundo B: rutina libre ───────────────────────────────────────────────────
-- Se liga por usuario_id directo; el grupo muscular sale del catálogo global
-- (ejercicio_catalogo). Ventana 60 días (la rutina libre no tiene vigencia).
create or replace function public.mi_progresion_libre()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_rl_id uuid;
  v_inicio date := current_date - 60;
  v_fin date := current_date;
  v_semanas int := 9;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  select id into v_rl_id from public.rutina_libre
  where usuario_id = v_uid and activa
  order by created_at desc limit 1;
  if v_rl_id is null then
    return jsonb_build_object('tiene_rutina', false, 'ejercicios', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'rutina_libre_ejercicio_id', x.id,
      'ejercicio', x.nombre,
      'grupo_muscular', x.grupo,
      'estado', (x.v->>'estado'),
      'carga_actual', (x.v->'carga_actual'),
      'sugerencia_kg', (x.v->'sugerencia_kg'),
      'mensaje', case (x.v->>'estado')
        when 'adaptado' then 'Ya dominas ' || x.nombre ||
          case when (x.v->'sugerencia_kg') is not null and (x.v->>'carga_actual') is not null
               then ' — ¿subimos a ' || (x.v->>'sugerencia_kg') || ' kg?'
               else ' — ¿subimos el peso?' end
        when 'estancado' then x.nombre || ' se estancó — baja un poco el peso y vuelve a subir, o cámbialo.'
        when 'evitado' then 'Casi no haces ' || x.nombre || ' — ¿lo cambiamos por otro?'
        else null end
    ) order by x.dia_semana nulls last, x.orden nulls last, x.nombre), '[]'::jsonb)
    into v_out
  from (
    select rle.id, rle.nombre, rle.orden, rld.dia_semana, ec.grupo_muscular as grupo,
      public._progresion_clasificar(
        ec.grupo_muscular, v_semanas,
        coalesce((
          select jsonb_agg(jsonb_build_object('completado', rel.completado, 'carga', rel.carga_usada) order by rel.fecha)
          from public.registro_entreno_libre rel
          where rel.rutina_libre_ejercicio_id = rle.id and rel.fecha between v_inicio and v_fin
        ), '[]'::jsonb)
      ) as v
    from public.rutina_libre_ejercicio rle
    join public.rutina_libre_dia rld on rld.id = rle.rutina_libre_dia_id
    left join public.ejercicio_catalogo ec on ec.id = rle.catalogo_id
    where rld.rutina_libre_id = v_rl_id
  ) x;

  return jsonb_build_object('tiene_rutina', true, 'periodo',
    jsonb_build_object('inicio', v_inicio, 'fin', v_fin), 'ejercicios', v_out);
end $$;

revoke all on function public.mi_progresion_libre() from public, authenticated;
grant execute on function public.mi_progresion_libre() to authenticated;
