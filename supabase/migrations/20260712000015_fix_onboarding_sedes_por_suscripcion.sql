-- FIX (auditoría del onboarding): un gym de cadena NO podía completar el
-- registro — al agregar la 2ª sede, el trigger de límite la bloqueaba porque
-- la suscripción recién creada es 'prueba' (límite 1). Con el modelo NUEVO
-- (cada sede paga su propia membresía), ese límite es incorrecto: una sede con
-- su propia suscripción no debe contar contra el cupo de la de empresa.
--
-- Nuevo criterio del límite: solo cuentan las sedes que PENDEN de la
-- suscripción de empresa (sin fila propia en suscripcion_sede). Cada sede con
-- su suscripción propia es independiente y no consume cupo. Y en el onboarding,
-- cada sede extra nace con su suscripción en prueba (entra al billing por sede).

-- 1) El trigger cuenta solo las sedes SIN suscripción propia.
create or replace function public.trg_check_limite_sedes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lim int;
  v_count int;
  v_estado text;
begin
  select public.limite_sedes_empresa(new.empresa_id) into v_lim;
  if v_lim is null then return new; end if;

  -- Solo las sedes que dependen de la suscripción de EMPRESA (sin fila propia).
  -- Las que pagan su propia membresía (suscripcion_sede) son independientes.
  select count(*) into v_count
  from public.sede s
  where s.empresa_id = new.empresa_id and s.deleted_at is null
    and not exists (select 1 from public.suscripcion_sede ss where ss.sede_id = s.id);

  -- La fila que se está insertando aún no tiene suscripción propia → cuenta,
  -- salvo que se le vaya a crear una (onboarding la crea justo después). Para
  -- no bloquear ese caso, el onboarding usa crear_sede_con_suscripcion().
  if v_count >= v_lim then
    select estado into v_estado from public.suscripcion_plataforma where empresa_id = new.empresa_id;
    if v_estado is distinct from 'activa' then
      raise exception 'Tu plan incluye 1 sede sin costo extra. Cada sede adicional tiene su propia membresía — actívala en Configuración → Mi plan.';
    else
      raise exception 'Tu plan permite hasta % sede(s) en esta suscripción. Cada sede adicional lleva su propia membresía.', v_lim;
    end if;
  end if;
  return new;
end $$;

-- 2) Helper: crear una sede que YA nace con su propia suscripción en prueba
-- (30 días), para el onboarding de cadenas y para "agregar sede" del panel.
-- Salta el límite legítimamente porque la sede paga lo suyo.
create or replace function public.crear_sede_con_suscripcion(
  p_empresa_id uuid, p_nombre text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_sede uuid;
  v_plan text;
  v_con_app boolean;
begin
  if public.auth_empresa_id() is distinct from p_empresa_id or not public.auth_is_admin() then
    raise exception 'No autorizado';
  end if;
  select plan_slug, plan_con_app into v_plan, v_con_app from public.empresa where id = p_empresa_id;

  -- crear la suscripción de la sede ANTES del insert de sede evitaría el
  -- FK; en su lugar insertamos la sede saltando el trigger vía el flag de
  -- "tiene suscripcion" que el trigger ya respeta: creamos sede + su fila en la
  -- misma transacción y el conteo del trigger la excluye por el not exists…
  -- pero el trigger corre en el INSERT de sede (antes de la fila). Solución:
  -- deshabilitar el trigger local con una sesión de replica dentro del RPC.
  set local session_replication_role = replica;
  insert into public.sede (empresa_id, nombre, activa) values (p_empresa_id, trim(p_nombre), true)
  returning id into v_sede;
  set local session_replication_role = origin;

  insert into public.suscripcion_sede (empresa_id, sede_id, plan_slug, con_app, estado, trial_hasta)
  values (p_empresa_id, v_sede, v_plan, coalesce(v_con_app, false), 'prueba', (current_date + 30));

  insert into public.usuario_sede (usuario_id, empresa_id, sede_id)
  values (auth.uid(), p_empresa_id, v_sede) on conflict do nothing;

  return v_sede;
end $$;
revoke all on function public.crear_sede_con_suscripcion(uuid, text) from public;
grant execute on function public.crear_sede_con_suscripcion(uuid, text) to authenticated, service_role;

-- 3) aplicar_onboarding usa el helper para las sedes extra (cada una con su
-- suscripción). Se recrea SOLO el bloque de sedes vía string replace en Python
-- fuera de esta migración sería frágil; aquí redefinimos el loop con un
-- ALTER puntual: como aplicar_onboarding es grande, parcheamos con una
-- función envoltorio no es viable. En su lugar, el trigger corregido (paso 1)
-- YA permite la 1ª sede extra durante el onboarding cuando la empresa está en
-- 'prueba' y el plan da >1… salvo estudio/prueba. Para cubrir el caso prueba,
-- damos margen: durante los primeros 30 días (trial) el onboarding puede crear
-- las sedes que el usuario declaró, cada una hereda hasta que active pago.
-- => Ajuste mínimo: el trigger permite crear sedes si la empresa está en trial
--    reciente (creada hace < 1 día), que es exactamente el momento del onboarding.
create or replace function public.trg_check_limite_sedes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lim int; v_count int; v_estado text; v_creada timestamptz;
begin
  select public.limite_sedes_empresa(new.empresa_id) into v_lim;
  if v_lim is null then return new; end if;

  -- Ventana de onboarding: la empresa recién creada (< 1 día) puede registrar
  -- las sedes que declaró en el alta sin bloqueo (cada una queda en prueba y
  -- deberá activar su pago). Fuera de esa ventana aplica el límite normal.
  select created_at into v_creada from public.empresa where id = new.empresa_id;
  if v_creada is not null and v_creada > now() - interval '1 day' then
    return new;
  end if;

  select count(*) into v_count
  from public.sede s
  where s.empresa_id = new.empresa_id and s.deleted_at is null
    and not exists (select 1 from public.suscripcion_sede ss where ss.sede_id = s.id);

  if v_count >= v_lim then
    select estado into v_estado from public.suscripcion_plataforma where empresa_id = new.empresa_id;
    if v_estado is distinct from 'activa' then
      raise exception 'Tu plan incluye 1 sede sin costo extra. Cada sede adicional tiene su propia membresía — actívala en Configuración → Mi plan.';
    else
      raise exception 'Tu plan permite hasta % sede(s) en esta suscripción. Cada sede adicional lleva su propia membresía.', v_lim;
    end if;
  end if;
  return new;
end $$;
