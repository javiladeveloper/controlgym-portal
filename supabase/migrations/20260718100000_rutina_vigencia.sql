-- Vigencia e historial de la rutina del socio. Todo nullable: las rutinas
-- viejas sin vigencia NUNCA aparecen en "por vencer" (el filtro exige
-- vigencia_fin not null). No hay backfill: sería inventar fechas no pactadas.
alter table public.rutina
  add column if not exists vigencia_inicio date,
  add column if not exists vigencia_fin date,
  add column if not exists duracion_semanas int,
  add column if not exists rutina_anterior_id uuid references public.rutina(id) on delete set null,
  add column if not exists objetivo_id uuid references public.objetivo_entrenamiento(id),
  add column if not exists aviso_vencimiento_enviado_at timestamptz;

create index if not exists rutina_vigencia_idx on public.rutina (vigencia_fin)
  where vigencia_fin is not null and activa;
create index if not exists rutina_anterior_idx on public.rutina (rutina_anterior_id)
  where rutina_anterior_id is not null;

comment on column public.rutina.vigencia_fin is
  'Fecha de vencimiento de la rutina. NO corta acceso: la rutina sigue activa y visible; solo aparece en "por vencer" y dispara aviso al trainer.';
