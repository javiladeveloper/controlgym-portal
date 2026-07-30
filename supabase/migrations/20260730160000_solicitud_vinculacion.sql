-- ============================================================================
-- Vinculación por DNI CON APROBACIÓN del gym (BLOQUE A del diseño de
-- vinculación + rutina portable, 2026-07-30).
--
-- Por qué NO se vincula automáticamente por documento: `vincular_socio()`
-- matchea por email/teléfono porque esos datos los controla el propio dueño
-- de la cuenta (los escribió al registrarse). El documento NO: cualquiera
-- puede ESCRIBIR el DNI de otra persona. Si bastara con "documento coincide"
-- para vincular, cualquiera con el DNI de un socio que no usa la app podría
-- teclearlo y quedarse con su cuenta (ver sus datos, su rutina, colarse con
-- su membresía). Por eso el flujo es: el usuario SOLICITA, el gym (que
-- conoce físicamente a su socio) APRUEBA o RECHAZA. Nunca hay escritura
-- directa de `socio.usuario_id` en la RPC de solicitud.
--
-- Normalización de documento elegida: dígitos únicos vía
-- `regexp_replace(doc, '\D', '', 'g')` (quita espacios, guiones, puntos,
-- letras). Igual al criterio ya usado para teléfono en `vincular_socio()`.
-- Un documento sin ningún dígito (cadena vacía tras normalizar) se trata
-- como inválido/no encontrado — nunca matchea contra `documento is null`.
-- ============================================================================

-- ── Tabla ────────────────────────────────────────────────────────────────
create table public.solicitud_vinculacion (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null default auth.uid() references public.usuario(id) on delete cascade,
  socio_id      uuid not null references public.socio(id) on delete cascade,
  empresa_id    uuid not null references public.empresa(id) on delete cascade,   -- TENANT
  documento_usado text,
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','aprobada','rechazada')),
  creado_at     timestamptz not null default now(),
  resuelto_at   timestamptz,
  resuelto_por  uuid references public.usuario(id)
);

-- Una sola solicitud PENDIENTE por (usuario, socio) — evita spam/duplicados;
-- solicitar_vinculacion_por_documento() la reutiliza en vez de duplicarla.
create unique index uq_solicitud_vinculacion_pendiente
  on public.solicitud_vinculacion(usuario_id, socio_id)
  where estado = 'pendiente';

-- Bandeja del staff: pendientes de su empresa.
create index idx_solicitud_vinculacion_empresa_estado
  on public.solicitud_vinculacion(empresa_id, estado);

comment on table public.solicitud_vinculacion is
  'Solicitud del usuario de la app para vincularse a un socio por DNI. NUNCA vincula sola: requiere aprobación del staff del gym (anti-suplantación, ver cabecera de la migración).';

alter table public.solicitud_vinculacion enable row level security;

-- El usuario ve SOLO las suyas.
create policy solicitud_vinculacion_usuario_sel on public.solicitud_vinculacion
  for select to authenticated
  using (usuario_id = auth.uid());

-- El staff ve las de su empresa activa.
create policy solicitud_vinculacion_staff_sel on public.solicitud_vinculacion
  for select to authenticated
  using (empresa_id = public.auth_empresa_id());

-- Sin policies de insert/update: toda escritura pasa por las RPCs
-- security definer de abajo (no hay grants directos a `authenticated`).

revoke all on public.solicitud_vinculacion from public, authenticated;
grant select on public.solicitud_vinculacion to authenticated;

-- ── solicitar_vinculacion_por_documento(): la llama el USUARIO ─────────────
-- Nunca escribe socio.usuario_id. Solo crea (o reutiliza) la solicitud.
create or replace function public.solicitar_vinculacion_por_documento(p_documento text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_doc text;
  v_socio record;
  v_existente uuid;
  v_nueva uuid;
  v_gym text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  v_doc := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
  if v_doc = '' then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;

  -- Guarda el documento del solicitante para futuros matches legítimos
  -- (p.ej. si el gym decide más adelante ofrecer match automático revisado).
  update public.usuario set documento = v_doc where id = v_uid;

  -- Solo socios SIN cuenta vinculada, en sedes con la app contratada.
  -- "no existe" y "ya vinculado" devuelven el MISMO motivo neutro: no hay
  -- forma de distinguir desde afuera si un documento existe pero ya tiene
  -- dueño (evita enumeración de DNIs).
  select s.id, s.empresa_id, e.nombre as empresa_nombre
    into v_socio
  from public.socio s
  join public.empresa e on e.id = s.empresa_id
  where regexp_replace(coalesce(s.documento, ''), '\D', '', 'g') = v_doc
    and s.documento is not null
    and s.usuario_id is null
    and s.deleted_at is null
    and public.sede_con_app(s.sede_id)
  order by s.created_at desc
  limit 1;

  if v_socio.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;

  -- Idempotente: si ya hay una pendiente para este (usuario, socio), la
  -- devuelve en vez de duplicar (el índice único la protege igualmente).
  select id into v_existente
  from public.solicitud_vinculacion
  where usuario_id = v_uid and socio_id = v_socio.id and estado = 'pendiente';

  if v_existente is not null then
    return jsonb_build_object('ok', true, 'estado', 'pendiente',
      'gym', v_socio.empresa_nombre, 'solicitud_id', v_existente);
  end if;

  insert into public.solicitud_vinculacion (usuario_id, socio_id, empresa_id, documento_usado)
  values (v_uid, v_socio.id, v_socio.empresa_id, v_doc)
  returning id into v_nueva;

  return jsonb_build_object('ok', true, 'estado', 'pendiente',
    'gym', v_socio.empresa_nombre, 'solicitud_id', v_nueva);
end;
$$;

-- ── solicitudes_vinculacion_pendientes(): las lee el STAFF ─────────────────
create or replace function public.solicitudes_vinculacion_pendientes()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'solicitud_id', sv.id,
      'creado_at', sv.creado_at,
      'documento_usado', sv.documento_usado,
      'socio', jsonb_build_object(
        'id', s.id,
        'nombre', s.nombre,
        'documento', s.documento,
        'email', s.email,
        'telefono', s.telefono
      ),
      'solicitante', jsonb_build_object(
        'usuario_id', u.id,
        'nombre', u.nombre,
        'email', u.email
      )
    ) order by sv.creado_at asc), '[]'::jsonb)
  from public.solicitud_vinculacion sv
  join public.socio s on s.id = sv.socio_id
  join public.usuario u on u.id = sv.usuario_id
  where sv.empresa_id = public.auth_empresa_id()
    and sv.estado = 'pendiente';
$$;

-- ── resolver_vinculacion(): aprueba/rechaza el STAFF ───────────────────────
create or replace function public.resolver_vinculacion(p_solicitud_id uuid, p_aprobar boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_sol public.solicitud_vinculacion;
  v_filas int;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;

  select * into v_sol
  from public.solicitud_vinculacion
  where id = p_solicitud_id;

  if v_sol.id is null then
    raise exception 'Solicitud no encontrada';
  end if;

  -- AISLAMIENTO: solo el staff de la empresa dueña de la solicitud resuelve.
  if v_sol.empresa_id <> v_empresa then
    raise exception 'No autorizado para resolver esta solicitud';
  end if;

  if v_sol.estado <> 'pendiente' then
    return jsonb_build_object('ok', false, 'motivo', 'La solicitud ya fue resuelta');
  end if;

  if p_aprobar then
    -- Vincula SOLO si el socio sigue sin usuario_id: si ya se vinculó por
    -- otra vía (p.ej. vincular_socio() por email/teléfono mientras tanto),
    -- no se pisa esa vinculación existente; la solicitud igual se marca
    -- aprobada para cerrar la bandeja.
    update public.socio
       set usuario_id = v_sol.usuario_id
     where id = v_sol.socio_id and usuario_id is null;
    get diagnostics v_filas = row_count;

    update public.solicitud_vinculacion
       set estado = 'aprobada', resuelto_at = now(), resuelto_por = auth.uid()
     where id = p_solicitud_id;

    return jsonb_build_object('ok', true, 'estado', 'aprobada', 'vinculado_ahora', v_filas > 0);
  else
    update public.solicitud_vinculacion
       set estado = 'rechazada', resuelto_at = now(), resuelto_por = auth.uid()
     where id = p_solicitud_id;

    return jsonb_build_object('ok', true, 'estado', 'rechazada');
  end if;
end;
$$;

revoke all on function public.solicitar_vinculacion_por_documento(text) from public, authenticated;
revoke all on function public.solicitudes_vinculacion_pendientes() from public, authenticated;
revoke all on function public.resolver_vinculacion(uuid, boolean) from public, authenticated;
grant execute on function public.solicitar_vinculacion_por_documento(text) to authenticated;
grant execute on function public.solicitudes_vinculacion_pendientes() to authenticated;
grant execute on function public.resolver_vinculacion(uuid, boolean) to authenticated;
