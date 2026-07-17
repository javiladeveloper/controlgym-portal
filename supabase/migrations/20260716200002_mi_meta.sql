-- RPC mi_meta(): devuelve la meta activa del usuario + datos calculados
-- (peso actual, ritmo real kg/semana con signo, semanas estimadas, estado).
create or replace function public.mi_meta()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_meta record;
  v_actual numeric; v_primero numeric; v_dias numeric;
  v_ritmo numeric;            -- kg por semana (con signo: negativo = bajando)
  v_falta numeric;           -- kg que faltan hasta el objetivo (con signo)
  v_semanas numeric;
  v_estado text;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  select * into v_meta from public.meta_peso
    where usuario_id = v_uid and activa order by creado_at desc limit 1;
  if not found then return 'null'::jsonb; end if;

  -- Peso actual = última medida.
  select peso_kg into v_actual from public.medida_personal
    where usuario_id = v_uid and peso_kg is not null order by fecha desc limit 1;

  -- Ritmo: comparar la última medida con la más antigua de las últimas 6 semanas.
  select peso_kg, (current_date - fecha) into v_primero, v_dias
    from public.medida_personal
    where usuario_id = v_uid and peso_kg is not null
      and fecha >= current_date - interval '6 weeks'
    order by fecha asc limit 1;

  if v_actual is null then
    v_estado := 'sin_datos';
  elsif abs(v_actual - v_meta.peso_objetivo_kg) < 0.3 then
    v_estado := 'meta_alcanzada';
  elsif v_primero is null or v_dias is null or v_dias < 7 or v_primero = v_actual then
    v_estado := 'sin_datos';       -- aún no hay tendencia (menos de una semana o un solo registro)
  else
    v_ritmo := (v_actual - v_primero) / (v_dias / 7.0);   -- kg/semana con signo
    v_falta := v_actual - v_meta.peso_objetivo_kg;         -- >0 si hay que bajar
    -- ¿el ritmo va hacia la meta? bajar: ritmo<0 y falta>0 ; subir: ritmo>0 y falta<0
    if (v_falta > 0 and v_ritmo < -0.05) or (v_falta < 0 and v_ritmo > 0.05) then
      v_semanas := round(abs(v_falta) / abs(v_ritmo));
      v_estado := 'en_camino';
    else
      v_estado := 'sin_avance';
    end if;
  end if;

  return jsonb_build_object(
    'peso_objetivo_kg', v_meta.peso_objetivo_kg,
    'peso_inicial_kg', v_meta.peso_inicial_kg,
    'fecha_inicio', v_meta.fecha_inicio,
    'peso_actual_kg', v_actual,
    'ritmo_kg_semana', v_ritmo,
    'semanas_estimadas', v_semanas,
    'estado', v_estado
  );
end;
$function$;

grant execute on function public.mi_meta() to authenticated;
