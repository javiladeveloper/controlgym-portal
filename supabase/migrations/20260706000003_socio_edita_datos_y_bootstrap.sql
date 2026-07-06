-- PEDIDO 12 (app) — El socio edita sus datos desde la app (excepto DNI).
-- Dos partes:
--   1. RPC actualizar_mis_datos: el socio actualiza SU fila (nombre, telefono,
--      email, objetivo). Nunca toca documento ni estado. Valida dueño por
--      usuario_id = auth.uid().
--   2. get_mi_app_bootstrap devuelve, por socio, documento/telefono/email/
--      objetivo — hoy solo mandaba id/codigo/nombre/estado/sede_id, por eso el
--      socio veía "Sin registrar" en su Perfil y no podía prellenar el form.

-- ── Parte 1: RPC de edición del socio ─────────────────────────────────────
create or replace function public.actualizar_mis_datos(
  p_socio_id  uuid,
  p_nombre    text default null,
  p_telefono  text default null,
  p_email     text default null,
  p_objetivo  text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row socio;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  update public.socio s
     set nombre   = coalesce(nullif(btrim(p_nombre), ''), s.nombre),
         telefono = coalesce(p_telefono, s.telefono),
         email    = coalesce(p_email, s.email),
         objetivo = coalesce(p_objetivo, s.objetivo),
         updated_at = now()
   where s.id = p_socio_id
     and s.usuario_id = v_uid          -- solo el dueño de la ficha
     and s.deleted_at is null
   returning s.* into v_row;

  if v_row.id is null then
    raise exception 'No puedes editar estos datos';
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'nombre', v_row.nombre, 'telefono', v_row.telefono,
    'email', v_row.email, 'objetivo', v_row.objetivo, 'documento', v_row.documento
  );
end;
$$;

grant execute on function public.actualizar_mis_datos(uuid, text, text, text, text) to authenticated;

-- ── Parte 2: bootstrap con documento/telefono/email/objetivo ──────────────
-- Inyecta los 4 campos en el objeto 'socio' del bootstrap sin reescribir toda
-- la función (grande): toma su definición viva y reemplaza solo esa línea.
do $mig$
declare
  v_def text := pg_get_functiondef('public.get_mi_app_bootstrap()'::regprocedure);
  v_old text := $q$'socio', jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'estado', s.estado, 'sede_id', s.sede_id),$q$;
  v_new text := $q$'socio', jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'estado', s.estado, 'sede_id', s.sede_id, 'documento', s.documento, 'telefono', s.telefono, 'email', s.email, 'objetivo', s.objetivo),$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'No se encontró el bloque socio esperado en get_mi_app_bootstrap — revisar manualmente';
  end if;
  execute replace(v_def, v_old, v_new);
end
$mig$;
