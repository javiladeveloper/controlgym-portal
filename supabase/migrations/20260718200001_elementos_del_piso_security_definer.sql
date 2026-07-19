-- Fix: elementos_del_piso hacía LEFT JOIN a public.maquina SIN security definer,
-- así que para el socio (rol authenticated) la RLS de `maquina` devolvía null en
-- nombre/zona/estado — el mapa de la app mostraba máquinas sin nombre (todas con
-- el mismo ícono). Con security definer el JOIN lee la máquina con los permisos
-- de la función (como las otras RPCs del mapa). No expone datos sensibles: solo
-- nombre/zona/estado de la máquina, que el socio debe ver en el mapa de su gym.
create or replace function public.elementos_del_piso(p_piso_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pe.id, 'fila', pe.fila, 'columna', pe.columna, 'tipo', pe.tipo,
    'maquina_id', pe.maquina_id, 'etiqueta', pe.etiqueta,
    'nombre', coalesce(m.nombre, pe.etiqueta), 'zona', m.zona, 'estado', m.estado)
    order by pe.fila, pe.columna), '[]'::jsonb)
  from public.piso_elemento pe
  left join public.maquina m on m.id = pe.maquina_id
  where pe.piso_id = p_piso_id;
$function$;
