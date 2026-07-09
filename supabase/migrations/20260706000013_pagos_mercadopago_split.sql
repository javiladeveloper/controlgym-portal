-- PEDIDO 15 (app) — Pagos in-app con MercadoPago Marketplace/Split (Fase 1).
-- NUEVA línea de negocio: el socio paga su membresía/producto desde la app y
-- MercadoPago divide el monto: 97% al gym, 3% a FitCore (marketplace_fee).
-- Distinto y coexistente con Culqi (Culqi = el gym paga el SaaS a FitCore).
--
-- Esta migración deja SOLO el modelo de datos (no necesita credenciales de MP).
-- Los endpoints api/mp/ y el registro en MercadoPago van después.
-- Detalle técnico completo: controlgym-app/docs/PAGOS-FASE1-ONBOARDING-SPLIT.md

-- ── 1. Conexión MercadoPago de cada gym (OAuth marketplace) ───────────────
-- El access_token del gym es SENSIBLE: RLS impide toda lectura desde el
-- cliente (sin policy de select para authenticated). Solo el backend, con la
-- conexión postgres directa (service role), lo lee. Nunca llega al frontend.
create table if not exists public.empresa_mp (
  empresa_id        uuid primary key references public.empresa(id) on delete cascade,
  mp_user_id        text not null,              -- collector_id del gym en MP
  access_token      text not null,              -- token del gym (solo backend)
  refresh_token     text,
  token_expira_at   timestamptz,
  scope             text,
  conectado_at      timestamptz not null default now(),
  actualizado_at    timestamptz not null default now()
);
comment on table public.empresa_mp is
  'Cuenta MercadoPago conectada por gym (OAuth) para cobrar membresías/productos con split. access_token sensible: solo backend.';

-- ── 2. Pagos hechos por socios desde la app (membresía o producto) ────────
create table if not exists public.pago_app (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresa(id) on delete cascade,   -- TENANT
  sede_id           uuid references public.sede(id),
  socio_id          uuid references public.socio(id),        -- null si socio nuevo (aún pendiente)
  tipo              text not null check (tipo in ('membresia','producto')),
  concepto          text not null,                            -- 'Plan Premium' / 'Proteína Whey 1kg'
  ref_id            uuid,                                     -- membresia_id o producto_id
  monto             numeric(12,2) not null,
  comision_fitcore  numeric(12,2) not null default 0,         -- el 3%
  moneda            text not null default 'PEN',
  -- Datos del socio NUEVO que aún no está en la BD del gym (recorrido mapa):
  nuevo_nombre      text,
  nuevo_documento   text,
  nuevo_email       text,
  nuevo_telefono    text,
  fecha_inicio      date,                                     -- desde cuándo empieza
  -- Estado del pago y de la activación:
  estado_pago       text not null default 'pendiente'
                    check (estado_pago in ('pendiente','aprobado','rechazado','reembolsado')),
  estado_activacion text not null default 'no_aplica'
                    check (estado_activacion in ('no_aplica','pendiente_activacion','activado')),
  mp_payment_id     text,
  mp_preference_id  text,
  comprobante_url   text,                                     -- boleta/factura (SEE del gym)
  creado_at         timestamptz not null default now(),
  pagado_at         timestamptz,
  activado_at       timestamptz,
  activado_por      uuid references public.usuario(id)
);
create index if not exists idx_pago_app_empresa on public.pago_app(empresa_id);
create index if not exists idx_pago_app_estado on public.pago_app(empresa_id, estado_activacion);
comment on table public.pago_app is
  'Pago hecho por un socio desde la app (split MercadoPago). Socio nuevo → pendiente_activacion para que el gym lo dé de alta.';

-- ── 3. Flag para publicar un producto del kardex en la app (Fase 2) ───────
alter table public.producto
  add column if not exists visible_en_app boolean not null default false;

-- ── 4. RLS ────────────────────────────────────────────────────────────────
alter table public.empresa_mp enable row level security;
alter table public.pago_app enable row level security;

-- empresa_mp: SIN policy de select para el cliente (el token no se expone).
-- El staff admin puede saber SI está conectado (columnas no sensibles) — para
-- eso una vista aparte más adelante; por ahora, cero acceso desde el cliente.
-- El backend lee/escribe con la conexión postgres directa (no pasa por RLS).

-- pago_app:
--  · staff del gym ve/gestiona los pagos de SU empresa (para "Pagos por activar")
create policy pago_app_staff on public.pago_app
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

--  · el socio ve SUS propios pagos (por su vínculo usuario→socio)
create policy pago_app_socio_sel on public.pago_app
  for select to authenticated
  using (exists (
    select 1 from public.socio s
    where s.id = pago_app.socio_id and s.usuario_id = auth.uid() and s.deleted_at is null
  ));
