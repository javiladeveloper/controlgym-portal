-- Ciclo objetivo→plan entre socio y trainer (app):
--  1) elegir_mi_objetivo(objetivo_id): el socio guarda su objetivo del catálogo y
--     avisa por push a los entrenadores del gym para que le armen el plan.
--  2) objetivos_disponibles(): lista pública de objetivos con plan (para el selector).
--  3) enviar_plan_socio(socio_id): el trainer marca rutina+dieta enviadas y le manda
--     un push al socio ("tu entrenador te preparó un plan").
-- Aplicado en prod vía MCP el 2026-07-11.

CREATE OR REPLACE FUNCTION public.elegir_mi_objetivo(p_objetivo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_socio public.socio; v_obj public.objetivo_entrenamiento; v_trainer record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'motivo', 'sin_sesion'); end if;
  select * into v_socio from public.socio s
   where s.usuario_id = v_uid and s.deleted_at is null
   order by (select max(m.fecha_fin) from public.membresia m where m.socio_id = s.id and m.estado='activa' and m.deleted_at is null) desc nulls last, s.created_at desc
   limit 1;
  if v_socio.id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_socio'); end if;
  select * into v_obj from public.objetivo_entrenamiento where id = p_objetivo_id;
  if v_obj.id is null then return jsonb_build_object('ok', false, 'motivo', 'objetivo_invalido'); end if;
  update public.socio set objetivo_id = p_objetivo_id, updated_at = now() where id = v_socio.id;
  for v_trainer in
    select distinct ue.usuario_id from public.usuario_empresa ue join public.rol r on r.id = ue.rol_id
     where ue.empresa_id = v_socio.empresa_id and ue.activo and r.codigo in ('entrenador','nutricionista')
  loop
    perform public.encolar_push(v_trainer.usuario_id, 'Nuevo objetivo de un socio 🎯',
      v_socio.nombre || ' definió su objetivo: ' || v_obj.nombre || '. Ármale su plan.',
      jsonb_build_object('tipo','objetivo_socio','socio_id', v_socio.id::text));
  end loop;
  return jsonb_build_object('ok', true, 'objetivo', v_obj.nombre);
end; $function$;

CREATE OR REPLACE FUNCTION public.objetivos_disponibles()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nombre', nombre, 'enfoque', enfoque) order by orden), '[]'::jsonb)
  from public.objetivo_entrenamiento where tiene_plan = true;
$function$;

CREATE OR REPLACE FUNCTION public.enviar_plan_socio(p_socio_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_socio public.socio; v_rut int := 0; v_die int := 0;
begin
  select * into v_socio from public.socio where id = p_socio_id and deleted_at is null;
  if v_socio.id is null then return jsonb_build_object('ok', false, 'motivo', 'socio_inexistente'); end if;
  if public.auth_empresa_id() is distinct from v_socio.empresa_id then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado'); end if;
  update public.rutina set enviado_at = now() where socio_id = p_socio_id and activa; get diagnostics v_rut = row_count;
  update public.dieta  set enviado_at = now() where socio_id = p_socio_id and activa; get diagnostics v_die = row_count;
  if v_rut = 0 and v_die = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_plan'); end if;
  if v_socio.usuario_id is not null then
    perform public.encolar_push(v_socio.usuario_id, 'Tu entrenador te preparó un plan 💪',
      'Ya puedes ver tu nueva rutina y alimentación en la app. ¡A entrenar!', jsonb_build_object('tipo','plan_enviado'));
  end if;
  return jsonb_build_object('ok', true, 'rutina_enviada', v_rut > 0, 'dieta_enviada', v_die > 0);
end; $function$;
