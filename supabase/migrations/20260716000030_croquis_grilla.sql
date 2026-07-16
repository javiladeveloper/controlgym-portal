-- Croquis por CUADRÍCULA (en vez de subir una imagen de plano): el gym arma la
-- distribución del piso con casillas (grilla filas×columnas) y coloca en cada
-- casilla una de sus máquinas registradas. Reutiliza el patrón del mapa de
-- asientos (sala/sala_posicion). Aditivo: plano_url/pos_x/pos_y viejos se
-- conservan pero ya no se usan en el editor nuevo.

-- Dimensiones de la grilla del piso (default 8×8, ajustable en el editor).
alter table public.sede_piso add column if not exists filas int not null default 8;
alter table public.sede_piso add column if not exists columnas int not null default 8;

-- Casilla donde está la máquina en la grilla de su piso.
alter table public.maquina add column if not exists grid_fila int;
alter table public.maquina add column if not exists grid_columna int;

-- maquinas_del_piso: ahora devuelve la casilla (grid_fila/grid_columna) además de
-- lo anterior. Solo máquinas colocadas (grid_fila/columna not null).
create or replace function public.maquinas_del_piso(p_piso_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'zona', zona, 'estado', estado, 'unidades', unidades,
    'grid_fila', grid_fila, 'grid_columna', grid_columna) order by nombre), '[]'::jsonb)
  from public.maquina
  where piso_id = p_piso_id and deleted_at is null
    and grid_fila is not null and grid_columna is not null;
$$;
grant execute on function public.maquinas_del_piso(uuid) to authenticated, service_role;

-- Colocar (o mover) una máquina en una casilla de un piso. Valida que el piso
-- sea de la sede de la máquina (misma defensa que ubicar_maquina) y que la
-- casilla esté dentro de la grilla del piso. p_fila/p_columna null = quitar del
-- croquis. RLS de maquina restringe qué máquina toca el staff.
create or replace function public.colocar_maquina_grilla(p_maquina_id uuid, p_piso_id uuid, p_fila int, p_columna int)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  update public.maquina m
     set piso_id = p_piso_id,
         grid_fila = p_fila,
         grid_columna = p_columna,
         updated_at = now()
   where m.id = p_maquina_id
     and (p_piso_id is null or exists (
       select 1 from public.sede_piso sp
       where sp.id = p_piso_id and sp.sede_id = m.sede_id
         and (p_fila is null or (p_fila >= 0 and p_fila < sp.filas))
         and (p_columna is null or (p_columna >= 0 and p_columna < sp.columnas))));
  if not found then raise exception 'máquina no encontrada, sin acceso, o casilla fuera del piso'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.colocar_maquina_grilla(uuid,uuid,int,int) to authenticated, service_role;

-- Guardar el tamaño de la grilla de un piso (el editor lo ajusta). Solo staff
-- (RLS de sede_piso aplica en el update). Mínimo 2, máximo 20 por lado.
create or replace function public.set_grilla_piso(p_piso_id uuid, p_filas int, p_columnas int)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  update public.sede_piso
     set filas = greatest(2, least(20, p_filas)),
         columnas = greatest(2, least(20, p_columnas))
   where id = p_piso_id;
  if not found then raise exception 'piso no encontrado o sin acceso'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.set_grilla_piso(uuid,int,int) to authenticated, service_role;

-- pisos_de_sede: devolver también filas/columnas de la grilla.
create or replace function public.pisos_de_sede(p_sede_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'orden', orden, 'plano_url', plano_url,
    'filas', filas, 'columnas', columnas) order by orden, nombre), '[]'::jsonb)
  from public.sede_piso where sede_id = p_sede_id;
$$;
grant execute on function public.pisos_de_sede(uuid) to authenticated, service_role;
