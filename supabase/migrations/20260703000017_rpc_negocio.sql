-- ============================================================================
-- 17 · RPC de negocio
--   · get_bootstrap        : datos de arranque del frontend tras login
--   · get_modulos_activos  : módulos habilitados de la empresa activa
--   · verificar_acceso     : decide si un torniquete abre y registra el checkin
--   · freeze_membership    : congela/reactiva respetando el tope del plan
--   · renew_membership     : renueva y genera el movimiento de caja
-- ============================================================================

-- ── Bootstrap del frontend ──────────────────────────────────────────────────
-- Devuelve perfil + empresa activa + empresas disponibles + módulos + sedes,
-- en un solo round-trip.
create or replace function public.get_bootstrap()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid := public.auth_empresa_id();
  result jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
    'usuario', (
      select to_jsonb(u) - 'created_at' - 'updated_at'
      from public.usuario u where u.id = v_uid
    ),
    'empresa_activa', (
      select to_jsonb(e) from public.empresa e where e.id = v_empresa
    ),
    'rol', public.auth_rol(),
    'tema', (
      select to_jsonb(t) - 'created_at' - 'updated_at'
      from public.empresa_tema t where t.empresa_id = v_empresa
    ),
    'empresas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'empresa_id', ue.empresa_id,
        'nombre', e.nombre,
        'rol', r.codigo,
        'es_default', ue.es_default
      )), '[]'::jsonb)
      from public.usuario_empresa ue
      join public.empresa e on e.id = ue.empresa_id
      join public.rol r on r.id = ue.rol_id
      where ue.usuario_id = v_uid and ue.activo
    ),
    'modulos', public.get_modulos_activos(),
    'sedes', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.nombre), '[]'::jsonb)
      from public.sede s
      where s.empresa_id = v_empresa
        and s.deleted_at is null
        and (s.id in (select public.auth_sede_ids()) or public.auth_is_admin())
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_bootstrap() to authenticated;

-- ── Módulos activos de la empresa (default de categoría + override empresa) ──
create or replace function public.get_modulos_activos()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  with base as (
    -- default por categoría de la empresa activa
    select m.slug
    from public.empresa e
    join public.categoria_modulo cm on cm.categoria_id = e.categoria_id
    join public.modulo m on m.id = cm.modulo_id
    where e.id = public.auth_empresa_id()
  ),
  overrides as (
    select m.slug, em.habilitado
    from public.empresa_modulo em
    join public.modulo m on m.id = em.modulo_id
    where em.empresa_id = public.auth_empresa_id()
  )
  select coalesce(jsonb_agg(distinct slug), '[]'::jsonb)
  from (
    -- slugs habilitados: (en base y no deshabilitados) union (overrides habilitados)
    select b.slug from base b
    where not exists (select 1 from overrides o where o.slug = b.slug and o.habilitado = false)
    union
    select o.slug from overrides o where o.habilitado = true
  ) x;
$$;

grant execute on function public.get_modulos_activos() to authenticated;

-- ── Verificación de acceso para torniquetes ─────────────────────────────────
-- Llamada por el equipo/API cuando alguien intenta entrar. Decide y registra.
-- Identifica al socio por credencial (tipo + valor). SECURITY DEFINER porque el
-- torniquete puede operar con una identidad de servicio de la empresa.
create or replace function public.verificar_acceso(
  p_sede_id       uuid,
  p_credencial_tipo text,
  p_credencial_valor text,
  p_dispositivo_id uuid default null,
  p_direccion     text default 'entrada'
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_socio   public.socio;
  v_permite_multisede boolean;
  v_membresia public.membresia;
  v_resultado text := 'denegado';
  v_motivo    text := 'credencial_no_encontrada';
begin
  -- Empresa dueña de la sede
  select empresa_id into v_empresa from public.sede where id = p_sede_id;
  if v_empresa is null then
    return jsonb_build_object('resultado','denegado','motivo','sede_invalida');
  end if;

  -- Identificar socio por credencial activa
  select s.* into v_socio
  from public.credencial_acceso c
  join public.socio s on s.id = c.socio_id
  where c.empresa_id = v_empresa and c.tipo = p_credencial_tipo
    and c.valor = p_credencial_valor and c.activo
    and s.deleted_at is null
  limit 1;

  if v_socio.id is not null then
    -- ¿La sede coincide con la de origen, o el plan es multisede?
    select bool_or(p.multisede) into v_permite_multisede
    from public.membresia m
    join public.plan p on p.id = m.plan_id
    where m.socio_id = v_socio.id and m.estado = 'activa'
      and current_date between m.fecha_inicio and m.fecha_fin;

    -- Membresía activa vigente
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

  -- Registrar el intento (permitido o denegado)
  insert into public.checkin (empresa_id, sede_id, socio_id, dispositivo_id, direccion, metodo, resultado, motivo)
  values (v_empresa, p_sede_id, v_socio.id, p_dispositivo_id, p_direccion,
          coalesce(p_credencial_tipo,'manual'), v_resultado, v_motivo);

  return jsonb_build_object(
    'resultado', v_resultado,
    'motivo', v_motivo,
    'socio_id', v_socio.id,
    'socio_nombre', v_socio.nombre
  );
end;
$$;

comment on function public.verificar_acceso is
  'Verifica y registra un intento de acceso desde un torniquete/lector. Devuelve permitido/denegado + motivo.';

-- ── Congelar / reactivar membresía respetando el tope del plan ──────────────
create or replace function public.freeze_membership(p_membresia_id uuid, p_dias int default null)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_m public.membresia;
  v_tope int;
  v_usados int;
begin
  select * into v_m from public.membresia where id = p_membresia_id;  -- RLS aplica
  if v_m.id is null then
    raise exception 'Membresía no encontrada o sin acceso';
  end if;

  if v_m.estado = 'congelada' then
    -- Reactivar
    update public.membresia set estado = 'activa' where id = p_membresia_id;
    update public.congelamiento set estado = 'finalizado', fecha_fin = current_date
      where membresia_id = p_membresia_id and estado = 'aprobado';
    return jsonb_build_object('estado','activa');
  end if;

  -- Congelar: validar tope anual del plan
  select p.dias_congelamiento_anio into v_tope
  from public.plan p where p.id = v_m.plan_id;

  select coalesce(sum(dias),0) into v_usados
  from public.congelamiento
  where membresia_id = p_membresia_id
    and extract(year from fecha_inicio) = extract(year from current_date)
    and estado in ('aprobado','finalizado');

  if v_tope = 0 then
    raise exception 'El plan no permite congelamiento';
  end if;
  if v_usados + coalesce(p_dias, 0) > v_tope then
    raise exception 'Excede el tope de % días de congelamiento al año (usados: %)', v_tope, v_usados;
  end if;

  update public.membresia set estado = 'congelada' where id = p_membresia_id;
  insert into public.congelamiento (empresa_id, membresia_id, fecha_inicio, dias, estado, aprobado_por)
  values (v_m.empresa_id, p_membresia_id, current_date, p_dias, 'aprobado', auth.uid());

  return jsonb_build_object('estado','congelada','dias', p_dias, 'tope', v_tope, 'usados', v_usados + coalesce(p_dias,0));
end;
$$;

grant execute on function public.freeze_membership(uuid, int) to authenticated;

-- ── Renovar membresía (extiende y genera ingreso en caja) ───────────────────
create or replace function public.renew_membership(p_membresia_id uuid)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_m public.membresia;
  v_precio numeric(12,2);
  v_unidad text;
  v_nueva_fin date;
begin
  select * into v_m from public.membresia where id = p_membresia_id;  -- RLS aplica
  if v_m.id is null then
    raise exception 'Membresía no encontrada o sin acceso';
  end if;

  select precio, unidad into v_precio, v_unidad from public.plan where id = v_m.plan_id;

  v_nueva_fin := greatest(v_m.fecha_fin, current_date) +
    case v_unidad
      when 'dia' then interval '1 day'
      when 'mes' then interval '1 month'
      when 'trimestre' then interval '3 months'
      when 'anual' then interval '1 year'
      else interval '1 month'
    end;

  update public.membresia
     set fecha_fin = v_nueva_fin, estado = 'activa', precio_pagado = v_precio
   where id = p_membresia_id;

  insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, ref_tipo, ref_id, registrado_por)
  values (v_m.empresa_id, v_m.sede_id, 'ingreso', 'membresia',
          'Renovación de membresía', v_precio, 'membresia', p_membresia_id, auth.uid());

  return jsonb_build_object('estado','activa','fecha_fin', v_nueva_fin, 'monto', v_precio);
end;
$$;

grant execute on function public.renew_membership(uuid) to authenticated;
