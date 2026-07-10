-- Fix: registrar_checkin (kiosco) registra la sede FISICA del kiosco, no la
-- sede asignada del socio/staff. El staff (trainers, personal) NO tiene
-- restriccion de sede (rota entre sedes), pero su ingreso queda en la sede
-- donde marco. La app pasa p_sede_id = sede del kiosco; si no, compat previo.

drop function if exists public.registrar_checkin(text, text, text);

CREATE OR REPLACE FUNCTION public.registrar_checkin(p_token text, p_origen text DEFAULT 'kiosco'::text, p_dispositivo text DEFAULT NULL::text, p_sede_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa_sesion uuid := public.auth_empresa_id();  -- empresa del staff que opera el kiosco
  v_formato   text;       -- 'fc1' | 'v1'
  v_partes    text[];
  v_uid       uuid;       -- usuario (solo en v1)
  v_eid       uuid;
  v_emitido   bigint;     -- emitidoEnMs (solo v1, para anti-replay estricto)
  v_exp       bigint;     -- expiracion (solo fc1)
  v_base      text;
  v_firma     text;
  v_ahora_ms  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ventana   bigint := 60000;  -- 60 s, igual que tokenVigente() en la app (v1)
  v_tz        text;
  v_metodo    public.metodo_checkin;
  v_es_socio  boolean := false;
  v_socio_id  uuid;
  v_sede_id   uuid;
  v_nombre    text;
  v_rol       text;
  v_membr_ok  boolean := true;
  v_ultimo    text;   -- ultima direccion del dia (entrada/salida) para el toggle
  v_ultimo_at timestamptz;
  v_dir       text;
  v_hoy       date;
  v_fila_st   public.asistencia_staff;
  v_sede_registro uuid;
begin
  if v_empresa_sesion is null then
    raise exception 'Sin empresa activa: el kiosco debe operar bajo una sesion de staff';
  end if;

  -- 1. Detectar formato por el prefijo
  if left(coalesce(p_token, ''), 4) = 'FC1.' then
    v_formato := 'fc1';
  elsif left(coalesce(p_token, ''), 3) = 'v1|' then
    v_formato := 'v1';
  else
    raise exception 'QR invalido';
  end if;

  -- 2. Parsear + validar segun formato
  if v_formato = 'fc1' then
    -- FC1.<socio_id>.<empresa_id>.<exp>.<firma> (mismo esquema que validar_qr)
    v_partes := string_to_array(p_token, '.');
    if array_length(v_partes, 1) <> 5 or v_partes[1] <> 'FC1' then
      raise exception 'QR invalido';
    end if;
    begin
      v_socio_id := v_partes[2]::uuid;
      v_eid      := v_partes[3]::uuid;
      v_exp      := v_partes[4]::bigint;
    exception when others then
      raise exception 'QR invalido';
    end;
    -- Firma HMAC contra el secreto del sistema (identica a validar_qr)
    v_base := v_partes[2] || '.' || v_partes[3] || '.' || v_partes[4];
    select encode(extensions.hmac(v_base, valor, 'sha256'), 'hex') into v_firma
      from privado.secreto where clave = 'qr_secret';
    if v_firma is distinct from v_partes[5] then
      raise exception 'QR adulterado';
    end if;
    if v_exp < extract(epoch from now())::bigint then
      raise exception 'QR vencido, que abra su app para renovarlo';
    end if;
    v_es_socio := true;  -- mi_qr solo emite para socios
  else
    -- v1|<usuario_id>|<empresa_id>|<ms>  (token plano, staff o legado)
    v_partes := string_to_array(p_token, '|');
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
    -- Vigencia ~60 s (toleramos 5 s de reloj adelantado del kiosco)
    if v_ahora_ms - v_emitido < -5000 or v_ahora_ms - v_emitido > v_ventana then
      raise exception 'QR vencido, pide que lo actualice';
    end if;
  end if;

  -- 3. Aislamiento tenant: el QR debe ser de la empresa que opera el kiosco
  if v_eid <> v_empresa_sesion then
    raise exception 'QR de otra empresa';
  end if;

  select zona_horaria, metodo_checkin into v_tz, v_metodo
    from public.empresa where id = v_eid;
  v_hoy := (clock_timestamp() at time zone coalesce(v_tz, 'America/Lima'))::date;

  -- 4. Resolver usuario/socio y datos segun el formato
  if v_formato = 'fc1' then
    -- Ya tenemos socio_id; traemos nombre, sede y usuario_id
    select s.usuario_id, s.sede_id, s.nombre
      into v_uid, v_sede_id, v_nombre
      from public.socio s
     where s.id = v_socio_id and s.empresa_id = v_eid and s.deleted_at is null;
    if v_nombre is null then
      raise exception 'Socio no encontrado';
    end if;
    v_rol := 'socio';
    select exists (
      select 1 from public.membresia m
       where m.socio_id = v_socio_id and m.estado = 'activa'
         and current_date between m.fecha_inicio and m.fecha_fin
    ) into v_membr_ok;
  else
    -- v1: pertenencia por usuario_id; puede ser socio o staff
    if not exists (
      select 1 from public.usuario_empresa
       where usuario_id = v_uid and empresa_id = v_eid and activo
    ) and not exists (
      select 1 from public.socio
       where usuario_id = v_uid and empresa_id = v_eid and estado <> 'inactivo'
    ) then
      raise exception 'Usuario no pertenece a este gimnasio';
    end if;

    select s.id, s.sede_id, s.nombre
      into v_socio_id, v_sede_id, v_nombre
      from public.socio s
     where s.usuario_id = v_uid and s.empresa_id = v_eid
     limit 1;

    if v_socio_id is not null then
      v_es_socio := true;
      v_rol := 'socio';
      select exists (
        select 1 from public.membresia m
         where m.socio_id = v_socio_id and m.estado = 'activa'
           and current_date between m.fecha_inicio and m.fecha_fin
      ) into v_membr_ok;
    else
      select r.codigo into v_rol
        from public.usuario_empresa ue
        join public.rol r on r.id = ue.rol_id
       where ue.usuario_id = v_uid and ue.empresa_id = v_eid and ue.activo
       limit 1;
      v_rol := coalesce(v_rol, 'staff');
      select nombre into v_nombre from public.usuario where id = v_uid;
      select sede_id into v_sede_id from public.usuario_sede
       where usuario_id = v_uid and empresa_id = v_eid limit 1;
    end if;
  end if;

  -- 5. Toggle entrada/salida por el ultimo evento del dia del usuario.
  --    Ademas capturamos su hora para el DEBOUNCE anti doble-scan.
  select direccion, ocurrido_en into v_ultimo, v_ultimo_at
    from public.checkin
   where empresa_id = v_eid
     and (usuario_id = v_uid or (v_socio_id is not null and socio_id = v_socio_id))
     and (ocurrido_en at time zone coalesce(v_tz, 'America/Lima'))::date = v_hoy
   order by ocurrido_en desc
   limit 1;

  -- 5a. DEBOUNCE: un segundo escaneo del mismo usuario en < 8 s es doble-scan
  --     accidental → devolvemos el ultimo resultado sin duplicar el registro.
  if v_ultimo_at is not null and clock_timestamp() - v_ultimo_at < interval '8 seconds' then
    return jsonb_build_object(
      'tipo', v_ultimo, 'nombre', coalesce(v_nombre, 'Socio'), 'rol', v_rol,
      'resultado', case when v_membr_ok then 'permitido' else 'denegado' end,
      'motivo', case when v_membr_ok then null else 'membresia_vencida' end,
      'hora', to_char(v_ultimo_at at time zone coalesce(v_tz, 'America/Lima'), 'HH24:MI'),
      'repetido', true
    );
  end if;

  v_dir := case when v_ultimo = 'entrada' then 'salida' else 'entrada' end;

  -- 6. Persistir el acceso
  -- Sede donde se registra el ingreso: la del kiosco (fisica) si la mandan;
  -- si no, la deducida (sede del socio, o la asignada del staff).
  v_sede_registro := coalesce(p_sede_id, v_sede_id);

  insert into public.checkin (
    empresa_id, sede_id, socio_id, usuario_id, rol,
    direccion, metodo, metodo_tipo, origen, resultado, motivo,
    dispositivo_id, token_emitido_ms, ocurrido_en
  ) values (
    v_eid, v_sede_registro, v_socio_id, v_uid, v_rol,
    v_dir, 'qr', v_metodo, p_origen,
    case when v_membr_ok then 'permitido' else 'denegado' end,
    case when v_membr_ok then null else 'membresia_vencida' end,
    null, v_emitido, clock_timestamp()  -- token_emitido_ms solo lo trae v1
  );

  -- 7. Si es staff (solo puede venir por v1), abre/cierra su turno
  if not v_es_socio then
    select * into v_fila_st from public.asistencia_staff
     where empresa_id = v_eid and usuario_id = v_uid and fecha = v_hoy;
    if v_fila_st.id is null then
      insert into public.asistencia_staff (empresa_id, sede_id, usuario_id, fecha)
      values (v_eid, v_sede_registro, v_uid, v_hoy);
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
    -- Anti-replay estricto del v1 (uq_checkin_token_replay): ese token ya se uso.
    raise exception 'Ese QR ya fue escaneado, pide que lo actualice';
end;
$function$


