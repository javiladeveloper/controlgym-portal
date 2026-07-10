-- Facturación NORAC: cola de comprobantes + soporte de cifrado y agrupación de venta.
create extension if not exists pgcrypto;

-- Clave global para cifrar las API keys de NORAC por gym (pgp_sym_encrypt).
-- Si no existe, se inserta una aleatoria (el owner puede rotarla luego).
insert into privado.secreto (clave, valor)
values ('fact_cipher_key', encode(gen_random_bytes(32), 'hex'))
on conflict (clave) do nothing;

-- Config extra: correlativo inicial opcional (para gyms que continúan numeración).
alter table public.empresa_facturacion
  add column if not exists correlativo_inicial int;

-- Agrupa los ítems de un mismo cobro (carrito) para armar UN comprobante multi-línea.
alter table public.movimiento_financiero
  add column if not exists venta_id uuid;
create index if not exists idx_movfin_venta on public.movimiento_financiero(venta_id) where venta_id is not null;

-- Cola de comprobantes para los 3 canales (producto, membresia, pago_app).
create table if not exists public.comprobante (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  origen text not null check (origen in ('producto','membresia','pago_app')),
  ref_tipo text not null,           -- 'venta' | 'membresia' | 'pago_app'
  ref_id uuid not null,             -- venta_id / membresia_id / pago_app_id
  tipo text not null default '03' check (tipo in ('03','01')),
  cliente_tipo_doc text not null default '0' check (cliente_tipo_doc in ('0','1','6')),
  cliente_num_doc text,
  cliente_nombre text not null default 'CLIENTE VARIOS',
  cliente_email text,
  moneda text not null default 'PEN',
  base numeric(12,2),
  igv numeric(12,2),
  total numeric(12,2) not null check (total > 0),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','emitido','observado','anulado','error')),
  norac_id bigint,
  serie_numero text,
  response_code text,
  error_msg text,
  intentos int not null default 0,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
-- Idempotencia: un solo comprobante vivo por (ref_tipo, ref_id).
create unique index if not exists uq_comprobante_ref
  on public.comprobante(ref_tipo, ref_id) where estado <> 'anulado';
create index if not exists idx_comprobante_pendiente
  on public.comprobante(estado) where estado = 'pendiente';
create index if not exists idx_comprobante_empresa on public.comprobante(empresa_id);

alter table public.comprobante enable row level security;
-- Lectura para el panel (admin/recepción de la empresa). Escritura solo backend/RPC.
create policy comprobante_select on public.comprobante for select to authenticated
  using (empresa_id = public.auth_empresa_id());

comment on table public.comprobante is
  'Cola de comprobantes electrónicos (NORAC). Un comprobante por venta/membresía/pago. Emisión asíncrona vía api/facturacion/emitir.js.';
