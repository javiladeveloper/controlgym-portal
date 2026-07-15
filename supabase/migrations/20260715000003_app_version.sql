-- Última versión disponible de la app (para el popup "nueva versión" que muestra
-- la app). Antes vivía en la env var APP_ANDROID_LATEST de Vercel, pero esa solo
-- se refresca al REDESPLEGAR el panel, así que el popup quedaba congelado. Ahora
-- vive aquí (dinámico, sin redeploy): el CI de la app hace UPDATE al subir un AAB,
-- y /api/app/version (og.js) lee de esta tabla.
create table if not exists public.app_version (
  plataforma   text primary key check (plataforma in ('android', 'ios')),
  version_code int not null default 0,
  version_name text,
  actualizado_at timestamptz not null default now()
);

-- Semilla: el versionCode actual publicado. AJUSTAR al real de Play si difiere.
-- (35 era el valor viejo congelado en Vercel; los releases 0.5.7→0.6.2 subieron
--  el versionCode muy por encima — el CI lo corrige en el próximo build.)
insert into public.app_version (plataforma, version_code, version_name)
values ('android', 35, '0.5.6'), ('ios', 0, null)
on conflict (plataforma) do nothing;

-- Solo lectura pública vía el endpoint serverless (que usa DATABASE_URL directo,
-- no PostgREST). Bloqueamos el acceso anon/authenticated por PostgREST: esta
-- tabla no debe leerse ni escribirse desde el cliente.
alter table public.app_version enable row level security;
-- Sin políticas = deny-all para anon/authenticated (el endpoint usa postgres).

-- El CI de la app la actualiza así (desde GitHub Actions, con DATABASE_URL):
--   update public.app_version
--     set version_code = <VC>, version_name = '<nombre>', actualizado_at = now()
--     where plataforma = 'android';
