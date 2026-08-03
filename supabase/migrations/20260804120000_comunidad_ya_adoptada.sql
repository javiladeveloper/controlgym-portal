-- La tarjeta de comunidad necesita saber si TÚ ya adoptaste esa rutina.
--
-- REPORTADO por el owner al preguntar "¿en qué momento puedo puntuar?": las
-- estrellas se pintan siempre, pero `votar_rutina` exige haber adoptado la
-- rutina. Quien no la ha usado toca una estrella y recibe un error — ofrecer
-- algo que no funciona, que es justo lo que se ha estado corrigiendo.
--
-- Con este campo la app puede atenuar las estrellas y explicar cómo
-- desbloquearlas ("Úsala para poder puntuarla") en vez de dejar que falle.
-- Se añade también `mi_voto` para poder mostrar la puntuación que ya diste, en
-- vez de estrellas vacías como si no hubieras votado.
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
           -- ¿La adoptó QUIEN consulta? Es lo que habilita puntuar.
           exists (
             select 1 from public.rutina_libre rl
             where rl.usuario_id = auth.uid() and rl.origen_predisenada_id = rp.id
           ) as ya_adoptada,
           -- Su voto, si ya votó: así se ven las estrellas que puso y no unas
           -- vacías que sugieren que no ha valorado nada.
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
