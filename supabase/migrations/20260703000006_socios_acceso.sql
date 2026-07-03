-- ============================================================================
-- 06 · Socios, apoderados (niños) y control de acceso físico (torniquetes)
--   · socio            : miembro del gimnasio (puede ser menor)
--   · apoderado        : padre/tutor (cuenta opcional para app + supervisión)
--   · apoderado_socio  : relación N:N padre ↔ hijos
--   · socio_medida     : histórico de mediciones (progreso)
--   · dispositivo_acceso: torniquetes / lectores por sede (huella/tarjeta/facial/táctil)
--   · credencial_acceso : credenciales del socio para abrir el torniquete
--   · checkin          : registro de entrada/salida (manual, app o dispositivo)
-- ============================================================================

-- ── Socio ───────────────────────────────────────────────────────────────────
create table public.socio (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresa(id) on delete cascade,   -- TENANT
  sede_id          uuid not null references public.sede(id),                        -- sede de origen
  usuario_id       uuid references public.usuario(id),                              -- login app (opcional)
  codigo           text not null,                    -- 'N.º de socio' (0482)
  nombre           text not null,
  documento        text,
  fecha_nacimiento date,
  telefono         text,
  email            citext,
  objetivo         text,
  talla_m          numeric(4,2),
  peso_kg          numeric(5,2),
  estado           text not null default 'activo' check (estado in ('activo','inactivo','moroso','suspendido')),
  es_menor         boolean not null default false,   -- gyms de niños
  extra            jsonb not null default '{}',       -- campos libres por tipo de gym
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.usuario(id),
  deleted_at       timestamptz,
  unique (empresa_id, codigo)
);

create trigger trg_socio_updated before update on public.socio
  for each row execute function public.set_updated_at();

create index idx_socio_empresa on public.socio(empresa_id);
create index idx_socio_empresa_sede on public.socio(empresa_id, sede_id);
create index idx_socio_usuario on public.socio(usuario_id);

comment on table public.socio is 'Miembro del gimnasio. Atado a su sede de origen; puede acceder a otras si su plan es multisede.';

-- ── Apoderado (padre/tutor) ─────────────────────────────────────────────────
create table public.apoderado (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa(id) on delete cascade,        -- TENANT
  usuario_id  uuid references public.usuario(id),      -- cuenta para la app (opcional; futuro: supervisión por cámaras)
  nombre      text not null,
  documento   text,
  telefono    text,
  email       citext,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger trg_apoderado_updated before update on public.apoderado
  for each row execute function public.set_updated_at();

create index idx_apoderado_empresa on public.apoderado(empresa_id);
create index idx_apoderado_usuario on public.apoderado(usuario_id);

comment on table public.apoderado is
  'Padre/tutor de socios menores. usuario_id opcional para login de la app (supervisión de hijos por cámaras — futuro).';

-- ── Relación padre ↔ hijos ──────────────────────────────────────────────────
create table public.apoderado_socio (
  apoderado_id           uuid not null references public.apoderado(id) on delete cascade,
  socio_id               uuid not null references public.socio(id) on delete cascade,
  empresa_id             uuid not null references public.empresa(id) on delete cascade,  -- TENANT
  parentesco             text,                     -- 'madre','padre','tutor'
  autorizado_recogida    boolean not null default true,
  es_contacto_emergencia boolean not null default false,
  primary key (apoderado_id, socio_id)
);

create index idx_apoderado_socio_socio on public.apoderado_socio(socio_id);
create index idx_apoderado_socio_empresa on public.apoderado_socio(empresa_id);

comment on table public.apoderado_socio is 'Relación N:N apoderado↔socio con autorización de recogida (control de menores).';

-- ── Histórico de mediciones ─────────────────────────────────────────────────
create table public.socio_medida (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,         -- TENANT
  socio_id   uuid not null references public.socio(id) on delete cascade,
  fecha      date not null default current_date,
  peso_kg    numeric(5,2),
  talla_m    numeric(4,2),
  grasa_pct  numeric(4,1),
  cintura_cm numeric(5,1),
  notas      text,
  created_at timestamptz not null default now()
);

create index idx_socio_medida_socio on public.socio_medida(socio_id);
create index idx_socio_medida_empresa on public.socio_medida(empresa_id);

-- ── Dispositivos de acceso (torniquetes / lectores) ─────────────────────────
create table public.dispositivo_acceso (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  sede_id       uuid not null references public.sede(id) on delete cascade,
  nombre        text not null,                     -- 'Torniquete principal'
  tipo          text not null check (tipo in ('huella','tarjeta','facial','tactil','qr','manual')),
  identificador text,                              -- id físico / serial / IP del equipo
  direccion     text not null default 'entrada' check (direccion in ('entrada','salida','ambos')),
  activo        boolean not null default true,
  ultimo_latido timestamptz,                       -- heartbeat del equipo
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_dispositivo_updated before update on public.dispositivo_acceso
  for each row execute function public.set_updated_at();

create index idx_dispositivo_empresa_sede on public.dispositivo_acceso(empresa_id, sede_id);

comment on table public.dispositivo_acceso is
  'Torniquete peatonal o lector de acceso (huella/tarjeta/facial/táctil/QR) instalado en una sede.';

-- ── Credenciales de acceso del socio ────────────────────────────────────────
-- No se guarda biometría cruda: solo identificadores/tokens con los que el
-- equipo verifica (template-id de huella, nº de tarjeta/RFID, token facial, PIN hash).
create table public.credencial_acceso (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresa(id) on delete cascade,        -- TENANT
  socio_id    uuid not null references public.socio(id) on delete cascade,
  tipo        text not null check (tipo in ('huella','tarjeta','facial','pin','qr')),
  valor       text not null,                       -- template-id / nº tarjeta / token / hash de PIN
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (empresa_id, tipo, valor)
);

create index idx_credencial_socio on public.credencial_acceso(socio_id);

comment on table public.credencial_acceso is
  'Credencial con la que un socio abre un torniquete. Guarda identificadores/tokens, NO biometría cruda.';

-- ── Check-in (entrada/salida) ───────────────────────────────────────────────
create table public.checkin (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresa(id) on delete cascade,      -- TENANT
  sede_id       uuid not null references public.sede(id),   -- sede física (puede ≠ sede origen si multisede)
  socio_id      uuid references public.socio(id),           -- null si acceso denegado a desconocido
  dispositivo_id uuid references public.dispositivo_acceso(id),
  direccion     text not null default 'entrada' check (direccion in ('entrada','salida')),
  metodo        text not null default 'manual' check (metodo in ('huella','tarjeta','facial','tactil','qr','app','manual')),
  resultado     text not null default 'permitido' check (resultado in ('permitido','denegado')),
  motivo        text,                              -- 'membresia_vencida','sede_no_permitida','menor_sin_apoderado'...
  ocurrido_en   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index idx_checkin_empresa_sede on public.checkin(empresa_id, sede_id);
create index idx_checkin_socio on public.checkin(socio_id);
create index idx_checkin_ocurrido on public.checkin(ocurrido_en desc);

comment on table public.checkin is
  'Registro de acceso (entrada/salida). Alimentado por torniquetes/lectores, la app o recepción manual.';
