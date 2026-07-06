-- Checkout PÚBLICO de planes (fitcorecenter.com/planes) — requisito de Culqi:
-- una página pública con >=5 servicios (foto+desc+precio) y un botón de pago
-- que el revisor pueda probar SIN registrarse. Este flujo hace un CARGO ÚNICO
-- del primer mes (no la suscripción recurrente, que vive en el panel tras el
-- trial). Guardamos cada intento para darle seguimiento comercial: quien paga
-- por aquí luego recibe el alta de su cuenta.
create table if not exists public.pago_publico (
  id            uuid primary key default gen_random_uuid(),
  plan_slug     text not null,
  con_app       boolean not null default false,
  monto         numeric(12,2) not null,
  moneda        text not null default 'PEN',
  email         text,
  nombre        text,
  telefono      text,
  nombre_gym    text,
  estado        text not null default 'pendiente'
                  check (estado in ('pendiente','pagado','fallido')),
  proveedor     text not null default 'culqi',
  cargo_id      text,                 -- id del charge en Culqi
  error         text,
  empresa_id    uuid references public.empresa(id), -- se llena si luego se crea la cuenta
  created_at    timestamptz not null default now(),
  pagado_at     timestamptz
);

comment on table public.pago_publico is
  'Cargos únicos desde el checkout público /planes (sin cuenta previa). Culqi lo revisa; comercial da seguimiento al alta.';

-- Solo el backend (service_role/postgres) escribe aquí; nadie más lo lee por API.
alter table public.pago_publico enable row level security;
-- Sin policies = nadie con anon/authenticated ve ni escribe; el endpoint usa
-- la conexión postgres directa (no pasa por RLS), como el resto de /api.
