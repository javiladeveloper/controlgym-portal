-- Pisos de una sede (para editor del panel y app). Lectura: staff o socio de la
-- sede (la RLS de sede_piso ya lo garantiza; security invoker respeta la RLS).
create or replace function public.pisos_de_sede(p_sede_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'orden', orden, 'plano_url', plano_url) order by orden, nombre), '[]'::jsonb)
  from public.sede_piso where sede_id = p_sede_id;
$$;
grant execute on function public.pisos_de_sede(uuid) to authenticated, service_role;

-- Máquinas UBICADAS en un piso (con su posición) — para pintar los pines.
create or replace function public.maquinas_del_piso(p_piso_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'zona', zona, 'estado', estado,
    'pos_x', pos_x, 'pos_y', pos_y) order by nombre), '[]'::jsonb)
  from public.maquina
  where piso_id = p_piso_id and deleted_at is null and pos_x is not null and pos_y is not null;
$$;
grant execute on function public.maquinas_del_piso(uuid) to authenticated, service_role;

-- Ubicar (o mover) una máquina en un piso. Clampa x/y a 0-100. Solo staff con
-- acceso a esa máquina (la RLS de maquina aplica en el update). security invoker.
create or replace function public.ubicar_maquina(p_maquina_id uuid, p_piso_id uuid, p_pos_x numeric, p_pos_y numeric)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  update public.maquina
     set piso_id = p_piso_id,
         pos_x = greatest(0, least(100, p_pos_x)),
         pos_y = greatest(0, least(100, p_pos_y)),
         updated_at = now()
   where id = p_maquina_id;   -- RLS de maquina restringe a las del staff
  if not found then raise exception 'máquina no encontrada o sin acceso'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.ubicar_maquina(uuid,uuid,numeric,numeric) to authenticated, service_role;

-- El socio puede indicar su piso al pedir ayuda (fallback: ubicacion_texto existente).
alter table public.solicitud_ayuda add column if not exists piso_id uuid references public.sede_piso(id) on delete set null;
