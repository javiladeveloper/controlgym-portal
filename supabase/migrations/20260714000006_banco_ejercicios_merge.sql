-- Banco de ejercicios unificado: el catálogo global (1369 con GIF) FUSIONADO con
-- la personalización del gym. Cada gym ve todos los ejercicios del catálogo con
-- su GIF genérico; si ya personalizó uno (su propio video/foto/descripción en la
-- tabla `ejercicio`, casado por nombre), se muestra ESA versión y se marca como
-- personalizado. El gym nunca escribe el catálogo global (solo su fila `ejercicio`).
--
-- Casamiento por nombre (lower): `ejercicio` no tiene ext_id; el nombre es la
-- llave natural entre el catálogo y lo que el gym ya usó/editó.
create or replace function public.banco_ejercicios_gym(
  p_empresa_id uuid, p_texto text default null, p_offset int default 0, p_limit int default 40)
returns setof jsonb language sql stable security definer set search_path = public as $$
  -- Solo el propio gym (o el backend con service_role, sin JWT → auth_empresa_id null).
  select jsonb_build_object(
    'catalogo_id', c.id,
    'ejercicio_id', e.id,                       -- id en la tabla del gym (null si aún no lo personalizó/usó)
    'nombre', coalesce(c.nombre_es, c.nombre),
    'grupo_muscular', coalesce(e.grupo_muscular, c.grupo_muscular),
    'body_part', c.body_part,
    'target', c.target,
    'equipment', c.equipment,
    -- media EFECTIVA: si el gym personalizó, la suya; si no, el GIF/foto del catálogo
    'gif_catalogo', c.gif_url,                   -- el GIF genérico animado (siempre del catálogo)
    'foto_catalogo', c.foto_url,
    -- video del gym solo si es un video REAL (TikTok/YouTube/Vimeo), no el .gif
    -- que el trigger de herencia copió del catálogo a video_url.
    'video_gym', case when e.video_url like '%.gif' then null else e.video_url end,
    'foto_gym', e.foto_url,                      -- foto propia del gym, si la subió
    'descripcion', coalesce(nullif(e.descripcion,''), c.instrucciones->>'es', c.instrucciones->>'en'),
    -- personalizado = el gym puso media PROPIA: un video real (no el .gif
    -- heredado) o una foto suya. La descripción se hereda del catálogo, así que
    -- no cuenta como señal de personalización (saldría en todos).
    'personalizado', (e.id is not null and (
      (e.video_url is not null and e.video_url not like '%.gif') or e.foto_url is not null))
  )
  from public.ejercicio_catalogo c
  left join lateral (
    -- override del gym: se resuelve por el empresa del JWT (auth_empresa_id), no
    -- por el parámetro, así ningún gym ve la personalización de otro. Con
    -- service_role (sin JWT) cae al p_empresa_id pasado.
    select * from public.ejercicio e2
    where e2.empresa_id = coalesce(auth_empresa_id(), p_empresa_id)
      and lower(e2.nombre) = lower(coalesce(c.nombre_es, c.nombre))
    order by e2.created_at limit 1
  ) e on true
  where c.activo
    and (p_texto is null or (coalesce(c.nombre_es,'') || ' ' || c.nombre) ilike '%'||p_texto||'%')
  order by coalesce(c.nombre_es, c.nombre)
  offset greatest(p_offset,0) limit least(coalesce(p_limit,40), 60);
$$;
revoke all on function public.banco_ejercicios_gym(uuid,text,int,int) from public;
grant execute on function public.banco_ejercicios_gym(uuid,text,int,int) to authenticated, service_role;
