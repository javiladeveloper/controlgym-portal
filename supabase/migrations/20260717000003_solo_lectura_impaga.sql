-- Modo SOLO LECTURA para las sedes con factura impaga.
--
-- El gym entra y ve todo (sus datos son suyos), pero no puede OPERAR:
--   · no registra cobros / ventas
--   · no inscribe socios ni renueva membresías
--   · no marca asistencia / check-in
--
-- Se implementa con TRIGGERS sobre las tablas y no parcheando cada RPC: hay
-- varios caminos que escriben lo mismo (cobrar_membresia_pos, renew_membership,
-- abonar_membresia, el webhook de renovación, inserts directos con RLS…) y
-- parchearlos uno por uno deja huecos y se rompe con cada RPC nuevo. El trigger
-- es el único punto por el que todos pasan.

-- ── ¿Esta sede está bloqueada por impago? ───────────────────────────────────
create or replace function public.sede_solo_lectura(p_sede_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.suscripcion_sede
    where sede_id = p_sede_id and estado = 'impaga'
  );
$$;
revoke all on function public.sede_solo_lectura(uuid) from public;
grant execute on function public.sede_solo_lectura(uuid) to authenticated, service_role;

-- ── El trigger que bloquea ──────────────────────────────────────────────────
-- Solo mira la sede de la fila que se está escribiendo.
--
-- Quién NO se bloquea: el backend (crons, webhook de Culqi que marca la factura
-- pagada y reactiva). Se distingue por auth.uid() is null — sin JWT no hay
-- usuario del panel detrás.
--
-- OJO: no se puede usar current_user para esto. Los RPCs de cobro
-- (cobrar_membresia_pos, renew_membership…) son SECURITY DEFINER propiedad de
-- postgres, así que dentro de ellos current_user ES 'postgres' — filtrar por
-- current_user dejaría pasar justo lo que hay que bloquear. auth.uid() sí
-- sobrevive: es un setting de la sesión, no del rol efectivo.
create or replace function public.trg_bloquea_si_impaga()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sede uuid;
begin
  if auth.uid() is null then       -- backend / cron: nunca se bloquea
    return new;
  end if;

  v_sede := new.sede_id;
  if v_sede is not null and public.sede_solo_lectura(v_sede) then
    raise exception 'Tu sede está en modo solo lectura por una factura pendiente. Paga en Configuración → Mi plan para volver a operar.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Las tres operaciones que definen "operar". INSERT solamente: editar o
-- corregir lo ya registrado sigue permitido (es lectura/mantenimiento, no
-- operación nueva), y así el gym puede arreglar sus datos mientras regulariza.
drop trigger if exists trg_impaga_socio on public.socio;
create trigger trg_impaga_socio before insert on public.socio
  for each row execute function public.trg_bloquea_si_impaga();

drop trigger if exists trg_impaga_membresia on public.membresia;
create trigger trg_impaga_membresia before insert on public.membresia
  for each row execute function public.trg_bloquea_si_impaga();

drop trigger if exists trg_impaga_checkin on public.checkin;
create trigger trg_impaga_checkin before insert on public.checkin
  for each row execute function public.trg_bloquea_si_impaga();

-- ── estado_suscripcion_sede: exponer el modo solo lectura ───────────────────
-- 'impaga' NO es "inactiva": el gym entra y ve todo. Por eso activa=true y el
-- bloqueo viaja aparte en solo_lectura, que es lo que el panel usa para pintar
-- la barra de cobro y deshabilitar los botones de operación.
create or replace function public.estado_suscripcion_sede(p_sede_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid;
  v_ss public.suscripcion_sede;
  v_emp_sus public.suscripcion_plataforma;
  v_estado text; v_con_app boolean; v_origen text;
begin
  select empresa_id into v_emp from public.sede where id = p_sede_id;
  if v_emp is null then return jsonb_build_object('encontrado', false); end if;

  select * into v_ss from public.suscripcion_sede where sede_id = p_sede_id;
  if v_ss.id is not null then
    -- prueba vencida se marca al vuelo (igual que la de empresa)
    if v_ss.estado = 'prueba' and v_ss.trial_hasta is not null and v_ss.trial_hasta < current_date then
      update public.suscripcion_sede set estado = 'vencida' where id = v_ss.id returning * into v_ss;
    end if;
    v_estado := v_ss.estado; v_con_app := v_ss.con_app; v_origen := 'sede';
  else
    select * into v_emp_sus from public.suscripcion_plataforma where empresa_id = v_emp;
    v_estado := coalesce(v_emp_sus.estado, 'prueba');
    v_con_app := coalesce(v_emp_sus.con_app, false);
    v_origen := 'empresa';
  end if;

  return jsonb_build_object(
    'encontrado', true, 'sede_id', p_sede_id, 'estado', v_estado,
    'con_app', v_con_app,
    -- impaga entra: el gym puede ver, pero no operar.
    'activa', v_estado in ('prueba','activa','impaga'),
    'solo_lectura', v_estado = 'impaga',
    'origen', v_origen
  );
end $$;
revoke all on function public.estado_suscripcion_sede(uuid) from public;
grant execute on function public.estado_suscripcion_sede(uuid) to authenticated, service_role;
