-- PEDIDO 23: catalogo_app ahora expone el precio con oferta aplicada.
--
-- MISMA firma y MISMA lógica de filtros/seguridad que 20260706000028; solo se
-- agregan 3 campos al jsonb: precio_final (precio efectivo, server-side),
-- descuento_tipo y descuento_valor (para que la app pueda mostrar el "antes/
-- ahora" si quiere). La app NUNCA decide el monto: precio_final ya viene
-- calculado desde el backend.
--
-- Devuelve lo que espera ProductoTienda en la app, más los 3 campos nuevos:
--   { id, nombre, categoria, precio, imagen_url, descripcion,
--     precio_final, descuento_tipo, descuento_valor }

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
           p.id, p.nombre, p.categoria, p.precio, p.imagen_url, p.descripcion,
           p.descuento_tipo, p.descuento_valor,
           case when p.descuento_tipo = 'porcentaje' and coalesce(p.descuento_valor, 0) > 0
                  then round(p.precio * (1 - p.descuento_valor / 100), 2)
                when p.descuento_tipo = 'monto' and coalesce(p.descuento_valor, 0) > 0
                  then greatest(0, round(p.precio - p.descuento_valor, 2))
                else p.precio
           end as precio_final
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
  'Catálogo de la tienda del socio: productos visibles_en_app con stock>0 en su sede. SECURITY DEFINER (el socio no tiene RLS para leer producto). Devuelve {id,nombre,categoria,precio,imagen_url,descripcion,precio_final,descuento_tipo,descuento_valor}. precio_final ya trae la oferta aplicada (server-side). Handoff MARKETPLACE-TIENDA + PEDIDO 23.';
