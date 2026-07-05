-- ============================================================================
-- 83 (20260704000015) · Reparto de solicitudes entre trainers presentes
-- (000014 quedó reservado para la app — protocolo HANDOFF)
--
-- Pedido del cliente:
--   · 2 trainers en el gym (uno por piso, ambos marcaron entrada) → las
--     solicitudes de ayuda se REPARTEN: cada una se asigna al disponible
--     con menos pendientes, y el push va SOLO a él → no chocan respondiendo
--     la misma.
--   · 1 solo trainer y hoy no vino (enfermo) → la solicitud queda asignada
--     a él, el push le llega al celular y la bandeja la conserva: la
--     resuelve cuando regrese (o cualquier otro staff si urge).
--   · La asignación es un reparto, NO un candado de personas: cualquier
--     trainer/admin puede responder una solicitud ajena. El candado real es
--     anti-DOBLE respuesta: la primera decisión gana, la segunda es error.
-- ============================================================================

alter table public.solicitud_carga
  add column if not exists asignado_a uuid references public.usuario(id);

create index if not exists idx_solicitud_carga_asignado
  on public.solicitud_carga(asignado_a) where estado = 'pendiente';

-- ── Alta: ahora BEFORE insert para poder sellar asignado_a ──────────────────
drop trigger if exists trg_solicitud_carga_alta on public.solicitud_carga;

create or replace function public.trg_solicitud_carga_alta()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_socio record;
  v_detalle text;
begin
  select nombre, sede_id into v_socio from public.socio where id = new.socio_id;
  v_detalle := coalesce(new.ejercicio_nombre, 'su rutina')
    || case when new.carga_actual is not null and new.carga_deseada is not null
            then ': ' || new.carga_actual || ' → ' || new.carga_deseada else '' end;

  -- Reparto: de los disponibles AHORA (cascada presente+turno → turno →
  -- todos los activos), el que tenga MENOS solicitudes pendientes asignadas.
  -- Empate → orden pseudoaleatorio estable para no cargar siempre al mismo.
  select d into new.asignado_a
  from public.staff_disponible(new.empresa_id, array['entrenador']) d
  left join lateral (
    select count(*) as pendientes from public.solicitud_carga sc
    where sc.empresa_id = new.empresa_id and sc.asignado_a = d and sc.estado = 'pendiente'
  ) k on true
  order by k.pendientes, md5(d::text || new.id::text)
  limit 1;

  insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
  values (new.empresa_id, v_socio.sede_id, 'solicitud_carga',
          '🏋️ ' || v_socio.nombre || ' quiere subir de carga',
          v_detalle || coalesce(' — "' || new.mensaje_socio || '"', ''),
          'info', 'solicitud_carga', new.id);

  -- Push SOLO al asignado: los demás la ven en la bandeja, pero no les suena
  if new.asignado_a is not null then
    perform public.encolar_push(
      new.asignado_a,
      '🏋️ ' || v_socio.nombre || ' quiere subir de carga',
      v_detalle || ' — te la asignamos a ti, respóndele desde la app',
      jsonb_build_object('tipo', 'solicitud_carga', 'solicitud_id', new.id, 'socio_id', new.socio_id)
    );
  end if;

  return new;
end;
$$;

create trigger trg_solicitud_carga_alta
  before insert on public.solicitud_carga
  for each row execute function public.trg_solicitud_carga_alta();

-- ── Respuesta: la primera decisión GANA (anti doble-respuesta) ──────────────
create or replace function public.trg_solicitud_carga_respuesta()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
begin
  -- Dos trainers respondiendo la misma: el segundo recibe este error claro
  if old.estado <> 'pendiente' and new.estado <> old.estado then
    raise exception 'Esta solicitud ya fue respondida por otro trainer';
  end if;

  if old.estado = 'pendiente' and new.estado in ('aprobada','rechazada') then
    new.respondido_por := coalesce(new.respondido_por, auth.uid());
    new.respondido_at := coalesce(new.respondido_at, now());

    select usuario_id into v_usuario from public.socio where id = new.socio_id;
    if v_usuario is not null then
      perform public.encolar_push(
        v_usuario,
        case when new.estado = 'aprobada'
          then '💪 ¡Aprobado! Sube la carga'
          else '🧘 Aún no — sigue así' end,
        case when new.estado = 'aprobada'
          then coalesce(new.ejercicio_nombre || ' → ' || new.carga_deseada, 'Tu trainer aprobó tu solicitud')
               || coalesce('. ' || new.nota_trainer, '')
          else coalesce(new.nota_trainer, 'Tu trainer prefiere esperar un poco más.') end,
        jsonb_build_object('tipo', 'solicitud_carga_respuesta', 'solicitud_id', new.id, 'estado', new.estado)
      );
    end if;
  end if;
  return new;
end;
$$;

-- ── Al marcar SALIDA, sus pendientes se reparten entre los que quedan ───────
-- (si no queda nadie disponible mejor que él, se quedan con él: las verá
-- al volver — el caso del trainer único enfermo)
create or replace function public.trg_asistencia_reasignar()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  v_nuevo uuid;
begin
  if new.salida_at is null then return new; end if;

  for r in
    select id from public.solicitud_carga
    where empresa_id = new.empresa_id and asignado_a = new.usuario_id and estado = 'pendiente'
  loop
    select d into v_nuevo
    from public.staff_disponible(new.empresa_id, array['entrenador']) d
    left join lateral (
      select count(*) as pendientes from public.solicitud_carga sc
      where sc.empresa_id = new.empresa_id and sc.asignado_a = d and sc.estado = 'pendiente'
    ) k on true
    where d <> new.usuario_id
    order by k.pendientes, md5(d::text || r.id::text)
    limit 1;

    if v_nuevo is not null then
      update public.solicitud_carga set asignado_a = v_nuevo where id = r.id;
      perform public.encolar_push(
        v_nuevo,
        '🏋️ Solicitud de carga reasignada a ti',
        'Tu compañero marcó salida — quedó pendiente una solicitud de subir carga',
        jsonb_build_object('tipo', 'solicitud_carga', 'solicitud_id', r.id)
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_asistencia_reasignar on public.asistencia_staff;
create trigger trg_asistencia_reasignar
  after update on public.asistencia_staff
  for each row execute function public.trg_asistencia_reasignar();
