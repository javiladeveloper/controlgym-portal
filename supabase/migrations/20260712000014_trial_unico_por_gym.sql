-- El free trial de 30 días es UNO por gimnasio, no uno por sede (decisión del
-- owner: "si agrega más sedes no le vuelven a activar 30 días más"). Antes
-- crear_sede_con_suscripcion le daba trial_hasta = +30 a cada sede nueva —
-- un trial de regalo por sede. Ahora la sede HEREDA el trial de la empresa:
--   • si el trial de empresa sigue vigente → la sede comparte esa misma fecha
--     de fin (le quedan los días que le queden al gym, no 30 nuevos);
--   • si ya venció (o la empresa ya está activa/pagando) → la sede nace SIN
--     trial, en estado que exige activar su pago desde el día 1.

create or replace function public.crear_sede_con_suscripcion(
  p_empresa_id uuid, p_nombre text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sede uuid;
  v_plan text;
  v_con_app boolean;
  v_emp_estado text;
  v_emp_trial date;
  v_estado text;
  v_trial date;
begin
  if public.auth_empresa_id() is distinct from p_empresa_id or not public.auth_is_admin() then
    raise exception 'No autorizado';
  end if;

  select plan_slug, plan_con_app into v_plan, v_con_app
  from public.empresa where id = p_empresa_id;

  -- Trial de la EMPRESA: el único trial del gimnasio.
  select estado, trial_hasta into v_emp_estado, v_emp_trial
  from public.suscripcion_plataforma where empresa_id = p_empresa_id;

  if v_emp_estado = 'prueba' and v_emp_trial is not null and v_emp_trial >= current_date then
    -- Trial del gym aún vigente → la sede comparte su MISMA fecha de fin.
    v_estado := 'prueba';
    v_trial := v_emp_trial;
  else
    -- Trial agotado o empresa ya activa/vencida → la sede nace SIN trial nuevo:
    -- queda 'vencida' (debe activar su pago). No se regalan 30 días más.
    v_estado := 'vencida';
    v_trial := null;
  end if;

  set local session_replication_role = replica;
  insert into public.sede (empresa_id, nombre, activa)
  values (p_empresa_id, trim(p_nombre), true) returning id into v_sede;
  set local session_replication_role = origin;

  insert into public.suscripcion_sede (empresa_id, sede_id, plan_slug, con_app, estado, trial_hasta)
  values (p_empresa_id, v_sede, v_plan, coalesce(v_con_app, false), v_estado, v_trial);

  insert into public.usuario_sede (usuario_id, empresa_id, sede_id)
  values (auth.uid(), p_empresa_id, v_sede) on conflict do nothing;

  return v_sede;
end $$;
revoke all on function public.crear_sede_con_suscripcion(uuid, text) from public;
grant execute on function public.crear_sede_con_suscripcion(uuid, text) to authenticated, service_role;

-- Nota: las sedes creadas dentro del ONBOARDING (declaradas en el alta) NO
-- pasan por este helper — se crean directo en aplicar_onboarding y penden de
-- la suscripción de empresa (comparten SU trial). Correcto: el gym tiene un
-- solo trial y todas sus sedes iniciales viven bajo él. Este helper aplica a
-- las sedes que el gym AGREGA DESPUÉS del onboarding.
