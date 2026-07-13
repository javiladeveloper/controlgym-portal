-- enviar_plan_socio ahora ATRIBUYE quién envía (entrenador_id/nutricionista_id =
-- auth.uid()), igual que el portal web (useEnviarPlan). Sin esto, las rutinas/dietas
-- asignadas automáticamente por IMC/objetivo — que se crean sin entrenador — quedaban
-- sin atribuir al enviarse desde la app móvil (FitCore) y no contaban en el reporte
-- de atenciones (reporte_atenciones). Cierra el seguimiento #1 de HANDOFF-REPORTES.md.
create or replace function public.enviar_plan_socio(p_socio_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_socio public.socio;
  v_uid uuid := auth.uid();
  v_rut int := 0;
  v_die int := 0;
begin
  select * into v_socio from public.socio where id = p_socio_id and deleted_at is null;
  if v_socio.id is null then return jsonb_build_object('ok', false, 'motivo', 'socio_inexistente'); end if;

  -- Autorización: quien llama debe ser staff de la empresa del socio.
  if public.auth_empresa_id() is distinct from v_socio.empresa_id then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  -- Marca enviado y atribuye al que envía (para el reporte de atenciones). Si no
  -- hay uid (no debería en un trainer autenticado), solo marca enviado.
  update public.rutina
     set enviado_at = now(),
         entrenador_id = coalesce(v_uid, entrenador_id)
   where socio_id = p_socio_id and activa;
  get diagnostics v_rut = row_count;

  update public.dieta
     set enviado_at = now(),
         nutricionista_id = coalesce(v_uid, nutricionista_id)
   where socio_id = p_socio_id and activa;
  get diagnostics v_die = row_count;

  if v_rut = 0 and v_die = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_plan');
  end if;

  -- Push al socio (solo si tiene su usuario vinculado + token).
  if v_socio.usuario_id is not null then
    perform public.encolar_push(
      v_socio.usuario_id,
      'Tu entrenador te preparó un plan 💪',
      'Ya puedes ver tu nueva rutina y alimentación en la app. ¡A entrenar!',
      jsonb_build_object('tipo','plan_enviado')
    );
  end if;

  return jsonb_build_object('ok', true, 'rutina_enviada', v_rut > 0, 'dieta_enviada', v_die > 0);
end;
$function$;
