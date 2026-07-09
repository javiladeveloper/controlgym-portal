-- PEDIDO 16 (app) — Métodos de check-in configurables por gimnasio.
-- Diseño de la app: docs/superpowers/specs/...metodos-checkin-configurables.
-- Handoff: controlgym-app/docs/CHECKIN-METODOS-BACKEND-HANDOFF.md
--
-- AJUSTE DEL PANEL: la migración original de la app creaba una tabla `checkin`
-- NUEVA, pero YA EXISTE una `checkin` con datos en uso (feed del Dashboard:
-- sede_id, direccion, resultado, metodo, ocurrido_en, socio_id). En vez de
-- chocar/duplicar, ADAPTAMOS: agregamos a la tabla existente las columnas que
-- el pedido necesita (usuario_id, rol) y reusamos las que ya sirven
-- (direccion=entrada/salida ≈ tipo; metodo ya existe como text). Así los 67
-- registros y el Dashboard siguen intactos, y hay UNA sola tabla de accesos.

-- 1. Tipo enumerado de método (extensible)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'metodo_checkin') then
    create type public.metodo_checkin as enum (
      'sin_control', 'qr_kiosco', 'qr_lector', 'biometrico', 'boton_app'
    );
  end if;
end $$;

-- 2. Método de acceso del gym (default seguro = comportamiento actual)
alter table public.empresa
  add column if not exists metodo_checkin public.metodo_checkin not null default 'boton_app';

-- 3. Backfill desde el flag actual (una sola vez, respeta lo que ya había)
update public.empresa set metodo_checkin = 'qr_kiosco'  where usa_carnet_qr is true  and metodo_checkin = 'boton_app';
update public.empresa set metodo_checkin = 'boton_app'  where usa_carnet_qr is false;

-- 4. usa_carnet_qr pasa a ser DERIVADA de metodo_checkin (cero rupturas: las
--    apps/consultas que lean usa_carnet_qr siguen viendo un booleano correcto).
create or replace function public.sync_usa_carnet_qr() returns trigger
language plpgsql as $$
begin
  new.usa_carnet_qr := new.metodo_checkin in ('qr_kiosco', 'qr_lector');
  return new;
end $$;

drop trigger if exists trg_sync_usa_carnet_qr on public.empresa;
create trigger trg_sync_usa_carnet_qr
  before insert or update of metodo_checkin on public.empresa
  for each row execute function public.sync_usa_carnet_qr();

-- 5. PIN de salida del modo kiosco (config del gym; la app lo lee del bootstrap)
alter table public.empresa
  add column if not exists pin_kiosco text;

-- 6. Adaptar la tabla `checkin` EXISTENTE (no crear una nueva):
--    · usuario_id: el pedido registra accesos de socios Y staff por usuario.
--      La tabla existente solo tenía socio_id (para socios); agregamos
--      usuario_id para cubrir al staff (trainer/recepción) también.
--    · rol: 'socio' | 'entrenador' | 'recepcion' (quién hizo el check-in).
--    · metodo pasa de text libre a validado contra el enum (columna nueva
--      metodo_tipo; conservamos la vieja `metodo` text para no romper el feed).
--    Mapeo de conceptos del pedido a lo existente:
--      · pedido.tipo (entrada/salida) → columna existente `direccion`
--      · pedido.origen               → columna nueva `origen`
alter table public.checkin
  add column if not exists usuario_id  uuid references public.usuario(id),
  add column if not exists rol         text,
  add column if not exists metodo_tipo public.metodo_checkin,
  add column if not exists origen      text;

create index if not exists idx_checkin_usuario_fecha
  on public.checkin (usuario_id, ocurrido_en);

comment on column public.checkin.usuario_id is 'Usuario (socio o staff) que hizo el check-in — el pedido de métodos de acceso unifica socios y staff.';
comment on column public.checkin.rol is 'socio | entrenador | recepcion — quién hizo el acceso.';
comment on column public.checkin.metodo_tipo is 'Método validado (enum). La columna `metodo` (text) se conserva para el feed del Dashboard.';

-- Pendiente (siguiente paso, no en esta migración):
--   · RPC registrar_checkin(p_token, p_origen, p_dispositivo) con validación
--     HMAC del token y toggle entrada/salida + abrir/cerrar turno del staff.
--   · RLS de checkin para escritura del kiosco (staff registra accesos de SU empresa).
--   · FASE 2: empresa_api_key + POST /api/checkin/hardware.
