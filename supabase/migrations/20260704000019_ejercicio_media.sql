-- Media de ejecución correcta por ejercicio del catálogo (para la app).
-- La tabla `ejercicio` ya tiene `descripcion` y `video_url`; falta la
-- foto/thumbnail. El socio ve esto al abrir un ejercicio de su rutina
-- (rutina_ejercicio.ejercicio_id → ejercicio), reutilizable en todas las
-- rutinas que usen ese ejercicio. Idempotente.

alter table public.ejercicio
  add column if not exists foto_url text;

comment on column public.ejercicio.descripcion is
  'Instrucciones de ejecución correcta del ejercicio (texto, lo edita el panel).';
comment on column public.ejercicio.video_url is
  'Video corto (5-10s) de la técnica correcta. Genérico o subido por el gym.';
comment on column public.ejercicio.foto_url is
  'Foto/thumbnail de la ejecución correcta (fallback si no hay video).';
