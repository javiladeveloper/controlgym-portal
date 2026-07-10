-- Idea Image Gym #4b: catalogo_app expone tambien 'beneficio' del producto.

CREATE OR REPLACE FUNCTION public.catalogo_app(p_empresa_id uuid, p_sede_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.precio), '[]'::jsonb)
  from (
    select distinct on (p.id)
           p.id, p.nombre, p.categoria, p.precio, p.imagen_url, p.descripcion, p.beneficio,
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
