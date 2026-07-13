-- Auditoría (advisors de rendimiento): índices para las FKs de las tablas
-- CALIENTES — las que las pantallas y RPCs golpean todo el día. Los 50+ FKs
-- fríos restantes (catálogos, tablas chicas) quedan documentados como backlog.

create index if not exists idx_lead_asignado_a on public.lead (asignado_a);          -- reparto/rotación cuentan carga por asesor
create index if not exists idx_lead_sede on public.lead (sede_id);                    -- pipeline del CRM filtra por sede
create index if not exists idx_lead_socio on public.lead (socio_id);                  -- badge "Socio ✓" / cierres de convertidos
create index if not exists idx_lead_tarea_asignado on public.lead_tarea (asignado_a); -- agenda del comunicador
create index if not exists idx_membresia_promocion on public.membresia (promocion_id);-- cohortes + beneficio de renovación
create index if not exists idx_membresia_plan on public.membresia (plan_id);
create index if not exists idx_membresia_sede on public.membresia (sede_id);
create index if not exists idx_mov_fin_sede_fecha on public.movimiento_financiero (sede_id, fecha desc); -- Finanzas por rango
create index if not exists idx_mov_fin_caja on public.movimiento_financiero (caja_id);
create index if not exists idx_checkin_sede_ocurrido on public.checkin (sede_id, ocurrido_en desc); -- aforo/EN VIVO/reportes
create index if not exists idx_turno_staff_sede on public.turno_staff (sede_id);
