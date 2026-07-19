-- analizar_progresion_socio: por cada ejercicio de la rutina activa del socio,
-- devuelve grupo muscular, series objetivo, veces esperadas y la serie
-- cronológica de sesiones (fecha, completado, carga) que el motor JS clasifica
-- (src/lib/analizarProgresion.js). Reusa el periodo/vigencia igual que
-- progreso_socio. security definer + aislamiento por empresa.
--
-- El label del día sale de rutina_dia.foco (texto libre del trainer) y, si está
-- vacío, de "Día N" con dia_semana (rutina_dia no tiene columna 'nombre').
create or replace function public.analizar_progresion_socio(p_socio_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_socio_id uuid;
  v_rutina_id uuid;
  v_inicio date;
  v_fin date;
  v_semanas numeric;
  v_ejercicios jsonb;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;

  select id into v_socio_id from public.socio
  where id = p_socio_id and empresa_id = v_emp and deleted_at is null;
  if v_socio_id is null then raise exception 'socio no encontrado o sin acceso'; end if;

  select id, vigencia_inicio, vigencia_fin into v_rutina_id, v_inicio, v_fin
  from public.rutina
  where socio_id = p_socio_id and empresa_id = v_emp and activa
  order by created_at desc limit 1;

  if v_inicio is null then v_inicio := current_date - 60; end if;
  if v_fin is null then v_fin := current_date; end if;
  v_semanas := greatest(1, ceil((v_fin - v_inicio + 1) / 7.0));

  -- por ejercicio de la rutina activa: grupo muscular (del catálogo del gym),
  -- series objetivo, veces_esperado (nº de semanas del periodo, ya que cada
  -- ejercicio de un día toca 1 vez por semana), y la serie de sesiones.
  select coalesce(jsonb_agg(jsonb_build_object(
      'ejercicio', t.nombre,
      'grupo_muscular', t.grupo_muscular,
      'dia', t.dia_nombre,
      'dia_id', t.dia_id,
      'series_obj', t.series,
      'veces_esperado', round(v_semanas)::int,
      'sesiones', t.sesiones
    ) order by t.dia_semana nulls last, t.orden nulls last, t.nombre), '[]'::jsonb)
    into v_ejercicios
  from (
    select re.id, re.nombre, re.orden, re.series,
           ej.grupo_muscular,
           rd.id as dia_id,
           rd.dia_semana,
           coalesce(nullif(trim(rd.foco), ''), 'Día ' || rd.dia_semana::text) as dia_nombre,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                 'fecha', ree.fecha, 'completado', ree.completado, 'carga', ree.carga_usada
               ) order by ree.fecha)
             from public.registro_entreno_ejercicio ree
             where ree.rutina_ejercicio_id = re.id
               and ree.fecha between v_inicio and v_fin
           ), '[]'::jsonb) as sesiones
    from public.rutina_ejercicio re
    join public.rutina_dia rd on rd.id = re.rutina_dia_id
    left join public.ejercicio ej on ej.id = re.ejercicio_id
    where rd.rutina_id = v_rutina_id
  ) t;

  return jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_inicio, 'fin', v_fin),
    'ejercicios', v_ejercicios
  );
end $$;

-- Bloqueo por defecto: en este esquema authenticated tiene execute por default
-- privilege, así que hay que revocar a public Y authenticated y regrantear
-- explícitamente. La RPC valida empresa internamente (security definer).
revoke all on function public.analizar_progresion_socio(uuid) from public, authenticated;
grant execute on function public.analizar_progresion_socio(uuid) to authenticated;
