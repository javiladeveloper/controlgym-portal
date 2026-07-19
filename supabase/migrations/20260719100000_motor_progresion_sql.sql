-- Motor de progresión portado a SQL (1:1 con src/lib/analizarProgresion.js).
-- Una sola función pura que, dada la lista de ejercicios con su serie de sesiones,
-- devuelve el veredicto por ejercicio. La comparten las RPCs del socio (mundo A y B).
-- Los umbrales son EXACTAMENTE los del JS; si cambian allá, cambiar aquí.

-- incremento sugerido por grupo muscular (extremo bajo del rango del spec).
create or replace function public._progresion_incremento_grupo(p_grupo text)
returns numeric
language sql immutable
as $$
  with g as (select lower(translate(coalesce(p_grupo,''),
    'áàäâéèëêíìïîóòöôúùüûñ','aaaaeeeeiiiioooouuuun')) as n)
  select case
    when (select n from g) ~ 'pierna|cuadriceps|femoral|gluteo|gemelo|pantorrilla|muslo' then 2.5
    when (select n from g) ~ 'biceps|triceps|antebrazo|abdomen|core|abdominal' then 0.5
    when (select n from g) ~ 'pecho|espalda|dorsal|hombro|trapecio' then 1.25
    else 1.25
  end;
$$;

-- clasifica UN ejercicio. p_sesiones = jsonb array [{completado,carga}] orden asc.
-- Devuelve jsonb { estado, sugerencia_kg, veces_completado, intentos, tasa, carga_actual }.
-- Orden (igual que el JS): sin_datos → evitado-ausencia → estancado →
-- evitado-incompletitud → adaptado → normal.
create or replace function public._progresion_clasificar(
  p_grupo text, p_veces_esperado int, p_sesiones jsonb)
returns jsonb
language plpgsql immutable
as $$
declare
  v_intentos int;
  v_completado int;
  v_esperado int := greatest(0, coalesce(p_veces_esperado, 0));
  v_tasa numeric;
  v_tasa_int numeric;
  v_constante boolean;
  v_fallos int;
  v_completadas int;
  v_incremento numeric := public._progresion_incremento_grupo(p_grupo);
  v_es_novato boolean;
  v_n int;
  v_carga_actual numeric;
  v_cargas numeric[];
begin
  v_intentos := coalesce(jsonb_array_length(p_sesiones), 0);

  if v_intentos = 0 then
    return jsonb_build_object('estado','sin_datos','sugerencia_kg',null,
      'veces_completado',0,'intentos',0,'tasa',0,'carga_actual',null);
  end if;

  select count(*) filter (where (s->>'completado')::boolean)
    into v_completado
  from jsonb_array_elements(p_sesiones) s;

  v_tasa := case when v_esperado>0 then v_completado::numeric/v_esperado else 0 end;
  v_tasa_int := case when v_esperado>0 then v_intentos::numeric/v_esperado else 0 end;

  select (s->>'carga')::numeric into v_carga_actual
  from jsonb_array_elements(p_sesiones) with ordinality t(s,i)
  where s->>'carga' is not null
  order by i desc limit 1;

  -- 1) EVITADO por ausencia
  if v_esperado>0 and v_tasa_int < 0.30 then
    return jsonb_build_object('estado','evitado','sugerencia_kg',null,
      'veces_completado',v_completado,'intentos',v_intentos,'tasa',v_tasa,'carga_actual',v_carga_actual);
  end if;

  v_constante := v_tasa_int >= 0.5;

  with ord as (
    select (s->>'completado')::boolean as c, row_number() over () as rn
    from jsonb_array_elements(p_sesiones) s
  ), rev as (select c, row_number() over (order by rn desc) as k from ord)
  select
    coalesce((select min(k)-1 from rev where c is distinct from false), (select count(*) from rev)),
    coalesce((select min(k)-1 from rev where c is distinct from true),  (select count(*) from rev))
  into v_fallos, v_completadas;

  -- 2) ESTANCADO
  if v_constante and v_fallos >= 3 then
    return jsonb_build_object('estado','estancado','sugerencia_kg',null,
      'veces_completado',v_completado,'intentos',v_intentos,'tasa',v_tasa,'carga_actual',v_carga_actual);
  end if;

  -- 3) EVITADO por incompletitud
  if v_esperado>0 and v_tasa < 0.30 then
    return jsonb_build_object('estado','evitado','sugerencia_kg',null,
      'veces_completado',v_completado,'intentos',v_intentos,'tasa',v_tasa,'carga_actual',v_carga_actual);
  end if;

  select array_agg((s->>'carga')::numeric order by i)
    into v_cargas
  from jsonb_array_elements(p_sesiones) with ordinality t(s,i)
  where (s->>'completado')::boolean and s->>'carga' is not null;

  if v_cargas is null or array_length(v_cargas,1) < 3 then
    v_es_novato := true;
  else
    v_es_novato := v_cargas[array_length(v_cargas,1)] > v_cargas[array_length(v_cargas,1)-2];
  end if;
  v_n := case when v_es_novato then 2 else 3 end;

  -- 4) ADAPTADO
  if v_constante and v_completadas >= v_n then
    return jsonb_build_object('estado','adaptado',
      'sugerencia_kg', case when v_carga_actual is not null then v_carga_actual + v_incremento else v_incremento end,
      'veces_completado',v_completado,'intentos',v_intentos,'tasa',v_tasa,'carga_actual',v_carga_actual);
  end if;

  -- 5) NORMAL
  return jsonb_build_object('estado','normal','sugerencia_kg',null,
    'veces_completado',v_completado,'intentos',v_intentos,'tasa',v_tasa,'carga_actual',v_carga_actual);
end $$;

revoke all on function public._progresion_clasificar(text, int, jsonb) from public, authenticated;
revoke all on function public._progresion_incremento_grupo(text) from public, authenticated;
grant execute on function public._progresion_clasificar(text, int, jsonb) to authenticated;
grant execute on function public._progresion_incremento_grupo(text) to authenticated;
