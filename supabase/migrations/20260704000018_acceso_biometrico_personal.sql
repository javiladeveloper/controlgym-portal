-- ============================================================================
-- 85 (20260704000018) · Acceso biométrico unificado: socios Y personal
-- (000017 reservado para la app)
--
-- Pedido del cliente: para marcar asistencia, 2 métodos —
--   1) por HUELLA / FACIAL (un lector físico en la puerta)
--   2) MANUAL (recepción para socios; botón Entrada/Salida para personal)
-- ...y que ambos sirvan tanto para SOCIOS como para PERSONAL.
--
-- Antes: credencial_acceso y verificar_acceso solo contemplaban socios.
-- Ahora: la misma credencial (huella/rostro/tarjeta/pin) puede ser de un
-- socio O de un colaborador, y verificar_acceso ENRUTA el fichaje:
--   · socio    → checkin (valida membresía vigente)   [método manual: recepción/QR]
--   · personal → asistencia_staff (entrada/salida)    [método manual: marcar_asistencia_staff]
-- El puente con el lector físico (api/acceso ZKTeco, etc.) es aparte y se
-- hace cuando haya hardware real; este cambio deja el modelo 100% listo.
-- ============================================================================

-- ── 1) credencial_acceso ahora acepta socio O usuario (personal) ────────────
alter table public.credencial_acceso
  add column if not exists usuario_id uuid references public.usuario(id) on delete cascade;

-- socio_id deja de ser obligatorio (una credencial es de socio O de personal)
alter table public.credencial_acceso alter column socio_id drop not null;

-- Exactamente uno de los dos: socio O usuario (nunca ambos, nunca ninguno)
alter table public.credencial_acceso drop constraint if exists chk_credencial_titular;
alter table public.credencial_acceso add constraint chk_credencial_titular
  check ((socio_id is not null) <> (usuario_id is not null));

create index if not exists idx_credencial_usuario on public.credencial_acceso(usuario_id);

-- ── 2) verificar_acceso: identifica al titular y enruta el fichaje ──────────
create or replace function public.verificar_acceso(
  p_sede_id uuid,
  p_credencial_tipo text,
  p_credencial_valor text,
  p_dispositivo_id uuid default null,
  p_direccion text default 'entrada'
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_cred    public.credencial_acceso;
  v_socio   public.socio;
  v_permite_multisede boolean;
  v_membresia public.membresia;
  v_usuario record;
  v_tz text;
  v_hoy date;
  v_asis public.asistencia_staff;
  v_resultado text := 'denegado';
  v_motivo    text := 'credencial_no_encontrada';
begin
  select empresa_id into v_empresa from public.sede where id = p_sede_id;
  if v_empresa is null then
    return jsonb_build_object('resultado','denegado','motivo','sede_invalida');
  end if;

  -- Buscar la credencial activa (de socio o de personal)
  select * into v_cred
  from public.credencial_acceso c
  where c.empresa_id = v_empresa and c.tipo = p_credencial_tipo
    and c.valor = p_credencial_valor and c.activo
  limit 1;

  -- ── CASO PERSONAL: la credencial es de un colaborador ────────────────────
  if v_cred.id is not null and v_cred.usuario_id is not null then
    select ue.usuario_id, u.nombre into v_usuario
    from public.usuario_empresa ue
    join public.usuario u on u.id = ue.usuario_id
    where ue.empresa_id = v_empresa and ue.usuario_id = v_cred.usuario_id and ue.activo;

    if v_usuario.usuario_id is null then
      -- credencial existe pero el colaborador ya no está activo (despedido)
      insert into public.checkin (empresa_id, sede_id, dispositivo_id, direccion, metodo, resultado, motivo)
      values (v_empresa, p_sede_id, p_dispositivo_id, p_direccion,
              coalesce(p_credencial_tipo,'manual'), 'denegado', 'colaborador_inactivo');
      return jsonb_build_object('resultado','denegado','motivo','colaborador_inactivo','tipo','personal');
    end if;

    select zona_horaria into v_tz from public.empresa where id = v_empresa;
    v_hoy := (now() at time zone coalesce(v_tz,'America/Lima'))::date;

    select * into v_asis from public.asistencia_staff
     where empresa_id = v_empresa and usuario_id = v_usuario.usuario_id and fecha = v_hoy;

    if v_asis.id is null then
      insert into public.asistencia_staff (empresa_id, sede_id, usuario_id, fecha)
      values (v_empresa, p_sede_id, v_usuario.usuario_id, v_hoy)
      returning * into v_asis;
      v_motivo := 'entrada';
    else
      update public.asistencia_staff set salida_at = now()
       where id = v_asis.id returning * into v_asis;
      v_motivo := 'salida';
    end if;

    -- Log del fichaje de personal en checkin (socio_id null, es de staff)
    insert into public.checkin (empresa_id, sede_id, dispositivo_id, direccion, metodo, resultado, motivo)
    values (v_empresa, p_sede_id, p_dispositivo_id,
            case when v_motivo='salida' then 'salida' else 'entrada' end,
            coalesce(p_credencial_tipo,'manual'), 'permitido', 'staff_'||v_motivo);

    return jsonb_build_object(
      'resultado','permitido','tipo','personal','accion',v_motivo,
      'usuario_id',v_usuario.usuario_id,'nombre',v_usuario.nombre);
  end if;

  -- ── CASO SOCIO: comportamiento original (valida membresía) ───────────────
  if v_cred.id is not null and v_cred.socio_id is not null then
    select s.* into v_socio from public.socio s
     where s.id = v_cred.socio_id and s.deleted_at is null;
  end if;

  if v_socio.id is not null then
    select bool_or(p.multisede) into v_permite_multisede
    from public.membresia m
    join public.plan p on p.id = m.plan_id
    where m.socio_id = v_socio.id and m.estado = 'activa'
      and current_date between m.fecha_inicio and m.fecha_fin;

    select m.* into v_membresia
    from public.membresia m
    where m.socio_id = v_socio.id and m.estado = 'activa'
      and current_date between m.fecha_inicio and m.fecha_fin
    order by m.fecha_fin desc
    limit 1;

    if v_membresia.id is null then
      v_resultado := 'denegado'; v_motivo := 'membresia_vencida';
    elsif v_socio.sede_id <> p_sede_id and not coalesce(v_permite_multisede,false) then
      v_resultado := 'denegado'; v_motivo := 'sede_no_permitida';
    else
      v_resultado := 'permitido'; v_motivo := null;
    end if;
  end if;

  insert into public.checkin (empresa_id, sede_id, socio_id, dispositivo_id, direccion, metodo, resultado, motivo)
  values (v_empresa, p_sede_id, v_socio.id, p_dispositivo_id, p_direccion,
          coalesce(p_credencial_tipo,'manual'), v_resultado, v_motivo);

  return jsonb_build_object(
    'resultado', v_resultado, 'motivo', v_motivo, 'tipo', 'socio',
    'socio_id', v_socio.id, 'socio_nombre', v_socio.nombre);
end;
$$;

-- ── 3) Enrolar/quitar credencial (una API para socio o personal) ────────────
-- El biométrico real lo captura el lector/SDK; aquí se guarda el identificador
-- que ese equipo genera (o un PIN/tarjeta manual). Solo admin/recepción.
create or replace function public.enrolar_credencial(
  p_tipo text,               -- 'huella' | 'facial' | 'tarjeta' | 'pin'
  p_valor text,              -- identificador que da el lector, o el PIN/nro tarjeta
  p_socio_id uuid default null,
  p_usuario_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_id uuid;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  if not public.auth_is_admin() and public.auth_rol() <> 'recepcion' then
    raise exception 'Solo administración o recepción puede enrolar credenciales';
  end if;
  if (p_socio_id is not null) = (p_usuario_id is not null) then
    raise exception 'Indica exactamente un titular: socio o colaborador';
  end if;
  if p_tipo not in ('huella','facial','tarjeta','pin') then
    raise exception 'Tipo de credencial inválido';
  end if;

  insert into public.credencial_acceso (empresa_id, socio_id, usuario_id, tipo, valor, activo)
  values (v_empresa, p_socio_id, p_usuario_id, p_tipo, p_valor, true)
  on conflict (empresa_id, tipo, valor)
    do update set activo = true, socio_id = excluded.socio_id, usuario_id = excluded.usuario_id
  returning id into v_id;

  return jsonb_build_object('credencial_id', v_id);
end;
$$;

-- RLS: la nueva columna usuario_id ya queda cubierta por la policy de tenant
-- existente (credencial_acceso_tenant: empresa_id = auth_empresa_id()).
