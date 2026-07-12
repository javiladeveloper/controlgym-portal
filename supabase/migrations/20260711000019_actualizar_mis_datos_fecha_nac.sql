-- Agrega fecha_nacimiento a actualizar_mis_datos (el socio la edita desde la app,
-- para el cron de cumpleaños). Param opcional al final: no rompe llamadas viejas.
-- Aplicado en prod vía MCP.
CREATE OR REPLACE FUNCTION public.actualizar_mis_datos(
  p_socio_id uuid, p_nombre text DEFAULT NULL, p_telefono text DEFAULT NULL,
  p_email text DEFAULT NULL, p_objetivo text DEFAULT NULL,
  p_fecha_nacimiento date DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_row socio;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  update public.socio s
     set nombre = coalesce(nullif(btrim(p_nombre), ''), s.nombre),
         telefono = coalesce(p_telefono, s.telefono),
         email = coalesce(p_email, s.email),
         objetivo = coalesce(p_objetivo, s.objetivo),
         fecha_nacimiento = coalesce(p_fecha_nacimiento, s.fecha_nacimiento),
         updated_at = now()
   where s.id = p_socio_id and s.usuario_id = v_uid and s.deleted_at is null
   returning s.* into v_row;
  if v_row.id is null then raise exception 'No puedes editar estos datos'; end if;
  return jsonb_build_object('id', v_row.id, 'nombre', v_row.nombre, 'telefono', v_row.telefono,
    'email', v_row.email, 'objetivo', v_row.objetivo, 'documento', v_row.documento,
    'fecha_nacimiento', v_row.fecha_nacimiento);
end; $function$;
