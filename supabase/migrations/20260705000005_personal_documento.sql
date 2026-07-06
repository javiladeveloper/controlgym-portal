-- ============================================================================
-- 92 (20260705000005) · DNI del colaborador al invitar personal
--
-- Pedido del cliente: al agregar personal, pedir el DNI primero y autocompletar
-- sus datos del padrón (igual que con socios). El DNI queda guardado (útil para
-- planilla/pagos). El correo de Google sigue siendo el login.
--
-- Agrega columna documento a invitacion y usuario, y extiende
-- invitar_colaborador con p_documento (opcional, whitelist).
-- ============================================================================

alter table public.invitacion add column if not exists documento text;
alter table public.usuario    add column if not exists documento text;

-- Extender invitar_colaborador con p_documento (recompila preservando el resto)
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.invitar_colaborador(text,text,uuid,text,text,numeric)'::regprocedure);
  if position('p_documento' in v_def) > 0 then return; end if;

  -- 1) parámetro nuevo
  v_def := replace(
    v_def,
    'p_sueldo numeric DEFAULT NULL::numeric)',
    'p_sueldo numeric DEFAULT NULL::numeric, p_documento text DEFAULT NULL::text)');

  -- 2) incluir documento en el insert de la invitación
  v_def := replace(
    v_def,
    'insert into public.invitacion (empresa_id, email, rol_id, sede_id, invitado_por, nombre, telefono, sueldo_mensual)',
    'insert into public.invitacion (empresa_id, email, rol_id, sede_id, invitado_por, nombre, telefono, sueldo_mensual, documento)');
  v_def := replace(
    v_def,
    'values (v_empresa, p_email, v_rol, p_sede_id, auth.uid(), nullif(trim(p_nombre), ''''), nullif(trim(p_telefono), ''''), p_sueldo)',
    'values (v_empresa, p_email, v_rol, p_sede_id, auth.uid(), nullif(trim(p_nombre), ''''), nullif(trim(p_telefono), ''''), p_sueldo, nullif(trim(p_documento), ''''))');

  -- 3) en el upsert, refrescar documento si viene
  v_def := replace(
    v_def,
    'nombre = coalesce(excluded.nombre, invitacion.nombre),',
    'nombre = coalesce(excluded.nombre, invitacion.nombre), documento = coalesce(excluded.documento, invitacion.documento),');

  execute v_def;
end $$;

-- Al recompilar con firma nueva (7 params) queda la vieja de 6 → ambigüedad.
drop function if exists public.invitar_colaborador(text,text,uuid,text,text,numeric);
