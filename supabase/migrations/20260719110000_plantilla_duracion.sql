-- Duración SUGERIDA del ciclo de la plantilla. Al asignarla a un socio pre-llena
-- la vigencia de su rutina (el trainer puede cambiarla). Nullable = sin sugerencia,
-- que es el comportamiento actual de todas las plantillas existentes.
alter table public.plantilla_rutina add column if not exists duracion_semanas int;
alter table public.plantilla_dieta  add column if not exists duracion_semanas int;

comment on column public.plantilla_rutina.duracion_semanas is
  'Duración sugerida en semanas (4/8/12/16). Pre-llena la vigencia al asignar; null = sin sugerencia.';
comment on column public.plantilla_dieta.duracion_semanas is
  'Duración sugerida en semanas (4/8/12/16). Pre-llena la vigencia al asignar; null = sin sugerencia.';
