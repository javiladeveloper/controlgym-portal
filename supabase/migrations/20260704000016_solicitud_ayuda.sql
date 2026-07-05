-- ============================================================================
-- 84 (20260704000016) · Botón de AYUDA del socio (técnica / PR / máquina)
-- (000014 sigue reservado para la app; 000015 fue reparto de carga)
--
-- Diseño cerrado con el cliente 2026-07-05:
--   · El socio, desde su rutina, pide ayuda: motivo (técnica/PR/máquina/otra),
--     ejercicio (prellenado del día, editable) y UBICACIÓN EN TEXTO LIBRE
--     ("Piso 2, junto a los espejos") — NO hay mapeo de máquinas por piso.
--   · Modelo FIRST-CLAIM (distinto al reparto de carga): push a TODOS los
--     trainers presentes a la vez; el PRIMERO que toma la atiende (candado
--     atómico); a los demás se les cae el aviso.
--   · Sin trainers presentes → queda EN ESPERA (le llega al 1er que fiche) y
--     ADEMÁS avisa a RECEPCIÓN/ADMIN (campanita panel + push). Con trainers
--     presentes, recepción NO se entera (evita ruido).
--   · UNA ayuda activa por socio a la vez.
--   · Guarda tiempos (creado→tomado = llegada; →cerrado = duración) para
--     métricas de desempeño y bonos de productividad (backlog).
-- ============================================================================

create table if not exists public.solicitud_ayuda (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresa(id) on delete cascade,
  sede_id          uuid references public.sede(id) on delete set null,
  socio_id         uuid not null references public.socio(id) on delete cascade,
  motivo           text not null default 'tecnica'
                   check (motivo in ('tecnica','pr','maquina','otra')),
  ejercicio_nombre text,
  ubicacion_texto  text,               -- texto libre: "Piso 2, junto a los espejos"
  mensaje_socio    text,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','en_camino','atendida','cancelada')),
  atendida_por     uuid references public.usuario(id),
  creado_at        timestamptz not null default now(),
  tomada_at        timestamptz,        -- cuándo un trainer dijo "voy yo"
  cerrada_at       timestamptz         -- cuándo se marcó atendida/cancelada
);
create index if not exists idx_solicitud_ayuda_empresa on public.solicitud_ayuda(empresa_id, estado);
create index if not exists idx_solicitud_ayuda_socio on public.solicitud_ayuda(socio_id, estado);

-- Una sola ayuda ABIERTA por socio (pendiente o en_camino)
create unique index if not exists uq_ayuda_activa_por_socio
  on public.solicitud_ayuda(socio_id)
  where estado in ('pendiente','en_camino');

alter table public.solicitud_ayuda enable row level security;

-- El socio LEE lo suyo
drop policy if exists solicitud_ayuda_socio_sel on public.solicitud_ayuda;
create policy solicitud_ayuda_socio_sel on public.solicitud_ayuda
  for select to authenticated
  using (exists (select 1 from public.socio s
                  where s.id = socio_id and s.usuario_id = auth.uid()));

-- El socio CREA solo pendientes, a su nombre y en su gym
drop policy if exists solicitud_ayuda_socio_ins on public.solicitud_ayuda;
create policy solicitud_ayuda_socio_ins on public.solicitud_ayuda
  for insert to authenticated
  with check (
    estado = 'pendiente'
    and exists (select 1 from public.socio s
                 where s.id = socio_id and s.usuario_id = auth.uid()
                   and s.empresa_id = solicitud_ayuda.empresa_id)
  );

-- El socio puede CANCELAR la suya (update acotado por el trigger de abajo)
drop policy if exists solicitud_ayuda_socio_upd on public.solicitud_ayuda;
create policy solicitud_ayuda_socio_upd on public.solicitud_ayuda
  for update to authenticated
  using (exists (select 1 from public.socio s
                  where s.id = socio_id and s.usuario_id = auth.uid()));

-- El staff del gym lee todo lo de su empresa
drop policy if exists solicitud_ayuda_staff on public.solicitud_ayuda;
create policy solicitud_ayuda_staff on public.solicitud_ayuda
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

-- ── Alta: broadcast a presentes, o a recepción/admin si no hay nadie ────────
create or replace function public.trg_solicitud_ayuda_alta()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_socio record;
  v_motivo text;
  v_detalle text;
  v_usuario uuid;
  v_hay_presente boolean;
begin
  select nombre, sede_id into v_socio from public.socio where id = new.socio_id;
  v_motivo := case new.motivo
    when 'tecnica' then 'Técnica'
    when 'pr' then 'Récord (PR)'
    when 'maquina' then 'Máquina/equipo'
    else 'Ayuda' end;
  v_detalle := v_motivo
    || coalesce(' en ' || new.ejercicio_nombre, '')
    || coalesce(' · ' || new.ubicacion_texto, '');

  -- ¿Hay algún entrenador PRESENTE (entrada marcada hoy, sin salida)?
  -- Esto define el modelo mixto: no es lo mismo "presente" que "existe un
  -- trainer activo" — sin nadie fichado, recepción debe enterarse.
  select exists (
    select 1
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id
    join public.asistencia_staff a
      on a.empresa_id = ue.empresa_id and a.usuario_id = ue.usuario_id
    where ue.empresa_id = new.empresa_id and ue.activo and ro.codigo = 'entrenador'
      and a.fecha = (now() at time zone coalesce(
        (select zona_horaria from public.empresa where id = new.empresa_id), 'America/Lima'))::date
      and a.salida_at is null
  ) into v_hay_presente;

  -- Push a los TRAINERS disponibles (first-claim: el que llega primero la
  -- toma). staff_disponible ya prioriza presentes; si nadie fichó igual les
  -- llega (para que reaccionen), pero ADEMÁS se avisa a recepción abajo.
  for v_usuario in
    select * from public.staff_disponible(new.empresa_id, array['entrenador'])
  loop
    perform public.encolar_push(
      v_usuario,
      '🆘 ' || v_socio.nombre || ' pide ayuda',
      v_detalle || ' — toca "Voy yo" para atenderlo',
      jsonb_build_object('tipo', 'solicitud_ayuda', 'ayuda_id', new.id, 'socio_id', new.socio_id)
    );
  end loop;

  -- Sin ningún trainer PRESENTE → avisar a recepción/admin (panel + push).
  -- Con trainers presentes, recepción NO se entera (modelo mixto del cliente).
  if not v_hay_presente then
    insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
    values (new.empresa_id, v_socio.sede_id, 'solicitud_ayuda',
            '🆘 ' || v_socio.nombre || ' pide ayuda y no hay trainer presente',
            v_detalle || ' — no hay entrenadores con entrada marcada, apoya desde recepción',
            'warning', 'solicitud_ayuda', new.id);

    for v_usuario in
      select ue.usuario_id
      from public.usuario_empresa ue
      join public.rol ro on ro.id = ue.rol_id
      where ue.empresa_id = new.empresa_id and ue.activo
        and ro.codigo in ('admin', 'recepcion')
    loop
      perform public.encolar_push(
        v_usuario,
        '🆘 ' || v_socio.nombre || ' pide ayuda',
        v_detalle || ' — no hay trainer presente, apoya tú',
        jsonb_build_object('tipo', 'solicitud_ayuda', 'ayuda_id', new.id, 'socio_id', new.socio_id)
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_solicitud_ayuda_alta on public.solicitud_ayuda;
create trigger trg_solicitud_ayuda_alta
  after insert on public.solicitud_ayuda
  for each row execute function public.trg_solicitud_ayuda_alta();

-- ── FIRST-CLAIM atómico: el primero que reclama gana ────────────────────────
-- Devuelve {tomada: true, ...} al que gana; {tomada:false, motivo} al que
-- llega tarde. Cualquier staff del gym puede reclamar.
create or replace function public.tomar_ayuda(p_ayuda_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_fila public.solicitud_ayuda;
  v_socio_usuario uuid;
  v_nombre text;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;

  -- UPDATE condicional: solo pasa de 'pendiente' → 'en_camino' UNA vez
  update public.solicitud_ayuda
     set estado = 'en_camino', atendida_por = auth.uid(), tomada_at = now()
   where id = p_ayuda_id and empresa_id = v_empresa and estado = 'pendiente'
   returning * into v_fila;

  if v_fila.id is null then
    -- Ya la tomó otro (o no existe / no es de mi gym)
    return jsonb_build_object('tomada', false, 'motivo', 'Otro ya está atendiendo esta ayuda');
  end if;

  -- Avisar al socio que alguien va en camino
  select s.usuario_id, u.nombre into v_socio_usuario, v_nombre
  from public.socio s left join public.usuario u on u.id = auth.uid()
  where s.id = v_fila.socio_id;

  if v_socio_usuario is not null then
    perform public.encolar_push(
      v_socio_usuario,
      '💪 ' || coalesce(v_nombre, 'Tu trainer') || ' va en camino',
      'Ya viene a ayudarte con ' || coalesce(v_fila.ejercicio_nombre, 'tu ejercicio'),
      jsonb_build_object('tipo', 'solicitud_ayuda_en_camino', 'ayuda_id', v_fila.id)
    );
  end if;

  return jsonb_build_object('tomada', true, 'ayuda_id', v_fila.id, 'socio_id', v_fila.socio_id);
end;
$$;

-- ── Cerrar (atendida) — la marca el trainer que la tomó o cualquier admin ───
create or replace function public.cerrar_ayuda(p_ayuda_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_fila public.solicitud_ayuda;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  update public.solicitud_ayuda
     set estado = 'atendida', cerrada_at = now()
   where id = p_ayuda_id and empresa_id = v_empresa and estado = 'en_camino'
   returning * into v_fila;
  if v_fila.id is null then
    return jsonb_build_object('cerrada', false, 'motivo', 'La ayuda no está en camino');
  end if;
  return jsonb_build_object('cerrada', true, 'duracion_seg',
    extract(epoch from (v_fila.cerrada_at - v_fila.tomada_at))::int);
end;
$$;

-- ── El socio cancela la suya (solo si aún nadie la tomó) ─────────────────────
create or replace function public.cancelar_ayuda(p_ayuda_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_fila public.solicitud_ayuda;
begin
  update public.solicitud_ayuda
     set estado = 'cancelada', cerrada_at = now()
   where id = p_ayuda_id and estado = 'pendiente'
     and exists (select 1 from public.socio s
                  where s.id = solicitud_ayuda.socio_id and s.usuario_id = auth.uid())
   returning * into v_fila;
  if v_fila.id is null then
    return jsonb_build_object('cancelada', false, 'motivo', 'Ya fue tomada o no es tuya');
  end if;
  return jsonb_build_object('cancelada', true);
end;
$$;
