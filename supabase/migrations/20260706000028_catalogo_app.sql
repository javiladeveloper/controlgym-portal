-- RPC catalogo_app — la tienda del socio en la app.
--
-- La app (TiendaRepositorio) llama catalogo_app(p_empresa_id, p_sede_id) para
-- listar los productos comprables. Es SECURITY DEFINER porque el SOCIO no tiene
-- RLS para leer `producto`/`inventario_sede` directo (esas policies usan
-- auth_empresa_id(), pensado para el staff; el socio no la resuelve). La RPC
-- filtra ella misma y solo devuelve lo publicado con stock.
--
-- Devuelve exactamente lo que espera ProductoTienda en la app:
--   { id, nombre, categoria, precio, imagen_url, descripcion }
--
-- Reglas (del handoff MARKETPLACE-TIENDA):
--   - visible_en_app = true, activo = true, deleted_at is null
--   - stock > 0 en la sede del socio (si se pasa p_sede_id); si no, en cualquier
--     sede de la empresa
--   - NO expone el stock exacto (solo aparece si hay); precio y datos de vitrina sí.

create or replace function public.catalogo_app(
  p_empresa_id uuid,
  p_sede_id    uuid default null
) returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.precio), '[]'::jsonb)
  from (
    select distinct on (p.id)
           p.id, p.nombre, p.categoria, p.precio, p.imagen_url, p.descripcion
      from public.producto p
      join public.inventario_sede i
        on i.producto_id = p.id
       and (p_sede_id is null or i.sede_id = p_sede_id)
     where p.empresa_id = p_empresa_id
       and p.visible_en_app = true
       and p.activo = true
       and p.deleted_at is null
       and i.stock > 0
       -- El socio solo ve el catálogo de un gym donde ES socio (no de cualquiera).
       and exists (
         select 1 from public.socio s
          where s.usuario_id = auth.uid()
            and s.empresa_id = p_empresa_id
            and s.deleted_at is null
       )
     order by p.id, p.precio
  ) t;
$function$;

-- El socio (authenticated) la invoca desde la app.
grant execute on function public.catalogo_app(uuid, uuid) to authenticated;

comment on function public.catalogo_app is
  'Catálogo de la tienda del socio: productos visibles_en_app con stock>0 en su sede. SECURITY DEFINER (el socio no tiene RLS para leer producto). Devuelve {id,nombre,categoria,precio,imagen_url,descripcion}. Handoff MARKETPLACE-TIENDA.';
