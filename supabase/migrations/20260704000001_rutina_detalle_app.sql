-- ── Detalle configurable de rutinas ─────────────────────────────────────────
-- La app móvil (FitCore) comparte estas tablas con el panel web. Campos
-- adicionales para que el entrenador configure el plan según el objetivo y
-- la realidad de cada socio. Idempotente: seguro de re-aplicar.

-- Indicaciones generales del plan (visibles para el socio en su app)
alter table public.rutina add column if not exists notas text;

-- Carga sugerida ('40kg', 'peso corporal', 'banda verde') y notas técnicas
-- por ejercicio ('bajar en 3 segundos', 'cuidar la lumbar')
alter table public.rutina_ejercicio add column if not exists carga text;
alter table public.rutina_ejercicio add column if not exists notas text;

comment on column public.rutina.notas is 'Indicaciones generales del plan para el socio.';
comment on column public.rutina_ejercicio.carga is 'Carga sugerida: 40kg, peso corporal, banda…';
comment on column public.rutina_ejercicio.notas is 'Nota técnica del entrenador para ese ejercicio.';
