-- ============================================================================
-- 82 (20260704000013) · Turnos y asistencia del STAFF + avisos inteligentes
-- Pedido del cliente: los socios no se atan a UN trainer. Si el que firmó la
-- rutina se enferma, renuncia o está en otro turno, los avisos (nuevo socio,
-- solicitud de carga) van al staff que SÍ puede atender:
--   1º los que están DE TURNO y PRESENTES (marcaron entrada hoy),
--   2º si nadie marcó, los que están de turno,
--   3º si nadie está de turno (madrugada, feriado), TODOS los activos —
--      ninguna solicitud se queda sin destinatario; además quedan en hold
--      en su tabla hasta que alguien las responda.
-- Despedir = desactivar (usuario_empresa.activo=false): deja de recibir solo.
-- Contratar = invitar: empieza a recibir solo. Nada queda huérfano.
-- ============================================================================

alter table public.usuario_empresa
  add column if not exists turno_inicio time,
  add column if not exists turno_fin    time;

comment on column public.usuario_empresa.turno_inicio is
  'Hora de entrada del turno (hora local del gym). NULL = sin turno fijo: disponible siempre.';

-- ── Asistencia del staff: una fila por persona y día ────────────────────────
create table if not exists public.asistencia_staff (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  sede_id    uuid references public.sede(id) on delete set null,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  fecha      date not null,
  entrada_at timestamptz not null default now(),
  salida_at  timestamptz,
  unique (empresa_id, usuario_id, fecha)
);
create index if not exists idx_asistencia_staff_dia on public.asistencia_staff(empresa_id, fecha);

alter table public.asistencia_staff enable row level security;

-- Todo el staff del gym la LEE; se escribe solo por RPC (security definer)
drop policy if exists asistencia_staff_sel on public.asistencia_staff;
create policy asistencia_staff_sel on public.asistencia_staff
  for select to authenticated
  using (empresa_id = public.auth_empresa_id());

-- Marcar entrada/salida. Sin argumentos = yo mismo (app staff / panel).
-- El admin puede marcar por otro (recepción real: "llegó Marco, márcalo").
create or replace function public.marcar_asistencia_staff(
  p_usuario_id uuid default null,
  p_sede_id    uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_usuario uuid := coalesce(p_usuario_id, auth.uid());
  v_tz      text;
  v_hoy     date;
  v_fila    public.asistencia_staff;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  if v_usuario <> auth.uid() and not public.auth_is_admin() then
    raise exception 'Solo el administrador puede marcar por otra persona';
  end if;
  if not exists (select 1 from public.usuario_empresa
                  where empresa_id = v_empresa and usuario_id = v_usuario and activo) then
    raise exception 'Colaborador no activo en esta empresa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_hoy := (now() at time zone coalesce(v_tz, 'America/Lima'))::date;

  select * into v_fila from public.asistencia_staff
   where empresa_id = v_empresa and usuario_id = v_usuario and fecha = v_hoy;

  if v_fila.id is null then
    insert into public.asistencia_staff (empresa_id, sede_id, usuario_id, fecha)
    values (v_empresa, p_sede_id, v_usuario, v_hoy)
    returning * into v_fila;
    return jsonb_build_object('accion', 'entrada', 'hora', v_fila.entrada_at);
  end if;

  -- Segunda marca (o posteriores): registra/extiende la salida
  update public.asistencia_staff set salida_at = now()
   where id = v_fila.id
   returning * into v_fila;
  return jsonb_build_object('accion', 'salida', 'hora', v_fila.salida_at);
end;
$$;

-- ── ¿A quién avisar AHORA? Cascada presente+turno → turno → todos ──────────
create or replace function public.staff_disponible(p_empresa uuid, p_roles text[])
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  with ahora as (
    select (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::time as hora,
           (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::date as hoy
    from public.empresa e where e.id = p_empresa
  ),
  candidatos as (
    select ue.usuario_id,
      (ue.turno_inicio is null or ue.turno_fin is null
        or (ue.turno_inicio <= ue.turno_fin
            and (select hora from ahora) between ue.turno_inicio and ue.turno_fin)
        or (ue.turno_inicio > ue.turno_fin  -- turno que cruza medianoche
            and ((select hora from ahora) >= ue.turno_inicio
              or (select hora from ahora) <= ue.turno_fin))) as de_turno,
      exists (select 1 from public.asistencia_staff a
               where a.empresa_id = p_empresa and a.usuario_id = ue.usuario_id
                 and a.fecha = (select hoy from ahora) and a.salida_at is null) as presente
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id
    where ue.empresa_id = p_empresa and ue.activo and ro.codigo = any(p_roles)
  )
  select usuario_id from candidatos
  where case
    when exists (select 1 from candidatos where presente and de_turno) then presente and de_turno
    when exists (select 1 from candidatos where de_turno) then de_turno
    else true
  end
$$;

-- ── Los avisos existentes pasan a usar la cascada ───────────────────────────
create or replace function public.trg_notificar_nuevo_socio()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
begin
  if coalesce(current_setting('fitcontrol.bulk', true), '') = 'on' then
    return new;
  end if;

  insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
  values (new.empresa_id, new.sede_id, 'nuevo_socio',
          '💪 Nuevo socio: ' || new.nombre,
          'Créale su rutina y plan de alimentación en Rutinas y dietas',
          'info', 'socio', new.id);

  for v_usuario in
    select * from public.staff_disponible(new.empresa_id, array['entrenador', 'nutricionista'])
  loop
    perform public.encolar_push(
      v_usuario,
      '💪 Nuevo socio: ' || new.nombre,
      'Se acaba de inscribir — créale su rutina y plan de alimentación',
      jsonb_build_object('tipo', 'nuevo_socio', 'socio_id', new.id)
    );
  end loop;

  return new;
end;
$$;

create or replace function public.trg_solicitud_carga_alta()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_socio record;
  v_detalle text;
  v_usuario uuid;
begin
  select nombre, sede_id into v_socio from public.socio where id = new.socio_id;
  v_detalle := coalesce(new.ejercicio_nombre, 'su rutina')
    || case when new.carga_actual is not null and new.carga_deseada is not null
            then ': ' || new.carga_actual || ' → ' || new.carga_deseada else '' end;

  insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
  values (new.empresa_id, v_socio.sede_id, 'solicitud_carga',
          '🏋️ ' || v_socio.nombre || ' quiere subir de carga',
          v_detalle || coalesce(' — "' || new.mensaje_socio || '"', ''),
          'info', 'solicitud_carga', new.id);

  for v_usuario in
    select * from public.staff_disponible(new.empresa_id, array['entrenador'])
  loop
    perform public.encolar_push(
      v_usuario,
      '🏋️ ' || v_socio.nombre || ' quiere subir de carga',
      v_detalle || ' — respóndele desde la app',
      jsonb_build_object('tipo', 'solicitud_carga', 'solicitud_id', new.id, 'socio_id', new.socio_id)
    );
  end loop;

  return new;
end;
$$;
