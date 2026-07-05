-- ============================================================================
-- 81 (20260704000012) · Solicitudes de carga (socio → trainer)
-- Origen: PEDIDO 6 de la app (llegó como 20260704000010, renumerada: ese
-- número ya lo usó el banco de ejercicios). Cambios sobre su borrador:
--   · El socio solo CREA (pendiente) y LEE lo suyo — su policy era FOR ALL,
--     con la que podía auto-aprobarse por API. Responder es solo del staff.
--   · Pushes servidor: alta → entrenadores del gym (+campanita del panel);
--     respuesta → push al socio con el veredicto. La app solo pinta.
-- ============================================================================

create table if not exists public.solicitud_carga (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresa(id) on delete cascade,
  socio_id            uuid not null references public.socio(id) on delete cascade,
  rutina_ejercicio_id uuid references public.rutina_ejercicio(id) on delete set null,
  ejercicio_nombre    text,
  carga_actual        text,
  carga_deseada       text,
  mensaje_socio       text,
  estado              text not null default 'pendiente'
                      check (estado in ('pendiente','aprobada','rechazada')),
  nota_trainer        text,
  respondido_por      uuid references public.usuario(id),
  creado_at           timestamptz not null default now(),
  respondido_at       timestamptz
);
create index if not exists idx_solicitud_carga_socio on public.solicitud_carga(socio_id);
create index if not exists idx_solicitud_carga_empresa on public.solicitud_carga(empresa_id, estado);

alter table public.solicitud_carga enable row level security;

-- El socio LEE lo suyo
drop policy if exists solicitud_carga_socio on public.solicitud_carga;
drop policy if exists solicitud_carga_socio_sel on public.solicitud_carga;
create policy solicitud_carga_socio_sel on public.solicitud_carga
  for select to authenticated
  using (exists (select 1 from public.socio s
                  where s.id = socio_id and s.usuario_id = auth.uid()));

-- El socio CREA solo pendientes, solo a su nombre y en SU gym
drop policy if exists solicitud_carga_socio_ins on public.solicitud_carga;
create policy solicitud_carga_socio_ins on public.solicitud_carga
  for insert to authenticated
  with check (
    estado = 'pendiente'
    and exists (select 1 from public.socio s
                 where s.id = socio_id and s.usuario_id = auth.uid()
                   and s.empresa_id = solicitud_carga.empresa_id)
  );

-- El staff del gym lee y RESPONDE
drop policy if exists solicitud_carga_staff on public.solicitud_carga;
create policy solicitud_carga_staff on public.solicitud_carga
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

comment on table public.solicitud_carga is
  'El socio pide subir de peso; el trainer aprueba o responde con observación. Historial de progresión.';

-- ── Alta: campanita del panel + push a los entrenadores del gym ────────────
create or replace function public.trg_solicitud_carga_alta()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_socio record;
  v_detalle text;
  r record;
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

  for r in
    select ue.usuario_id
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id
    where ue.empresa_id = new.empresa_id and ue.activo
      and ro.codigo = 'entrenador'
  loop
    perform public.encolar_push(
      r.usuario_id,
      '🏋️ ' || v_socio.nombre || ' quiere subir de carga',
      v_detalle || ' — respóndele desde la app',
      jsonb_build_object('tipo', 'solicitud_carga', 'solicitud_id', new.id, 'socio_id', new.socio_id)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_solicitud_carga_alta on public.solicitud_carga;
create trigger trg_solicitud_carga_alta
  after insert on public.solicitud_carga
  for each row execute function public.trg_solicitud_carga_alta();

-- ── Respuesta: sella quién/cuándo y push al socio con el veredicto ─────────
create or replace function public.trg_solicitud_carga_respuesta()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_usuario uuid;
begin
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

drop trigger if exists trg_solicitud_carga_respuesta on public.solicitud_carga;
create trigger trg_solicitud_carga_respuesta
  before update on public.solicitud_carga
  for each row execute function public.trg_solicitud_carga_respuesta();
