-- FIX CRÍTICO — La UI oculta el pago de sueldos/edición de salarios a los no-admin
-- (rol === 'admin'), pero la RLS solo validaba empresa_id: cualquier empleado
-- logueado podía, vía llamada directa a la API, registrar pagos de planilla
-- falsos o editarse su propio sueldo. La seguridad de dinero debe vivir en la BD.
--
-- Este fix agrega gating por rol EN LA RLS para las dos operaciones sensibles:
--   1) INSERT/UPDATE/DELETE de movimiento_financiero con categoria='planilla'
--      (pagos de sueldo) → solo admin.
--   2) UPDATE de usuario_empresa que cambie sueldo_mensual/tarifa_clase → solo admin.
--
-- El resto (ingresos de membresías/ventas por recepción, etc.) NO se toca.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) movimiento_financiero: la escritura de PLANILLA requiere admin.
--
-- La policy existente `movimiento_financiero_scope` (ALL) permite a recepción
-- registrar ingresos/gastos normales. La dejamos, pero añadimos una policy
-- RESTRICTIVE que, específicamente para filas de planilla, exige admin. Una
-- policy RESTRICTIVE se AÑADE con AND a las permissive: la fila debe pasar
-- ambas. Como solo aplica a categoria='planilla', no afecta al resto.
drop policy if exists mf_planilla_solo_admin on public.movimiento_financiero;
create policy mf_planilla_solo_admin on public.movimiento_financiero
  as restrictive
  for all
  to authenticated
  using (
    -- Para LEER/borrar: si la fila es planilla, exige admin; si no, pasa.
    categoria is distinct from 'planilla' or public.auth_is_admin()
  )
  with check (
    -- Para INSERTAR/actualizar: idem — una fila de planilla solo la escribe admin.
    categoria is distinct from 'planilla' or public.auth_is_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) usuario_empresa: editar sueldo/tarifa requiere admin.
--
-- La policy `usuario_empresa_tenant` (ALL, solo empresa_id) permite que un
-- colaborador actualice su propia fila (p. ej. datos suyos). Pero NO debe poder
-- cambiar su sueldo_mensual/tarifa_clase. Añadimos una RESTRICTIVE para UPDATE:
-- si cambian los campos salariales, exige admin.
--
-- Nota: comparar OLD vs NEW en RLS no es directo; usamos un trigger para el
-- caso "cambió el salario" (más preciso que RLS, que no ve el valor anterior).
create or replace function public.guard_salario_solo_admin()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Si se intenta cambiar el sueldo o la tarifa y quien lo hace NO es admin → bloquear.
  if (new.sueldo_mensual is distinct from old.sueldo_mensual
      or new.tarifa_clase is distinct from old.tarifa_clase)
     and not public.auth_is_admin() then
    raise exception 'Solo el administrador puede cambiar sueldos o tarifas';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_salario on public.usuario_empresa;
create trigger trg_guard_salario
  before update on public.usuario_empresa
  for each row execute function public.guard_salario_solo_admin();

comment on function public.guard_salario_solo_admin is
  'Bloquea que un no-admin cambie sueldo_mensual/tarifa_clase de usuario_empresa. La RLS solo valida empresa_id; esto añade el gating de rol para los campos salariales. FIX planilla.';
