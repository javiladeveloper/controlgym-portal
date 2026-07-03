-- ============================================================================
-- 12 · Kardex: productos, stock por sede y movimientos de inventario
-- ============================================================================

create table public.producto (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  nombre        text not null,
  categoria     text,                              -- 'Suplementos','Bebidas','Accesorios'
  precio        numeric(12,2) not null default 0,
  stock_minimo  int not null default 0,            -- umbral de "stock bajo"
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create trigger trg_producto_updated before update on public.producto
  for each row execute function public.set_updated_at();
create index idx_producto_empresa on public.producto(empresa_id);

-- Stock por sede
create table public.inventario_sede (
  empresa_id  uuid not null references public.empresa(id) on delete cascade,        -- TENANT
  sede_id     uuid not null references public.sede(id) on delete cascade,
  producto_id uuid not null references public.producto(id) on delete cascade,
  stock       int not null default 0,
  primary key (sede_id, producto_id)
);
create index idx_inventario_empresa on public.inventario_sede(empresa_id);

-- Movimientos (venta/compra/ajuste)
create table public.movimiento_inventario (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  sede_id       uuid not null references public.sede(id),
  producto_id   uuid not null references public.producto(id),
  tipo          text not null check (tipo in ('venta','compra','ajuste')),
  cantidad      int not null,                      -- signo lo define el tipo en la lógica
  monto         numeric(12,2),                     -- impacto en caja (+venta / -compra)
  fecha         timestamptz not null default now(),
  registrado_por uuid references public.usuario(id),
  created_at    timestamptz not null default now()
);
create index idx_mov_inv_empresa_sede on public.movimiento_inventario(empresa_id, sede_id);
create index idx_mov_inv_producto on public.movimiento_inventario(producto_id);
