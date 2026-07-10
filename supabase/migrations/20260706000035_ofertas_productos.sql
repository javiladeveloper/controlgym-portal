-- PEDIDO 23: ofertas/descuentos permanentes en productos de la tienda.
--
-- Agrega a `producto` las columnas para configurar una oferta permanente:
--   descuento_tipo:  'porcentaje' | 'monto' | null (sin oferta)
--   descuento_valor: 15 (=15%) o 20 (=S/20), según el tipo
--
-- En oferta = descuento_tipo in ('porcentaje','monto') AND descuento_valor > 0.
-- Precio efectivo:
--   porcentaje: round(precio * (1 - valor/100), 2)
--   monto:      greatest(0, round(precio - valor, 2))
--
-- El cálculo del precio con descuento SIEMPRE se hace server-side (RPC
-- catalogo_app y api/mp/crear-pago.js); la app nunca decide el monto.

alter table public.producto
  add column if not exists descuento_tipo  text,      -- 'porcentaje' | 'monto' | null
  add column if not exists descuento_valor numeric;    -- 15 (=15%) o 20 (=S/20)

-- Guard de valores validos
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'producto_descuento_tipo_check') then
    alter table public.producto add constraint producto_descuento_tipo_check
      check (descuento_tipo is null or descuento_tipo in ('porcentaje', 'monto'));
  end if;
end $$;

comment on column public.producto.descuento_tipo is 'Oferta permanente: porcentaje | monto | null (sin oferta).';
comment on column public.producto.descuento_valor is 'Valor del descuento: 15 (=15% si tipo=porcentaje) o 20 (=S/20 si tipo=monto).';
