-- El trainer pide al socio (por push) que complete lo que falta para generar su
-- plan: objetivo y/o peso-talla. Mensaje según lo que falte. Solo staff del gym.
-- Aplicado en prod vía MCP.
CREATE OR REPLACE FUNCTION public.pedir_datos_para_plan(p_socio_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_socio public.socio; v_falta_objetivo boolean; v_falta_medidas boolean;
  v_cuerpo text; v_faltantes text[] := '{}';
begin
  select * into v_socio from public.socio where id = p_socio_id and deleted_at is null;
  if v_socio.id is null then return jsonb_build_object('ok', false, 'motivo', 'socio_inexistente'); end if;
  if public.auth_empresa_id() is distinct from v_socio.empresa_id then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  v_falta_objetivo := v_socio.objetivo_id is null;
  v_falta_medidas := coalesce(v_socio.peso_kg,0) <= 0 or coalesce(v_socio.talla_m,0) <= 0;
  if not v_falta_objetivo and not v_falta_medidas then
    return jsonb_build_object('ok', false, 'motivo', 'nada_falta'); end if;
  if v_falta_objetivo then v_faltantes := v_faltantes || 'tu objetivo'; end if;
  if v_falta_medidas then v_faltantes := v_faltantes || 'tu peso y talla'; end if;
  v_cuerpo := 'Para prepararte tu plan, completa ' || array_to_string(v_faltantes, ' y ') || ' desde tu perfil en la app.';
  if v_socio.usuario_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'socio_sin_app',
      'falta_objetivo', v_falta_objetivo, 'falta_medidas', v_falta_medidas); end if;
  perform public.encolar_push(v_socio.usuario_id, 'Completa tu perfil para tu plan 📝', v_cuerpo,
    jsonb_build_object('tipo','completar_perfil'));
  return jsonb_build_object('ok', true, 'falta_objetivo', v_falta_objetivo, 'falta_medidas', v_falta_medidas);
end; $function$;
