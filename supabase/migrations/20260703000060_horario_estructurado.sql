-- ============================================================================
-- 60 · Horario de atención estructurado
-- empresa.horario: jsonb con 7 días [{abre:'06:00',cierra:'22:00',cerrado:bool}]
-- (índice 0 = lunes). empresa.horario_atencion se mantiene como el TEXTO
-- derivado ("Lun–Vie 6:00–22:00 · Sáb 8:00–13:00 · Dom cerrado") que ya
-- consumen la página pública y los correos — el editor lo genera al guardar.
-- ============================================================================

alter table public.empresa add column if not exists horario jsonb;

comment on column public.empresa.horario is
  'Horario estructurado: array de 7 días (0=lunes) {abre, cierra, cerrado}. horario_atencion guarda el resumen en texto.';
