-- PEDIDO 16 (paso 2/3) — RPC de check-in por QR + RLS de la tabla checkin.
--
-- Cierra el modo kiosco de la app: el socio/staff muestra su QR rotativo, el
-- kiosco (app corriendo bajo la sesion autenticada del recepcionista/admin) lo
-- escanea y llama a registrar_checkin. La RPC valida el token EN EL SERVIDOR
-- (decision del owner: sin HMAC en Fase 1) y persiste el acceso.
--
-- Formato del token (lo arma la app en commonMain/dominio/TokenCarnet.kt):
--   v1|usuario_id|empresa_id|emitidoEnMs
-- Sin firma: la legitimidad se valida contra la BD (el usuario existe en esa
-- empresa, membresia vigente si es socio) y el anti-replay por unicidad de
-- (usuario, emitidoEnMs) impide reutilizar una captura del QR. La superficie
-- queda acotada porque solo una sesion de staff autenticada (RLS) puede invocar
-- la RPC. El hardware sin sesion (qr_lector/biometrico, Fase 2) usara API key.

-- ---------------------------------------------------------------------------
-- 1. Anti-replay: un mismo token (usuario + instante de emision) se registra
--    una sola vez. Guardamos el emitidoEnMs en el propio checkin y lo hacemos
--    unico. Columna nueva (nullable: los checkins manuales/existentes no la usan).
alter table public.checkin
  add column if not exists token_emitido_ms bigint;

create unique index if not exists uq_checkin_token_replay
  on public.checkin (usuario_id, token_emitido_ms)
  where token_emitido_ms is not null;

-- ---------------------------------------------------------------------------
-- 2. RPC registrar_checkin
create or replace function public.registrar_checkin(
  p_token       text,
  p_origen      text default 'kiosco',
  p_dispositivo text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa_sesion uuid := public.auth_empresa_id();  -- empresa del staff que opera el kiosco
  v_partes    text[];
  v_uid       uuid;
  v_eid       uuid;
  v_emitido   bigint;
  v_ahora_ms  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ventana   bigint := 60000;  -- 60 s, igual que tokenVigente() en la app
  v_tz        text;
  v_metodo    public.metodo_checkin;
  v_es_socio  boolean := false;
  v_socio_id  uuid;
  v_sede_id   uuid;
  v_nombre    text;
  v_rol       text;
  v_membr_ok  boolean := true;
  v_ultimo    text;   -- ultima direccion del dia (entrada/salida) para el toggle
  v_dir       text;
  v_hoy       date;
  v_fila_st   public.asistencia_staff;
begin
  if v_empresa_sesion is null then
    raise exception 'Sin empresa activa: el kiosco debe operar bajo una sesion de staff';
  end if;

  -- 2a. Parseo estricto del payload (espejo de parsearPayloadCarnet en la app)
  v_partes := string_to_array(coalesce(p_token, ''), '|');
  if array_length(v_partes, 1) is distinct from 4 or v_partes[1] <> 'v1' then
    raise exception 'QR invalido';
  end if;
  begin
    v_uid     := v_partes[2]::uuid;
    v_eid     := v_partes[3]::uuid;
    v_emitido := v_partes[4]::bigint;
  exception when others then
    raise exception 'QR invalido';
  end;

  -- 2b. El QR debe ser de la MISMA empresa que opera el kiosco (aislamiento tenant)
  if v_eid <> v_empresa_sesion then
    raise exception 'QR de otra empresa';
  end if;

  -- 2c. Vigencia (~60 s). Si el kiosco tiene reloj adelantado no rechazamos por
  --     unos ms: aceptamos [emitido - 5s, emitido + ventana].
  if v_ahora_ms - v_emitido < -5000 or v_ahora_ms - v_emitido > v_ventana then
    raise exception 'QR vencido, pide que lo actualice';
  end if;

  -- 2d. El usuario debe pertenecer (activo) a esa empresa
  if not exists (
    select 1 from public.usuario_empresa
     where usuario_id = v_uid and empresa_id = v_eid and activo
  )
  and not exists (
    select 1 from public.socio
     where usuario_id = v_uid and empresa_id = v_eid and estado <> 'inactivo'
  ) then
    raise exception 'Usuario no pertenece a este gimnasio';
  end if;

  -- 2e. Resolver rol y datos. ¿Es socio o staff?
  select s.id, s.sede_id, s.nombre
    into v_socio_id, v_sede_id, v_nombre
    from public.socio s
   where s.usuario_id = v_uid and s.empresa_id = v_eid
   limit 1;

  if v_socio_id is not null then
    v_es_socio := true;
    v_rol := 'socio';
    -- Membresia vigente (mismo criterio que checkin_manual)
    select exists (
      select 1 from public.membresia m
       where m.socio_id = v_socio_id and m.estado = 'activa'
         and current_date between m.fecha_inicio and m.fecha_fin
    ) into v_membr_ok;
  else
    -- Staff: resolver codigo de rol y su sede
    select r.codigo
      into v_rol
      from public.usuario_empresa ue
      join public.rol r on r.id = ue.rol_id
     where ue.usuario_id = v_uid and ue.empresa_id = v_eid and ue.activo
     limit 1;
    v_rol := coalesce(v_rol, 'staff');
    select nombre into v_nombre from public.usuario where id = v_uid;
    -- sede del staff: la primera permitida (si no tiene, queda null)
    select sede_id into v_sede_id from public.usuario_sede
     where usuario_id = v_uid and empresa_id = v_eid limit 1;
  end if;

  -- 2f. Metodo configurado del gym (para etiquetar el checkin)
  select metodo_checkin, zona_horaria into v_metodo, v_tz
    from public.empresa where id = v_eid;
  v_hoy := (clock_timestamp() at time zone coalesce(v_tz, 'America/Lima'))::date;

  -- 2g. Toggle entrada/salida por el ultimo evento del dia de ese usuario
  select direccion into v_ultimo
    from public.checkin
   where usuario_id = v_uid and empresa_id = v_eid
     and (ocurrido_en at time zone coalesce(v_tz, 'America/Lima'))::date = v_hoy
   order by ocurrido_en desc
   limit 1;
  v_dir := case when v_ultimo = 'entrada' then 'salida' else 'entrada' end;

  -- 2h. Persistir el acceso (conserva las columnas del feed del Dashboard:
  --     direccion/metodo/resultado; agrega usuario_id/rol/metodo_tipo/origen)
  insert into public.checkin (
    empresa_id, sede_id, socio_id, usuario_id, rol,
    direccion, metodo, metodo_tipo, origen, resultado, motivo,
    dispositivo_id, token_emitido_ms, ocurrido_en
  ) values (
    v_eid, v_sede_id, v_socio_id, v_uid, v_rol,
    v_dir, 'qr', v_metodo, p_origen,
    case when v_membr_ok then 'permitido' else 'denegado' end,
    case when v_membr_ok then null else 'membresia_vencida' end,
    null, v_emitido, clock_timestamp()
  );

  -- 2i. Si es staff, el check-in abre/cierra su turno (reusa el patron de
  --     marcar_asistencia_staff: primera marca del dia = entrada; siguientes =
  --     extienden salida, lo que dispara la reasignacion de pendientes existente).
  if not v_es_socio then
    select * into v_fila_st from public.asistencia_staff
     where empresa_id = v_eid and usuario_id = v_uid and fecha = v_hoy;
    if v_fila_st.id is null then
      insert into public.asistencia_staff (empresa_id, sede_id, usuario_id, fecha)
      values (v_eid, v_sede_id, v_uid, v_hoy);
    else
      update public.asistencia_staff set salida_at = clock_timestamp()
       where id = v_fila_st.id;
    end if;
  end if;

  return jsonb_build_object(
    'tipo',      v_dir,
    'nombre',    coalesce(v_nombre, 'Socio'),
    'rol',       v_rol,
    'resultado', case when v_membr_ok then 'permitido' else 'denegado' end,
    'motivo',    case when v_membr_ok then null else 'membresia_vencida' end,
    'hora',      to_char(clock_timestamp() at time zone coalesce(v_tz, 'America/Lima'), 'HH24:MI')
  );
exception
  when unique_violation then
    -- El anti-replay (uq_checkin_token_replay) salto: ese QR ya se uso.
    raise exception 'Ese QR ya fue escaneado, pide que lo actualice';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. RLS: la tabla checkin YA tiene RLS con las policies correctas
--    (checkin_scope = staff escribe/lee accesos de su empresa+sede;
--    socio_app_checkin = el socio ve su propio historial). No las tocamos.
--    La RPC es SECURITY DEFINER, asi que su insert pasa; el aislamiento por
--    empresa lo garantiza la validacion v_eid = v_empresa_sesion de arriba.

grant execute on function public.registrar_checkin(text, text, text) to authenticated;

comment on function public.registrar_checkin is
  'Check-in por QR rotativo (kiosco/app). Valida token en servidor (sin HMAC en Fase 1): formato v1|uid|eid|ms, misma empresa, vigencia 60s, anti-replay por (usuario,emitido). Toggle entrada/salida; si es staff, abre/cierra turno. PEDIDO 16.';
