-- El renombre Cadena->Pro nunca actualizo el CHECK de suscripcion_plataforma:
-- 'pro' no era un slug valido. Se re-crea incluyendo TODOS los slugs vigentes.
alter table public.suscripcion_plataforma drop constraint if exists suscripcion_plataforma_plan_slug_check;
alter table public.suscripcion_plataforma add constraint suscripcion_plataforma_plan_slug_check
  check (plan_slug in ('estudio','crecimiento','pro','cadena','academia','ninos','trainer'));
