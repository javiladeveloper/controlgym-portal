-- 20260704000008: Nutrición avanzada (pedido del cliente, sesión de la app)
-- NO aplicar desde la app: lo aplica la sesión del panel (protocolo HANDOFF).
--
-- 1) Suplementos recomendados: el nutricionista (o el trainer donde no hay
--    nutricionista) puede recomendar suplementos junto al plan.
-- 2) Plan alimenticio SEMANAL: una comida puede fijarse a un día concreto
--    (dia_semana 1-7). NULL = comida de todos los días (compatibilidad total
--    con los planes actuales: nada se rompe).

alter table public.dieta
  add column if not exists suplementos text;

alter table public.comida
  add column if not exists dia_semana int
  check (dia_semana is null or dia_semana between 1 and 7);

comment on column public.dieta.suplementos is
  'Suplementos recomendados por el nutricionista/trainer (texto libre: producto, dosis, momento).';
comment on column public.comida.dia_semana is
  '1=lunes…7=domingo; NULL = la comida aplica todos los días (plan diario clásico).';
