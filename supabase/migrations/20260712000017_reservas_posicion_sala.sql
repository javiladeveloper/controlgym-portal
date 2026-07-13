-- Reservas de clases con POSICIÓN en sala + ventana de reserva por plan.
-- Aditivo y compatible: la app que llama reservar_clase(clase, fecha) sin
-- posición sigue funcionando (3er arg opcional). Las clases sin sala reservan
-- por cupo como hoy. Ver plan aprobado.

-- ── A1. Salas con layout de posiciones ─────────────────────────────────────
create table if not exists public.sala (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id),
  sede_id uuid not null references public.sede(id),
  nombre text not null,
  filas int not null check (filas between 1 and 40),
  columnas int not null check (columnas between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists idx_sala_empresa_sede on public.sala (empresa_id, sede_id);

create table if not exists public.sala_posicion (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.sala(id) on delete cascade,
  empresa_id uuid not null references public.empresa(id),
  fila int not null,
  columna int not null,
  etiqueta text,                 -- "Bici 7", "Mat 3" (si null, se numera en el front)
  activa boolean not null default true,  -- false = pasillo/hueco, no reservable
  unique (sala_id, fila, columna)
);
create index if not exists idx_sala_posicion_sala on public.sala_posicion (sala_id);

-- clase.sala_id: opcional. Con sala → mapa de posiciones; sin sala → solo cupo.
alter table public.clase add column if not exists sala_id uuid references public.sala(id);

-- ── A2. Posición opcional en la reserva ─────────────────────────────────────
alter table public.reserva_clase add column if not exists sala_posicion_id uuid references public.sala_posicion(id);
-- un asiento no se reserva 2 veces la misma fecha (sin afectar reservas sin posición)
create unique index if not exists uq_reserva_posicion
  on public.reserva_clase (clase_id, fecha, sala_posicion_id)
  where sala_posicion_id is not null and estado <> 'cancelada';

-- ── A3. Ventana de reserva por plan (reemplaza el 14 hardcodeado) ───────────
alter table public.plan add column if not exists antelacion_reserva_dias int not null default 14
  check (antelacion_reserva_dias between 0 and 90);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.sala enable row level security;
alter table public.sala_posicion enable row level security;

drop policy if exists sala_scope on public.sala;
create policy sala_scope on public.sala for all
  using (empresa_id = public.auth_empresa_id() and (sede_id in (select public.auth_sede_ids()) or public.auth_is_admin()))
  with check (empresa_id = public.auth_empresa_id() and (sede_id in (select public.auth_sede_ids()) or public.auth_is_admin()));
drop policy if exists socio_app_sala on public.sala;
create policy socio_app_sala on public.sala for select using (public.es_socio_de(empresa_id));

drop policy if exists sala_posicion_scope on public.sala_posicion;
create policy sala_posicion_scope on public.sala_posicion for all
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());
drop policy if exists socio_app_sala_posicion on public.sala_posicion;
create policy socio_app_sala_posicion on public.sala_posicion for select using (public.es_socio_de(empresa_id));

-- ── A4. reservar_clase extendida (posición opcional + antelación por plan) ──
create or replace function public.reservar_clase(
  p_clase_id uuid, p_fecha date, p_sala_posicion_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_clase public.clase;
  v_socio public.socio;
  v_mem public.membresia;
  v_antelacion int;
  v_ocupados int;
  v_reserva uuid;
  v_cancelada uuid;
  v_pos public.sala_posicion;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  select * into v_clase from public.clase where id = p_clase_id and activa and deleted_at is null;
  if v_clase.id is null then raise exception 'Clase no encontrada o inactiva'; end if;

  select * into v_socio from public.socio
   where usuario_id = v_uid and empresa_id = v_clase.empresa_id and deleted_at is null limit 1;
  if v_socio.id is null then raise exception 'No estás vinculado a este gimnasio'; end if;
  if v_socio.estado <> 'activo' then raise exception 'Tu registro de socio no está activo — consulta en recepción'; end if;

  if p_fecha < current_date then raise exception 'La fecha ya pasó'; end if;
  if extract(isodow from p_fecha) <> v_clase.dia_semana then
    raise exception 'Esa clase no se dicta ese día';
  end if;

  select * into v_mem from public.membresia
   where socio_id = v_socio.id and estado = 'activa' and deleted_at is null
     and fecha_fin >= p_fecha
   order by fecha_fin desc limit 1;
  if v_mem.id is null then raise exception 'Necesitas una membresía vigente para esa fecha'; end if;

  -- Antelación configurable por el plan del socio (antes: 14 fijo).
  select coalesce(antelacion_reserva_dias, 14) into v_antelacion from public.plan where id = v_mem.plan_id;
  if p_fecha > current_date + coalesce(v_antelacion, 14) then
    raise exception 'Tu plan permite reservar hasta con % días de anticipación', coalesce(v_antelacion, 14);
  end if;

  -- Acceso del plan a la clase
  if not exists (select 1 from public.tipo_clase tc where tc.id = v_clase.tipo_clase_id and tc.acceso_libre)
     and not exists (select 1 from public.plan_acceso_clase pac
                      where pac.plan_id = v_mem.plan_id and pac.tipo_clase_id = v_clase.tipo_clase_id and pac.incluido) then
    raise exception 'Tu plan no incluye esta clase';
  end if;

  -- ¿Ya tiene reserva activa? (amigable)
  if exists (select 1 from public.reserva_clase
              where socio_id = v_socio.id and clase_id = p_clase_id and fecha = p_fecha and estado <> 'cancelada') then
    raise exception 'Ya tienes una reserva para esta clase ese día';
  end if;

  -- ── POSICIÓN ──
  -- Bloqueo de las reservas de esta clase/fecha para evitar carrera de asiento.
  perform 1 from public.reserva_clase where clase_id = p_clase_id and fecha = p_fecha for update;

  if v_clase.sala_id is not null then
    -- clase con sala: la posición es obligatoria y debe estar libre
    if p_sala_posicion_id is null then
      raise exception 'Elige tu lugar en la sala para reservar esta clase';
    end if;
    select * into v_pos from public.sala_posicion where id = p_sala_posicion_id and sala_id = v_clase.sala_id;
    if v_pos.id is null then raise exception 'Ese lugar no pertenece a la sala de esta clase'; end if;
    if not v_pos.activa then raise exception 'Ese lugar no está disponible'; end if;
    if exists (select 1 from public.reserva_clase
                where clase_id = p_clase_id and fecha = p_fecha
                  and sala_posicion_id = p_sala_posicion_id and estado <> 'cancelada') then
      raise exception 'Ese lugar ya está reservado — elige otro';
    end if;
  else
    -- clase sin sala: se ignora cualquier posición y se valida por cupo
    p_sala_posicion_id := null;
    select count(*) into v_ocupados from public.reserva_clase
     where clase_id = p_clase_id and fecha = p_fecha and estado <> 'cancelada';
    if v_clase.cupo_max is not null and v_ocupados >= v_clase.cupo_max then
      raise exception 'Clase llena (% de % cupos)', v_ocupados, v_clase.cupo_max;
    end if;
  end if;

  -- reactivar cancelada o insertar
  select id into v_cancelada from public.reserva_clase
   where socio_id = v_socio.id and clase_id = p_clase_id and fecha = p_fecha and estado = 'cancelada' limit 1;
  if v_cancelada is not null then
    update public.reserva_clase set estado = 'reservada', sala_posicion_id = p_sala_posicion_id
      where id = v_cancelada returning id into v_reserva;
  else
    insert into public.reserva_clase (empresa_id, sede_id, clase_id, socio_id, fecha, estado, sala_posicion_id)
    values (v_clase.empresa_id, v_clase.sede_id, p_clase_id, v_socio.id, p_fecha, 'reservada', p_sala_posicion_id)
    returning id into v_reserva;
  end if;

  return jsonb_build_object(
    'reserva_id', v_reserva,
    'sala_posicion_id', p_sala_posicion_id,
    'cupos_restantes', case
      when v_clase.sala_id is not null then
        (select count(*) from public.sala_posicion sp where sp.sala_id = v_clase.sala_id and sp.activa)
        - (select count(*) from public.reserva_clase r where r.clase_id = p_clase_id and r.fecha = p_fecha and r.estado <> 'cancelada')
      when v_clase.cupo_max is null then null
      else v_clase.cupo_max - v_ocupados - 1 end
  );
end $$;
revoke all on function public.reservar_clase(uuid, date, uuid) from public, anon;
grant execute on function public.reservar_clase(uuid, date, uuid) to authenticated, service_role;

-- ── mapa_clase: la grilla de la sala con el estado de cada posición ─────────
create or replace function public.mapa_clase(p_clase_id uuid, p_fecha date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_clase public.clase;
  v_mi_socio uuid;
begin
  select * into v_clase from public.clase where id = p_clase_id and deleted_at is null;
  if v_clase.id is null then raise exception 'Clase no encontrada'; end if;
  -- el que consulta debe ser staff de la empresa o socio de ella
  if public.auth_empresa_id() is distinct from v_clase.empresa_id
     and not public.es_socio_de(v_clase.empresa_id) then
    raise exception 'No autorizado';
  end if;
  select id into v_mi_socio from public.socio where usuario_id = v_uid and empresa_id = v_clase.empresa_id and deleted_at is null limit 1;

  if v_clase.sala_id is null then
    -- sin sala: solo cupo
    return jsonb_build_object('tiene_sala', false,
      'cupo_max', v_clase.cupo_max,
      'ocupados', (select count(*) from public.reserva_clase r where r.clase_id = p_clase_id and r.fecha = p_fecha and r.estado <> 'cancelada'));
  end if;

  return jsonb_build_object(
    'tiene_sala', true,
    'sala', (select jsonb_build_object('id', s.id, 'nombre', s.nombre, 'filas', s.filas, 'columnas', s.columnas)
             from public.sala s where s.id = v_clase.sala_id),
    'posiciones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sp.id, 'fila', sp.fila, 'columna', sp.columna, 'etiqueta', sp.etiqueta, 'activa', sp.activa,
        'ocupada', r.id is not null,
        'es_mia', r.socio_id is not distinct from v_mi_socio,
        'socio_nombre', case when public.auth_empresa_id() = v_clase.empresa_id then so.nombre else null end
      ) order by sp.fila, sp.columna)
      from public.sala_posicion sp
      left join public.reserva_clase r on r.sala_posicion_id = sp.id and r.clase_id = p_clase_id
        and r.fecha = p_fecha and r.estado <> 'cancelada'
      left join public.socio so on so.id = r.socio_id
      where sp.sala_id = v_clase.sala_id
    ), '[]'::jsonb)
  );
end $$;
revoke all on function public.mapa_clase(uuid, date) from public, anon;
grant execute on function public.mapa_clase(uuid, date) to authenticated, service_role;

-- Elimina el overload viejo de 2 args: la nueva firma (3 args, el 3ro con
-- default null) cubre las llamadas de 2 args de la app SIN ambigüedad. Dejar
-- ambas haría que PostgREST no sepa cuál elegir cuando llega {clase, fecha}.
drop function if exists public.reservar_clase(uuid, date);
