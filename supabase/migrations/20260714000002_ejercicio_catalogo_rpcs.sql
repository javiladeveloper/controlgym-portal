-- Búsqueda paginada del catálogo (para el buscador del panel y de la app).
create or replace function public.buscar_ejercicios_catalogo(
  p_texto text default null, p_body_part text default null,
  p_equipment text default null, p_target text default null,
  p_offset int default 0, p_limit int default 30)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id,
    'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular,
    'target', target, 'equipment', equipment, 'gif_url', gif_url, 'foto_url', foto_url)
  from public.ejercicio_catalogo
  where activo
    and (p_texto is null or (coalesce(nombre_es,'') || ' ' || nombre) ilike '%'||p_texto||'%')
    and (p_body_part is null or body_part = p_body_part)
    and (p_equipment is null or equipment = p_equipment)
    and (p_target is null or target = p_target)
  order by coalesce(nombre_es, nombre)
  offset greatest(p_offset,0) limit least(coalesce(p_limit,30), 60);
$$;
revoke all on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int) from public;
grant execute on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int) to authenticated, service_role;

-- Detalle de un ejercicio con pasos en el idioma pedido (default español).
create or replace function public.ejercicio_catalogo_detalle(p_id uuid, p_idioma text default 'es')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id, 'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular, 'target', target,
    'secondary', secondary, 'equipment', equipment, 'gif_url', gif_url, 'foto_url', foto_url,
    'attribution', attribution,
    'instruccion', coalesce(instrucciones->>p_idioma, instrucciones->>'es', instrucciones->>'en'),
    'pasos', coalesce(pasos->p_idioma, pasos->'es', pasos->'en', '[]'::jsonb))
  from public.ejercicio_catalogo where id = p_id and activo;
$$;
revoke all on function public.ejercicio_catalogo_detalle(uuid,text) from public;
grant execute on function public.ejercicio_catalogo_detalle(uuid,text) to authenticated, service_role;
