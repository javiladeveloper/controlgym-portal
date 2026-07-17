-- Eliminar cuenta desde la app (requisito de Apple / Guideline 5.1.1(v)): si el
-- usuario puede crear cuenta (login Google), debe poder eliminarla desde la app.
--
-- Estrategia = ANONIMIZAR, no borrar todo: se elimina la identidad de auth y toda
-- la PII (nombre, email, teléfono, documento, foto, medidas), pero los registros
-- financieros de los gyms (pagos, membresías, asistencias) quedan SIN datos
-- personales — el gym conserva su contabilidad sin saber de quién era. Cumple
-- Apple (no queda PII) sin romper los reportes de los gimnasios.
--
-- Corre con el Bearer del propio usuario (auth.uid()), sin permisos de admin.
create or replace function public.eliminar_mi_cuenta()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_socios int;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;

  -- 1) Datos personales transversales (a nivel usuario): se BORRAN.
  delete from public.medida_personal     where usuario_id = v_uid;
  delete from public.meta_peso            where usuario_id = v_uid;
  delete from public.registro_entreno_libre where usuario_id = v_uid;
  delete from public.rutina_libre         where usuario_id = v_uid;  -- cascade a día/ejercicio
  delete from public.push_token           where usuario_id = v_uid;
  delete from public.push_cola            where usuario_id = v_uid;

  -- 2) Fichas de socio en los gyms: se ANONIMIZAN y desvinculan (soft-delete).
  --    Los pagos/membresías/checkins quedan atados a un socio SIN PII.
  update public.socio
     set nombre = 'Cuenta eliminada',
         email = null, telefono = null, documento = null,
         foto_url = null, foto_estado = null, foto_actualizada_at = null,
         objetivo_nota = null,
         fecha_nacimiento = null,
         usuario_id = null,           -- se desvincula de la cuenta borrada
         deleted_at = now()           -- baja lógica: sale de las listas del gym
   where usuario_id = v_uid and deleted_at is null;
  get diagnostics v_socios = row_count;

  -- 3) El registro `usuario` (fuente de verdad personal): se ANONIMIZA.
  update public.usuario
     set nombre = 'Cuenta eliminada',
         email = null, telefono = null, documento = null,
         avatar_iniciales = null, foto_url = null, foto_estado = null,
         foto_actualizada_at = null, objetivo_nota = null, objetivo_id = null,
         peso_kg = null, talla_m = null, fecha_nacimiento = null,
         activo = false, updated_at = now()
   where id = v_uid;

  -- 4) Identidad de auth: se BORRA para que no pueda volver a iniciar sesión.
  --    (security definer permite tocar el esquema auth.)
  delete from auth.users where id = v_uid;

  return jsonb_build_object('ok', true, 'socios_anonimizados', v_socios);
end;
$function$;

grant execute on function public.eliminar_mi_cuenta() to authenticated;
