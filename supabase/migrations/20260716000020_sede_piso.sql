-- Croquis multi-piso: una sede tiene varios pisos, cada uno con su plano; las
-- máquinas se ubican en un piso con coordenadas x/y (%). Aditivo: las columnas
-- de maquina son nullable, sede.croquis_url se conserva.
create table if not exists public.sede_piso (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  sede_id    uuid not null references public.sede(id) on delete cascade,
  nombre     text not null,
  orden      int not null default 0,
  plano_url  text,
  created_at timestamptz not null default now()
);
create index if not exists sede_piso_sede_idx on public.sede_piso (sede_id, orden);

alter table public.sede_piso enable row level security;
-- Staff: mismo alcance que maquina (empresa + sede propia o admin).
drop policy if exists sede_piso_staff on public.sede_piso;
create policy sede_piso_staff on public.sede_piso for all to authenticated
  using (empresa_id = public.auth_empresa_id()
         and (sede_id in (select public.auth_sede_ids()) or public.auth_is_admin()))
  with check (empresa_id = public.auth_empresa_id()
         and (sede_id in (select public.auth_sede_ids()) or public.auth_is_admin()));
-- Socio de la app: lee los pisos de su sede (patrón socio_app_sede).
drop policy if exists sede_piso_socio on public.sede_piso;
create policy sede_piso_socio on public.sede_piso for select to authenticated
  using (exists (
    select 1 from public.socio s
    where s.usuario_id = auth.uid() and s.sede_id = sede_piso.sede_id and s.deleted_at is null));

-- Ubicación de la máquina en un piso (aditivo, nullable).
alter table public.maquina add column if not exists piso_id uuid references public.sede_piso(id) on delete set null;
alter table public.maquina add column if not exists pos_x numeric;  -- % horizontal 0-100
alter table public.maquina add column if not exists pos_y numeric;  -- % vertical 0-100
