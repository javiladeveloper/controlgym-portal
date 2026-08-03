-- Clasificar el nivel de una rutina automáticamente y publicar sin aprobación.
--
-- DECISIÓN DEL OWNER: "nosotros sabemos que es una buena rutina, de qué se
-- compone, y según eso podemos categorizar las rutinas". Cierto — y el criterio
-- ya está escrito en `generar_rutina_libre`: ese generador decide series y tope
-- de ejercicios SEGÚN el nivel. El clasificador solo lee al revés lo que el
-- generador escribe, así que ambos hablan el mismo idioma.
--
-- Umbrales del generador (los mismos que se usan aquí):
--   principiante → 4 ejercicios/día máx · intermedio → 5 · avanzado → 6
--   las series suben con el nivel (avanzado = +1 sobre la base del objetivo)
--
-- PROBLEMA QUE ARREGLA: hoy `publicar_mi_rutina` marca TODA rutina publicada
-- como 'intermedio' fijo. Una de 2 días con 4 ejercicios y otra de 6 días con
-- 40 salían con la misma etiqueta, así que el filtro por nivel del catálogo era
-- decorativo.
--
-- Y con el nivel calculado, la aprobación previa deja de ser necesaria: la
-- rutina se publica al instante y el control pasa a ser posterior (3 reportes
-- la retiran solas, ya implementado en `reportar_rutina`). Menos fricción para
-- quien comparte y cero trabajo manual mientras nadie se queje.

-- ── Clasificador ────────────────────────────────────────────────────────────
-- Mira el volumen real de la rutina: cuántos ejercicios por día y cuántas
-- series por ejercicio. No opina sobre la calidad, mide la carga.
create or replace function public.clasificar_nivel_rutina(p_rutina_libre uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  with m as (
    select
      -- Ejercicios por día: el promedio, no el total. Una rutina de 6 días con
      -- 4 ejercicios cada uno NO es más dura por día que una de 2 días con 4.
      coalesce(avg(x.ejercicios), 0) as ej_por_dia,
      coalesce(avg(x.series_prom), 0) as series_prom
    from (
      select d.id,
             count(e.id) as ejercicios,
             coalesce(avg(e.series), 0) as series_prom
      from public.rutina_libre_dia d
      left join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
      where d.rutina_libre_id = p_rutina_libre
      group by d.id
    ) x
  )
  select case
    -- Avanzado: llega al tope del generador (6/día) o mete muchas series.
    when m.ej_por_dia >= 6 or m.series_prom >= 4.5 then 'avanzado'
    -- Principiante: poco volumen por sesión, como genera el propio sistema
    -- para quien empieza (4 ejercicios, series bajas).
    when m.ej_por_dia <= 4 and m.series_prom <= 3.5 then 'principiante'
    else 'intermedio'
  end
  from m;
$$;

revoke all on function public.clasificar_nivel_rutina(uuid) from public;
grant execute on function public.clasificar_nivel_rutina(uuid) to authenticated;

-- ── Publicar: nivel calculado y sin cola de aprobación ──────────────────────
create or replace function public.publicar_mi_rutina(
  p_rutina_libre uuid,
  p_descripcion text,
  p_objetivo text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rl record;
  v_nueva uuid;
  v_dia record;
  v_dia_nuevo uuid;
  v_nivel text;
  v_dias int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if coalesce(trim(p_descripcion),'') = '' then
    raise exception 'Escribe una descripción para que otros sepan de qué va';
  end if;
  if not exists (select 1 from public.objetivo_entrenamiento where codigo = p_objetivo) then
    raise exception 'Objetivo inválido';
  end if;
  -- La regla de salud se mantiene aunque ya no haya revisión humana: estas
  -- categorías necesitan criterio profesional, y eso un algoritmo no lo suple.
  if p_objetivo in ('rehabilitacion', 'prenatal') then
    raise exception 'Las rutinas de rehabilitación y prenatales solo puede publicarlas FitCore: necesitan revisión profesional';
  end if;

  select * into v_rl from public.rutina_libre
   where id = p_rutina_libre and usuario_id = v_uid;
  if not found then raise exception 'Esa rutina no es tuya'; end if;

  select count(*) into v_dias
  from public.rutina_libre_dia where rutina_libre_id = v_rl.id;
  if v_dias = 0 then
    raise exception 'Tu rutina no tiene días todavía';
  end if;
  if not exists (
    select 1 from public.rutina_libre_dia d
    join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
    where d.rutina_libre_id = v_rl.id
  ) then
    raise exception 'Tu rutina no tiene ejercicios todavía';
  end if;

  if exists (
    select 1
    from public.rutina_libre_dia d
    join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
    where d.rutina_libre_id = v_rl.id and e.catalogo_id is null
  ) then
    raise exception 'Tu rutina tiene ejercicios sin enlazar al catálogo; edítala antes de compartirla';
  end if;

  -- El nivel lo pone el sistema, no quien publica: alguien puede etiquetar mal
  -- la suya (por optimismo o por error) y el filtro del catálogo dejaría de
  -- servir. Antes se ponía 'intermedio' a todas, que es aún peor.
  v_nivel := public.clasificar_nivel_rutina(v_rl.id);

  insert into public.rutina_predisenada
    (slug, nombre, categoria, descripcion, nivel, dias_por_semana, equipo,
     activa, autor_id, estado, objetivo, aprobada_at)
  values (
    'u-' || replace(gen_random_uuid()::text, '-', ''),
    coalesce(nullif(trim(v_rl.nombre),''), 'Rutina de la comunidad'),
    'comunidad',
    trim(p_descripcion),
    v_nivel,
    v_dias,
    coalesce(v_rl.equipo, 'gym_completo'),
    -- Se publica de una: el control es POSTERIOR (3 reportes la retiran, ver
    -- `reportar_rutina`). Con el nivel ya calculado, hacer esperar a alguien
    -- por una revisión manual solo añadía fricción.
    true, v_uid, 'aprobada', p_objetivo, now()
  )
  returning id into v_nueva;

  for v_dia in
    select * from public.rutina_libre_dia
     where rutina_libre_id = v_rl.id order by dia_semana
  loop
    insert into public.rutina_predisenada_dia (predisenada_id, dia_semana, foco)
    values (v_nueva, v_dia.dia_semana, v_dia.foco)
    returning id into v_dia_nuevo;

    insert into public.rutina_predisenada_ejercicio
      (predisenada_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
    select v_dia_nuevo, e.catalogo_id, e.nombre, e.series, e.reps, e.descanso, e.orden
    from public.rutina_libre_ejercicio e
    where e.rutina_libre_dia_id = v_dia.id;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_nueva, 'estado', 'aprobada', 'nivel', v_nivel);
end;
$function$;

revoke all on function public.publicar_mi_rutina(uuid, text, text) from public;
grant execute on function public.publicar_mi_rutina(uuid, text, text) to authenticated;

-- ── Reclasificar lo ya publicado ────────────────────────────────────────────
-- Las rutinas de comunidad que existan quedaron con 'intermedio' fijo. No se
-- pueden reclasificar (la rutina_libre de origen pudo cambiar o desaparecer),
-- así que se recalcula desde la COPIA publicada, que es lo que ven los demás.
update public.rutina_predisenada rp
   set nivel = sub.nivel
from (
  select rp2.id,
         case
           when avg(x.ejercicios) >= 6 or avg(x.series_prom) >= 4.5 then 'avanzado'
           when avg(x.ejercicios) <= 4 and avg(x.series_prom) <= 3.5 then 'principiante'
           else 'intermedio'
         end as nivel
  from public.rutina_predisenada rp2
  join (
    select d.predisenada_id, d.id,
           count(e.id) as ejercicios,
           coalesce(avg(e.series), 0) as series_prom
    from public.rutina_predisenada_dia d
    left join public.rutina_predisenada_ejercicio e on e.predisenada_dia_id = d.id
    group by d.predisenada_id, d.id
  ) x on x.predisenada_id = rp2.id
  where rp2.autor_id is not null
  group by rp2.id
) sub
where rp.id = sub.id;
