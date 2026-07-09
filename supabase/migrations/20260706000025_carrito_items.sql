-- Carrito de compras: una orden (pago_app tipo='producto') puede llevar VARIOS
-- productos con cantidades, pagados en UNA sola transacción de MercadoPago.
--
-- Antes: 1 producto = 1 pago (pago_app.ref_id = el producto, monto = su precio).
-- Ahora: la orden puede tener N líneas → tabla pago_app_item. Para compras de un
-- solo producto seguimos pudiendo usar ref_id (compatibilidad), pero el carrito
-- usa los items. La orden se entrega/cancela COMPLETA.

create table if not exists public.pago_app_item (
  id           uuid primary key default gen_random_uuid(),
  pago_id      uuid not null references public.pago_app(id) on delete cascade,
  producto_id  uuid not null references public.producto(id),
  cantidad     integer not null check (cantidad > 0),
  precio_unit  numeric(12,2) not null,   -- precio al momento de la compra (congela el precio)
  subtotal     numeric(12,2) not null,   -- precio_unit * cantidad
  created_at   timestamptz not null default now()
);

create index if not exists idx_pago_app_item_pago on public.pago_app_item (pago_id);

-- RLS: hereda el aislamiento de pago_app (el item pertenece a una orden de la
-- empresa). El backend (endpoint/RPC SECURITY DEFINER) lo maneja; para lecturas
-- del panel, permitimos ver items de órdenes de la empresa activa.
alter table public.pago_app_item enable row level security;

drop policy if exists pago_app_item_scope on public.pago_app_item;
create policy pago_app_item_scope on public.pago_app_item
  for select to authenticated
  using (exists (
    select 1 from public.pago_app p
     where p.id = pago_app_item.pago_id and p.empresa_id = public.auth_empresa_id()
  ));

comment on table public.pago_app_item is
  'Líneas de una orden de productos comprada por app (carrito). Una orden (pago_app) tiene N items. Se entrega/cancela completa.';
