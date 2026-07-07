-- FIX (auditoría pre-demo): el cuadre de una caja YA CERRADA se recalculaba en
-- vivo con los movimientos actuales, así que la diferencia "cuadró/faltaron"
-- podía cambiar retroactivamente al abrir/anular movimientos después del cierre.
--
-- Se congela el efectivo esperado en el momento del cierre: nueva columna
-- caja.efectivo_esperado. El frontend la escribe al cerrar y, para cajas
-- cerradas, compara saldo_final contra ESTE valor congelado, no contra un
-- recálculo en vivo.
alter table public.caja
  add column if not exists efectivo_esperado numeric(12,2);

comment on column public.caja.efectivo_esperado is
  'Efectivo esperado (saldo_inicial + ingresos-egresos en efectivo del día) congelado al cerrar la caja. Para el cuadre histórico estable.';
