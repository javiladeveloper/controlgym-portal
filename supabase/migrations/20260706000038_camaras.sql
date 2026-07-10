-- Cámaras en vivo (monitoreo CCTV) — enlace de la nube del fabricante.
--
-- El gym pega el enlace de streaming web que le da su app/nube (Hik-Connect,
-- EZVIZ, Reolink, Dahua, etc.) y FitCore lo embebe. Cero infraestructura de
-- streaming propia. Solo admin/recepción ven las cámaras; RLS por empresa.

create table if not exists public.camara (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  sede_id    uuid references public.sede(id) on delete cascade,
  nombre     text not null,                 -- "Entrada", "Sala de pesas"
  url_embed  text not null,                 -- enlace de streaming web de la nube del fabricante
  orden      int  not null default 0,
  activa     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_camara_empresa_sede on public.camara (empresa_id, sede_id);

-- Solo admin/recepción del gym gestionan y ven las cámaras (no entrenadores ni
-- socios). RLS por empresa; el rol se controla también en el panel (gating UI).
alter table public.camara enable row level security;

drop policy if exists camara_scope on public.camara;
create policy camara_scope on public.camara
  for all to authenticated
  using (empresa_id = public.auth_empresa_id()
         and (public.auth_is_admin() or public.auth_rol() = 'recepcion'))
  with check (empresa_id = public.auth_empresa_id()
              and (public.auth_is_admin() or public.auth_rol() = 'recepcion'));

comment on table public.camara is 'Cámaras CCTV del gym: enlace de streaming web de la nube del fabricante, embebido en el panel. Solo admin/recepción. Monitoreo en vivo, sin grabación.';
