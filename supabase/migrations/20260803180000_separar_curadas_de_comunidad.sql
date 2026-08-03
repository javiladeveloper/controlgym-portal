-- Las rutinas de la comunidad NO deben salir en "Rutinas listas".
--
-- REPORTADO por el owner: aprobó una rutina de comunidad y "aparece en rutinas
-- listas", mezclada con las 5 curadas por FitCore (verificado: la RPC devolvía
-- 6 en vez de 5).
--
-- CAUSA: `listar_rutinas_predisenadas` filtra solo `where p.activa`, sin mirar
-- `autor_id`. Cuando esa RPC se escribió, TODAS las prediseñadas eran curadas
-- por FitCore, así que no hacía falta distinguir. Al abrir la publicación a los
-- usuarios (Parte B) esa consulta se quedó igual y empezó a mezclarlas.
--
-- No es cosmético: una rutina de cualquier usuario aparecía con el mismo peso
-- que las que FitCore curó y revisó, y el socio no tenía forma de saber cuál
-- era cuál. Las de comunidad tienen su propia sección, con el autor, su
-- puntuación y el aviso de que no las revisó un profesional.
--
-- FIX: devuelve SOLO las curadas (`autor_id is null`). Las de comunidad ya
-- salen por `listar_rutinas_comunidad`, que además trae autor y estrellas.
--
-- Se conserva el cuerpo tal cual estaba (mismos parámetros `p_categoria` /
-- `p_equipo`, mismo shape del JSON): cambiar el nombre de un parámetro exige
-- DROP previo, y cambiar el shape rompería la app en silencio.
create or replace function public.listar_rutinas_predisenadas(
  p_categoria text default null,
  p_equipo text default null
) returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $function$
  select coalesce(jsonb_agg(t order by sub.orden, sub.nombre), '[]'::jsonb)
  from (
    select p.orden, p.nombre, jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'nombre', p.nombre, 'categoria', p.categoria,
      'descripcion', p.descripcion, 'nivel', p.nivel,
      'dias_por_semana', p.dias_por_semana, 'equipo', p.equipo,
      'disclaimer_salud', p.disclaimer_salud, 'imagen', p.imagen
    ) as t
    from public.rutina_predisenada p
    where p.activa
      -- SOLO las curadas por FitCore. Las de usuarios viven en su propia
      -- sección; mezclarlas aquí las hacía pasar por oficiales.
      and p.autor_id is null
      and (p_categoria is null or p.categoria = p_categoria)
      and (p_equipo is null or p.equipo = p_equipo)
  ) sub;
$function$;

revoke all on function public.listar_rutinas_predisenadas(text, text) from public;
grant execute on function public.listar_rutinas_predisenadas(text, text) to authenticated;
