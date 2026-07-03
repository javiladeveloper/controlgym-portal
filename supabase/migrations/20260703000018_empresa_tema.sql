-- ============================================================================
-- 18 · Tema / marca por empresa (white-label)
--   Fuente de verdad de los design tokens que comparten portal web y app móvil.
--   El frontend aplica estos valores como CSS variables; la app los consume vía API.
--   Los defaults reflejan la paleta base FitCore (ver src/theme/tokens.js).
-- ============================================================================

create table public.empresa_tema (
  empresa_id      uuid primary key references public.empresa(id) on delete cascade, -- TENANT (1:1)
  -- Identidad
  logo_url        text,
  nombre_marca    text,
  -- Colores base (hex). Nombres estables = contrato con portal y app.
  color_primary   text not null default '#FF6B35',   -- naranja de acción
  color_primary_hover text not null default '#F05E28',
  color_navy      text not null default '#141B2E',   -- superficie oscura / sidebar
  color_navy_soft text not null default '#1D2740',
  color_success   text not null default '#1D9E75',
  color_danger    text not null default '#E24B4A',
  color_muted     text not null default '#5B6472',
  color_faint     text not null default '#9AA3B5',
  color_line      text not null default '#E5E7EB',
  color_surface   text not null default '#F5F6F8',
  color_canvas    text not null default '#E9EBF0',
  -- Tokens adicionales libres (radios, sombras, colores por módulo, etc.)
  tokens          jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_empresa_tema_updated before update on public.empresa_tema
  for each row execute function public.set_updated_at();

comment on table public.empresa_tema is
  'Design tokens / marca por empresa (white-label). Fuente única compartida por portal web y app móvil vía API.';

-- RLS: la empresa activa ve y edita su propio tema; lectura para su gente.
alter table public.empresa_tema enable row level security;

create policy "empresa_tema_scope" on public.empresa_tema
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

-- Al crear una empresa, generar su fila de tema con los defaults.
create or replace function public.crear_tema_default()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.empresa_tema (empresa_id, nombre_marca)
  values (new.id, new.nombre)
  on conflict (empresa_id) do nothing;
  return new;
end;
$$;

create trigger trg_empresa_tema_default
  after insert on public.empresa
  for each row execute function public.crear_tema_default();
