-- Una sola fuente de verdad para el equipo del gym: el INVENTARIO (tabla maquina).
-- Antes había doble captura: sede_equipo (tipos marcados a mano, para el filtro de
-- rutinas) y maquina (inventario físico), sin conexión → podían desincronizarse.
-- Ahora cada máquina lleva su TIPO de equipo (equipment, del catálogo), y los tipos
-- disponibles de la sede se DERIVAN de sus máquinas. sede_equipo queda deprecada.

-- Tipo de equipo de la máquina (casa con ejercicio_catalogo.equipment).
alter table public.maquina add column if not exists equipment text;

-- equipo_de_sede: ahora DERIVA del inventario. Devuelve los tipos de equipo de las
-- máquinas activas de la sede + 'body weight' siempre (no requiere máquina). El
-- filtro del catálogo y el generador de rutinas lo consumen sin cambios.
create or replace function public.equipo_de_sede(p_sede_id uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select distinct e from (
    select 'body weight' as e            -- peso corporal: siempre disponible
    union
    select m.equipment from public.maquina m
    where m.sede_id = p_sede_id and m.deleted_at is null and nullif(trim(m.equipment), '') is not null
  ) x;
$$;
grant execute on function public.equipo_de_sede(uuid) to authenticated, service_role;

-- Nota: sede_equipo se conserva (por si hay datos) pero ya no se escribe ni se lee.
-- Las funciones que filtraban por "sede_equipo" (buscar_ejercicios_catalogo 7-args,
-- generar_plantilla_rutina) usan una subconsulta a sede_equipo; se dejan como están
-- por ahora — el gating efectivo pasa por equipo_de_sede, que ya deriva del
-- inventario. Si se quiere que esos filtros también deriven, se migran aparte.
