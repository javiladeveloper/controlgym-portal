-- FASE 2 (molinetes/lectores físicos) — Estándar de integración de hardware.
--
-- Objetivo: vender a nivel nacional SIN configurar cada equipo a mano. El gym
-- instala el molinete + un "Agente Puente" (software en su PC) que traduce la
-- marca del lector (ZKTeco/Hikvision/…) a UN endpoint estándar de FitCore. Ese
-- endpoint se autentica con una API KEY por gimnasio: el operador la genera en
-- el panel de un clic y la pega en el agente. Cero visitas técnicas.
--
-- Esta migración deja el lado NUBE del estándar: la clave por gym (hasheada) y
-- la RPC que registra el acceso identificando al socio por su credencial
-- (huella/tarjeta) ya enrolada. El Agente Puente y el enrolamiento físico van
-- con el hardware real.

-- 1. API key por empresa. Guardamos SOLO el hash (como una contraseña): la clave
--    en claro se muestra UNA vez al generarla y no se puede recuperar.
create table if not exists public.empresa_api_key (
  empresa_id   uuid primary key references public.empresa(id) on delete cascade,
  key_hash     text not null,          -- sha256 de la clave (nunca la clave en claro)
  key_prefix   text not null,          -- primeros 8 chars, para mostrar "fk_live_ab12…" en el panel
  creada_at    timestamptz not null default now(),
  ultima_usada timestamptz,            -- para saber si el agente está vivo
  revocada     boolean not null default false
);

alter table public.empresa_api_key enable row level security;
-- Sin policies para authenticated: el hash solo lo lee el backend (endpoint).

-- 2. Generar/rotar la API key del gym (solo admin). Devuelve la clave EN CLARO
--    una única vez; el gym la copia al agente. Rotar invalida la anterior.
create or replace function public.generar_api_key()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_raw     text;
  v_key     text;
  v_prefix  text;
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador puede generar la clave de conexión';
  end if;

  -- Clave aleatoria legible: fk_live_<32 hex>
  v_raw := encode(extensions.gen_random_bytes(24), 'hex');
  v_key := 'fk_live_' || v_raw;
  v_prefix := left(v_key, 12);

  insert into public.empresa_api_key (empresa_id, key_hash, key_prefix, creada_at, revocada)
  values (v_empresa, encode(extensions.digest(v_key, 'sha256'), 'hex'), v_prefix, now(), false)
  on conflict (empresa_id) do update set
    key_hash = excluded.key_hash,
    key_prefix = excluded.key_prefix,
    creada_at = now(),
    revocada = false,
    ultima_usada = null;

  -- La clave en claro se devuelve SOLO aquí, nunca más.
  return jsonb_build_object('api_key', v_key, 'prefix', v_prefix);
end;
$function$;

grant execute on function public.generar_api_key() to authenticated;

-- 3. Estado de la clave (no secreto) para el panel: si existe, su prefijo y uso.
create or replace function public.estado_api_key()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_empresa uuid := public.auth_empresa_id(); v_fila public.empresa_api_key;
begin
  if v_empresa is null or not public.auth_is_admin() then
    return jsonb_build_object('existe', false, 'motivo', 'solo_admin');
  end if;
  select * into v_fila from public.empresa_api_key where empresa_id = v_empresa and not revocada;
  if v_fila.empresa_id is null then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object(
    'existe', true, 'prefix', v_fila.key_prefix,
    'creada_at', v_fila.creada_at, 'ultima_usada', v_fila.ultima_usada
  );
end;
$function$;

grant execute on function public.estado_api_key() to authenticated;

-- 4. Revocar la clave (desconectar el hardware del gym).
create or replace function public.revocar_api_key()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador puede revocar la clave';
  end if;
  update public.empresa_api_key set revocada = true where empresa_id = v_empresa;
end;
$function$;

grant execute on function public.revocar_api_key() to authenticated;

-- 5. RPC del check-in por hardware. La llama el ENDPOINT (no el navegador): el
--    endpoint valida la API key, resuelve la empresa, y pasa aquí el hash + los
--    datos del lector. Identifica al socio/staff por su credencial enrolada
--    (huella/tarjeta) y registra el acceso reutilizando la lógica de checkin.
--    Devuelve permitido/denegado para que el molinete abra o no.
create or replace function public.checkin_hardware(
  p_key_hash    text,        -- sha256 de la API key (lo calcula el endpoint)
  p_credencial  text,        -- el identificador que da el lector (huella/tarjeta)
  p_tipo        text default 'huella',
  p_dispositivo text default null,
  p_direccion   text default null   -- 'entrada'|'salida'|null(auto-toggle)
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa   uuid;
  v_cred      public.credencial_acceso;
  v_socio     public.socio;
  v_usuario   uuid;
  v_rol       text;
  v_nombre    text;
  v_sede      uuid;
  v_tz        text;
  v_metodo    public.metodo_checkin;
  v_hoy       date;
  v_ultimo    text;
  v_ultimo_at timestamptz;
  v_dir       text;
  v_membr_ok  boolean := true;
  v_fila_st   public.asistencia_staff;
begin
  -- 5a. Autenticación por API key (hash). Resuelve la empresa.
  select empresa_id into v_empresa from public.empresa_api_key
   where key_hash = p_key_hash and not revocada;
  if v_empresa is null then
    return jsonb_build_object('resultado', 'denegado', 'motivo', 'clave_invalida');
  end if;
  update public.empresa_api_key set ultima_usada = now() where empresa_id = v_empresa;

  -- 5b. Identificar la credencial (huella/tarjeta) enrolada, activa, de ese gym.
  select * into v_cred from public.credencial_acceso
   where empresa_id = v_empresa and tipo = p_tipo and valor = p_credencial and activo
   limit 1;
  if v_cred.id is null then
    return jsonb_build_object('resultado', 'denegado', 'motivo', 'credencial_no_enrolada');
  end if;

  select zona_horaria, metodo_checkin into v_tz, v_metodo from public.empresa where id = v_empresa;
  v_hoy := (clock_timestamp() at time zone coalesce(v_tz, 'America/Lima'))::date;

  -- 5c. Resolver titular: socio o staff (la credencial apunta a uno u otro).
  if v_cred.socio_id is not null then
    select * into v_socio from public.socio where id = v_cred.socio_id;
    v_nombre := v_socio.nombre; v_sede := v_socio.sede_id; v_rol := 'socio';
    select exists (
      select 1 from public.membresia m
       where m.socio_id = v_socio.id and m.estado = 'activa'
         and current_date between m.fecha_inicio and m.fecha_fin
    ) into v_membr_ok;
  else
    v_usuario := v_cred.usuario_id;
    select r.codigo into v_rol from public.usuario_empresa ue
      join public.rol r on r.id = ue.rol_id
     where ue.usuario_id = v_usuario and ue.empresa_id = v_empresa and ue.activo limit 1;
    v_rol := coalesce(v_rol, 'staff');
    select nombre into v_nombre from public.usuario where id = v_usuario;
    select sede_id into v_sede from public.usuario_sede
     where usuario_id = v_usuario and empresa_id = v_empresa limit 1;
  end if;

  -- 5d. Toggle entrada/salida (o forzado por el lector de dirección fija).
  select direccion, ocurrido_en into v_ultimo, v_ultimo_at
    from public.checkin
   where empresa_id = v_empresa
     and (usuario_id = v_usuario or socio_id = v_cred.socio_id)
     and (ocurrido_en at time zone coalesce(v_tz, 'America/Lima'))::date = v_hoy
   order by ocurrido_en desc limit 1;

  -- Debounce anti doble-lectura (el molinete puede disparar 2 veces).
  if v_ultimo_at is not null and clock_timestamp() - v_ultimo_at < interval '8 seconds' then
    return jsonb_build_object('resultado', case when v_membr_ok then 'permitido' else 'denegado' end,
      'tipo', v_ultimo, 'nombre', coalesce(v_nombre,'—'), 'rol', v_rol, 'repetido', true);
  end if;

  v_dir := coalesce(nullif(p_direccion,''), case when v_ultimo = 'entrada' then 'salida' else 'entrada' end);

  insert into public.checkin (
    empresa_id, sede_id, socio_id, usuario_id, rol,
    direccion, metodo, metodo_tipo, origen, resultado, motivo, ocurrido_en
  ) values (
    v_empresa, v_sede, v_cred.socio_id, v_usuario, v_rol,
    v_dir, p_tipo, v_metodo,
    case when p_tipo='huella' then 'biometrico_api' else 'lector_api' end,
    case when v_membr_ok then 'permitido' else 'denegado' end,
    case when v_membr_ok then null else 'membresia_vencida' end,
    clock_timestamp()
  );

  -- Staff → abre/cierra turno.
  if v_cred.usuario_id is not null then
    select * into v_fila_st from public.asistencia_staff
     where empresa_id = v_empresa and usuario_id = v_usuario and fecha = v_hoy;
    if v_fila_st.id is null then
      insert into public.asistencia_staff (empresa_id, sede_id, usuario_id, fecha)
      values (v_empresa, v_sede, v_usuario, v_hoy);
    else
      update public.asistencia_staff set salida_at = clock_timestamp() where id = v_fila_st.id;
    end if;
  end if;

  return jsonb_build_object(
    'resultado', case when v_membr_ok then 'permitido' else 'denegado' end,
    'motivo', case when v_membr_ok then null else 'membresia_vencida' end,
    'tipo', v_dir, 'nombre', coalesce(v_nombre,'—'), 'rol', v_rol,
    'hora', to_char(clock_timestamp() at time zone coalesce(v_tz,'America/Lima'), 'HH24:MI')
  );
end;
$function$;

-- Solo el backend (postgres) ejecuta checkin_hardware; NO se expone a authenticated.
revoke all on function public.checkin_hardware(text, text, text, text, text) from public, authenticated;

comment on table public.empresa_api_key is
  'API key por gym para el Agente Puente de hardware (molinetes/lectores). Solo hash. FASE 2.';
comment on function public.checkin_hardware is
  'Check-in desde hardware físico vía Agente Puente. Autentica por hash de API key, identifica al socio/staff por credencial enrolada, registra acceso y devuelve permitido/denegado. La invoca el endpoint /api/checkin/hardware, no el navegador. FASE 2.';
