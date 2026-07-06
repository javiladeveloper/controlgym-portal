-- ============================================================================
-- 89 (20260705000002) · usa_carnet_qr en el bootstrap del socio (PEDIDO 10 app)
--
-- La app pidió (PEDIDO 10) un flag por gym para ocultar el carnet QR/control
-- de acceso donde el gimnasio no lo usa. La columna empresa.usa_carnet_qr ya
-- existe (mig 20260704000020, del app agent). Aquí la exponemos en
-- get_mi_app_bootstrap para que la app la reciba en un solo viaje.
--
-- Se inyecta el campo en el objeto 'empresa' sin reescribir toda la función
-- (preserva el resto del cuerpo, que es grande y cambia).
-- ============================================================================

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.get_mi_app_bootstrap()'::regprocedure);
  if position('usa_carnet_qr' in v_def) = 0 then
    v_def := replace(
      v_def,
      E'''horario_atencion'', e.horario_atencion, ''redes'', e.redes, ''moneda'', e.moneda)',
      E'''horario_atencion'', e.horario_atencion, ''redes'', e.redes, ''moneda'', e.moneda, ''usa_carnet_qr'', e.usa_carnet_qr)');
    execute v_def;
  end if;
end $$;
