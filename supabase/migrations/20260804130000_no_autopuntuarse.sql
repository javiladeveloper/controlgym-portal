-- Nadie puntúa su propia rutina, y la tarjeta sabe cuál es tuya.
--
-- El owner, al ver "Úsala para puntuarla" en una rutina que él mismo publicó:
-- "yo mismo no puedo puntuarla porque es mía, y para que la puntúen otros deben
-- al menos usarla". Exacto — pero faltaban las dos mitades:
--
-- 1. `votar_rutina` NO comprobaba la autoría. Hoy el autor no puede votar por
--    accidente (nunca adopta su propia rutina, así que falla el chequeo de
--    "solo puedes puntuar una rutina que hayas usado"), pero eso es una
--    protección indirecta: si alguna vez adoptara su propia rutina publicada,
--    podría autopuntuarse 5 estrellas. Con pocas rutinas en la comunidad, un
--    solo voto propio distorsiona el ranking entero.
-- 2. La app no distingue "no la has usado" de "es tuya", así que le pedía al
--    autor que usara su propia rutina para poder puntuarla.

create or replace function public.votar_rutina(p_rutina uuid, p_estrellas int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if p_estrellas < 1 or p_estrellas > 5 then
    raise exception 'La puntuación va de 1 a 5';
  end if;

  -- Nadie puntúa lo suyo: la nota debe venir de quien la usó, no de quien la
  -- escribió.
  if exists (
    select 1 from public.rutina_predisenada
     where id = p_rutina and autor_id = v_uid
  ) then
    raise exception 'No puedes puntuar tu propia rutina';
  end if;

  if not exists (
    select 1 from public.rutina_libre
     where usuario_id = v_uid and origen_predisenada_id = p_rutina
  ) then
    raise exception 'Solo puedes puntuar una rutina que hayas usado';
  end if;

  insert into public.rutina_voto (rutina_id, usuario_id, estrellas)
  values (p_rutina, v_uid, p_estrellas)
  on conflict (rutina_id, usuario_id)
  do update set estrellas = excluded.estrellas, created_at = now();

  update public.rutina_predisenada rp
     set votos = v.n, puntuacion_prom = v.prom
    from (select count(*) n, round(avg(estrellas), 2) prom
          from public.rutina_voto where rutina_id = p_rutina) v
   where rp.id = p_rutina;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.votar_rutina(uuid, int) from public;
grant execute on function public.votar_rutina(uuid, int) to authenticated;

-- La tarjeta necesita saber si la rutina es TUYA para decir "Tu rutina" en vez
-- de pedirte que la uses para puntuarla.
create or replace function public.listar_rutinas_comunidad(
  p_orden text default 'puntuacion',
  p_objetivo text default null,
  p_nivel text default null,
  p_dias int default null,
  p_equipo text default null,
  p_buscar text default null
) returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  with params as (
    select 5::numeric as m,
           coalesce((select avg(puntuacion_prom) from public.rutina_predisenada
                      where estado='aprobada' and autor_id is not null and votos > 0), 3.5) as c
  )
  select coalesce(jsonb_agg(t order by
           case when p_orden = 'usadas' then t.veces_adoptada end desc nulls last,
           case when p_orden = 'nuevas' then extract(epoch from t.aprobada_at) end desc nulls last,
           case when p_orden not in ('usadas','nuevas') then t.ranking end desc nulls last
         ), '[]'::jsonb)
  from (
    select rp.id, rp.nombre, rp.descripcion, rp.objetivo, rp.nivel,
           rp.dias_por_semana, rp.equipo, rp.puntuacion_prom, rp.votos,
           rp.veces_adoptada, rp.aprobada_at,
           coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1)) as autor,
           -- ¿La escribiste tú? Entonces no hay nada que puntuar.
           (rp.autor_id = auth.uid()) as es_mia,
           exists (
             select 1 from public.rutina_libre rl
             where rl.usuario_id = auth.uid() and rl.origen_predisenada_id = rp.id
           ) as ya_adoptada,
           (select v.estrellas from public.rutina_voto v
             where v.rutina_id = rp.id and v.usuario_id = auth.uid()) as mi_voto,
           (rp.votos / (rp.votos + p.m)) * rp.puntuacion_prom
             + (p.m / (rp.votos + p.m)) * p.c as ranking
    from public.rutina_predisenada rp
    join public.usuario u on u.id = rp.autor_id
    cross join params p
    where rp.estado = 'aprobada'
      and rp.autor_id is not null
      and (p_objetivo is null or rp.objetivo = p_objetivo)
      and (p_nivel is null or rp.nivel = p_nivel)
      and (p_equipo is null or rp.equipo = p_equipo)
      and (p_dias is null or
           (p_dias = 2 and rp.dias_por_semana <= 2) or
           (p_dias = 4 and rp.dias_por_semana between 3 and 4) or
           (p_dias = 5 and rp.dias_por_semana >= 5))
      and (p_buscar is null or
           rp.nombre ilike '%' || p_buscar || '%' or
           coalesce(rp.descripcion,'') ilike '%' || p_buscar || '%')
  ) t;
$$;

revoke all on function public.listar_rutinas_comunidad(text, text, text, int, text, text) from public;
grant execute on function public.listar_rutinas_comunidad(text, text, text, int, text, text) to authenticated;
