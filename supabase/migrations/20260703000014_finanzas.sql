-- ============================================================================
-- 14 · Finanzas: caja diaria y movimientos financieros
-- ============================================================================

create table public.caja (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  sede_id       uuid not null references public.sede(id) on delete cascade,
  fecha         date not null default current_date,
  saldo_inicial numeric(12,2) not null default 0,
  saldo_final   numeric(12,2),
  estado        text not null default 'abierta' check (estado in ('abierta','cerrada')),
  abierta_por   uuid references public.usuario(id),
  cerrada_por   uuid references public.usuario(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (sede_id, fecha)
);
create trigger trg_caja_updated before update on public.caja
  for each row execute function public.set_updated_at();
create index idx_caja_empresa_sede on public.caja(empresa_id, sede_id);

create table public.movimiento_financiero (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa(id) on delete cascade,        -- TENANT
  sede_id     uuid not null references public.sede(id),
  caja_id     uuid references public.caja(id),
  tipo        text not null check (tipo in ('ingreso','gasto')),
  categoria   text,                                -- 'membresia','venta_kardex','mantenimiento','compra','planilla'
  descripcion text,
  monto       numeric(12,2) not null,
  fecha       timestamptz not null default now(),
  -- Referencia polimórfica al origen (membresia / movimiento_inventario / mantenimiento)
  ref_tipo    text,
  ref_id      uuid,
  registrado_por uuid references public.usuario(id),
  created_at  timestamptz not null default now()
);
create index idx_mov_fin_empresa_sede on public.movimiento_financiero(empresa_id, sede_id);
create index idx_mov_fin_fecha on public.movimiento_financiero(empresa_id, fecha);
create index idx_mov_fin_ref on public.movimiento_financiero(ref_tipo, ref_id);

comment on table public.movimiento_financiero is
  'Ingreso/gasto. ref_tipo+ref_id apuntan al origen (membresía, venta de kardex, mantenimiento, etc.).';
