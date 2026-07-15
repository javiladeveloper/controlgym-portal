-- Equipo que cada sede tiene, para filtrar el catálogo a lo que puede hacer.
create table if not exists public.sede_equipo (
  sede_id     uuid not null references public.sede(id) on delete cascade,
  empresa_id  uuid not null references public.empresa(id) on delete cascade,
  equipment   text not null,
  disponible  boolean not null default true,
  primary key (sede_id, equipment)
);
alter table public.sede_equipo enable row level security;
drop policy if exists sede_equipo_rw on public.sede_equipo;
create policy sede_equipo_rw on public.sede_equipo for all to authenticated
  using (empresa_id = auth_empresa_id()) with check (empresa_id = auth_empresa_id());

-- Lista el equipo marcado de una sede (para pintar el checklist del panel).
create or replace function public.equipo_de_sede(p_sede_id uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select equipment from public.sede_equipo where sede_id = p_sede_id and disponible;
$$;
grant execute on function public.equipo_de_sede(uuid) to authenticated, service_role;

-- Nueva sobrecarga de búsqueda que cruza con el equipo de la sede (body weight
-- siempre disponible: no requiere equipo).
create or replace function public.buscar_ejercicios_catalogo(
  p_texto text, p_body_part text, p_equipment text, p_target text,
  p_offset int, p_limit int, p_sede_id uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id, 'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular, 'target', target,
    'equipment', equipment, 'gif_url', gif_url, 'foto_url', foto_url)
  from public.ejercicio_catalogo c
  where activo
    and (p_texto is null or (coalesce(nombre_es,'') || ' ' || nombre) ilike '%'||p_texto||'%')
    and (p_body_part is null or body_part = p_body_part)
    and (p_equipment is null or equipment = p_equipment)
    and (p_target is null or target = p_target)
    and (p_sede_id is null or equipment = 'body weight'
         or equipment in (select equipment from public.sede_equipo where sede_id = p_sede_id and disponible))
  order by coalesce(nombre_es, nombre)
  offset greatest(p_offset,0) limit least(coalesce(p_limit,30), 60);
$$;
revoke all on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int,uuid) from public;
grant execute on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int,uuid) to authenticated, service_role;
