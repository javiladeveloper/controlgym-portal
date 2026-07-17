-- Correcciones de la revisión de la entrega de billing. Todo esto ya estaba
-- desplegado, así que son fixes en caliente.

-- ── 1. CRÍTICO: las RPC de billing eran ejecutables por cualquier gym ───────
-- `revoke all ... from public` no bastaba: 20260712000006_auditoria_seguridad
-- fija un DEFAULT PRIVILEGE que concede execute a `authenticated` en CADA
-- función nueva del esquema, y create-or-replace lo reaplica. Resultado: un gym
-- con sesión podía llamar marcar_factura_pagada() y perdonarse la deuda,
-- emitir_facturas_periodo() para endeudar a otros, o vencer_facturas() para
-- bloquear la plataforma entera. Hay que revocar explícitamente a authenticated.
revoke all on function public.marcar_factura_pagada(uuid,uuid) from public, authenticated;
revoke all on function public.emitir_facturas_periodo(date) from public, authenticated;
revoke all on function public.vencer_facturas() from public, authenticated;
grant execute on function public.marcar_factura_pagada(uuid,uuid) to service_role;
grant execute on function public.emitir_facturas_periodo(date) to service_role;
grant execute on function public.vencer_facturas() to service_role;

-- ── 2. CRÍTICO: estado_suscripcion_sede escribe pero se declaró STABLE ──────
-- Marca el trial vencido al vuelo (un UPDATE) — heredado de la versión
-- original. Mientras solo la llamaba el panel nadie lo notó; ahora la policy
-- socio_app_self la invoca por fila vía sede_con_app, y Postgres aborta:
-- "UPDATE is not allowed in a non-volatile function". El día que venciera un
-- trial, los socios de esa sede dejarían de leer su propia fila.
--
-- Se parte en dos: una función de LECTURA pura (la que usan policy y panel) y
-- el efecto secundario de marcar trials, que pasa a vencer_trials_sede() y la
-- corre el cron. Un SELECT no debe escribir.
create or replace function public.estado_suscripcion_sede(p_sede_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid;
  v_ss public.suscripcion_sede;
  v_emp_sus public.suscripcion_plataforma;
  v_estado text; v_con_app boolean; v_origen text;
begin
  select empresa_id into v_emp from public.sede where id = p_sede_id;
  if v_emp is null then return jsonb_build_object('encontrado', false); end if;

  select * into v_ss from public.suscripcion_sede where sede_id = p_sede_id;
  if v_ss.id is not null then
    v_estado := v_ss.estado; v_con_app := v_ss.con_app; v_origen := 'sede';
    -- Trial vencido: se REPORTA como vencida sin escribir. El UPDATE real lo
    -- hace vencer_trials_sede() desde el cron.
    if v_estado = 'prueba' and v_ss.trial_hasta is not null and v_ss.trial_hasta < current_date then
      v_estado := 'vencida';
    end if;
  else
    select * into v_emp_sus from public.suscripcion_plataforma where empresa_id = v_emp;
    v_estado := coalesce(v_emp_sus.estado, 'prueba');
    v_con_app := coalesce(v_emp_sus.con_app, false);
    v_origen := 'empresa';
  end if;

  return jsonb_build_object(
    'encontrado', true, 'sede_id', p_sede_id, 'estado', v_estado,
    'con_app', v_con_app,
    -- impaga entra: el gym ve sus datos, pero no opera.
    'activa', v_estado in ('prueba','activa','impaga'),
    'solo_lectura', v_estado = 'impaga',
    'origen', v_origen
  );
end $$;
revoke all on function public.estado_suscripcion_sede(uuid) from public;
grant execute on function public.estado_suscripcion_sede(uuid) to authenticated, service_role;

create or replace function public.vencer_trials_sede()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.suscripcion_sede
     set estado = 'vencida'
   where estado = 'prueba' and trial_hasta is not null and trial_hasta < current_date;
  get diagnostics v_n = row_count;
  return jsonb_build_object('trials_vencidos', v_n);
end $$;
revoke all on function public.vencer_trials_sede() from public, authenticated;
grant execute on function public.vencer_trials_sede() to service_role;

-- ── 3. CRÍTICO: vencer_facturas bloqueaba sedes al día ──────────────────────
-- Dos errores. El insert tomaba TODA factura 'vencida' y le pisaba plan y monto
-- a la sede (`select ... 'miembros', false, 0`). Y sobre todo: bloqueaba por el
-- estado de la FACTURA, cuando 'vencida' es terminal — al pagar pasa a 'pagada',
-- pero una factura anulada o de un plan viejo se queda 'vencida' para siempre.
-- Resultado: una sede en Pro, al día, con una factura vencida histórica quedaba
-- 'impaga' y se re-bloqueaba cada noche.
--
-- Este cobro solo gobierna al plan 'miembros': una sede en plan fijo paga por
-- suscripción y jamás debe bloquearse por aquí. Se restringe al plan vigente de
-- la sede, y solo el estado se toca.
create or replace function public.vencer_facturas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_b int;
begin
  -- Solo vencen las facturas de sedes que HOY siguen en plan miembros: si el
  -- gym migró a un plan fijo, su factura pendiente se cobra aparte, no bloquea.
  update public.factura_sede f
     set estado = 'vencida'
   where f.estado = 'emitida' and f.vence_el < current_date
     and exists (
       select 1 from public.sede s
       join public.empresa e on e.id = s.empresa_id
       left join public.suscripcion_sede ss on ss.sede_id = s.id
       where s.id = f.sede_id and coalesce(ss.plan_slug, e.plan_slug) = 'miembros');
  get diagnostics v_n = row_count;

  with morosas as (
    select distinct f.empresa_id, f.sede_id
    from public.factura_sede f
    join public.sede s on s.id = f.sede_id
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where f.estado = 'vencida'
      and coalesce(ss.plan_slug, e.plan_slug) = 'miembros'   -- el plan manda
  ),
  ins as (
    insert into public.suscripcion_sede (empresa_id, sede_id, plan_slug, con_app, monto, estado)
    select m.empresa_id, m.sede_id, 'miembros', false, 0, 'impaga' from morosas m
    on conflict (sede_id) do update
      set estado = 'impaga'          -- solo el estado: no se pisa plan ni monto
    returning 1
  )
  select count(*) into v_b from ins;

  return jsonb_build_object('vencidas', v_n, 'sedes_bloqueadas', v_b);
end $$;
revoke all on function public.vencer_facturas() from public, authenticated;
grant execute on function public.vencer_facturas() to service_role;

-- ── 4. ALTO: no se bloqueaba REGISTRAR COBROS ──────────────────────────────
-- El spec pedía bloquear 3 operaciones; solo había triggers en socio, membresia
-- y checkin. El dinero entra por movimiento_financiero, que quedó sin trigger:
-- un gym impago seguía cobrando. Es la pata principal del bloqueo.
drop trigger if exists trg_impaga_movimiento on public.movimiento_financiero;
create trigger trg_impaga_movimiento before insert on public.movimiento_financiero
  for each row execute function public.trg_bloquea_si_impaga();

-- ── 5. ALTO: un mes saltado no se recuperaba nunca ─────────────────────────
-- emitir_facturas_periodo() solo mira "mes actual − 1": si el cron falla los
-- primeros días de agosto y se recupera en septiembre, julio no se emite jamás.
-- Esta función emite TODO periodo cerrado que falte (hasta 6 meses atrás), así
-- un hueco se recupera solo. Idempotente por unique(sede_id, periodo).
create or replace function public.emitir_facturas_pendientes(p_meses_atras int default 6)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_res jsonb := '[]'::jsonb;
  v_periodo date;
  i int;
begin
  -- del más viejo al más nuevo, para que la deuda quede en orden cronológico
  for i in reverse greatest(p_meses_atras, 1) .. 1 loop
    v_periodo := (date_trunc('month', current_date) - (i || ' months')::interval)::date;
    v_res := v_res || jsonb_build_array(public.emitir_facturas_periodo(v_periodo));
  end loop;
  return jsonb_build_object('periodos', v_res);
end $$;
revoke all on function public.emitir_facturas_pendientes(int) from public, authenticated;
grant execute on function public.emitir_facturas_pendientes(int) to service_role;

-- ── 6. MEDIO: anular una factura dejaba la sede bloqueada para siempre ─────
-- marcar_factura_pagada era el único camino de reactivación. Anular (cortesía,
-- error de conteo, gym que se va) dejaba 'impaga' sin salida. Ahora la
-- reactivación es una función propia que mira si queda deuda REAL, y la llaman
-- tanto el pago como la anulación.
create or replace function public.reactivar_si_sin_deuda(p_sede_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_debe int;
begin
  select count(*) into v_debe from public.factura_sede
   where sede_id = p_sede_id and estado in ('emitida','vencida');
  if v_debe = 0 then
    update public.suscripcion_sede set estado = 'activa'
     where sede_id = p_sede_id and estado = 'impaga';
    return true;
  end if;
  return false;
end $$;
revoke all on function public.reactivar_si_sin_deuda(uuid) from public, authenticated;
grant execute on function public.reactivar_si_sin_deuda(uuid) to service_role;

create or replace function public.marcar_factura_pagada(p_factura_id uuid, p_pago_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sede uuid; v_debe int;
begin
  update public.factura_sede
     set estado = 'pagada', pagada_at = now(), pago_id = p_pago_id
   where id = p_factura_id and estado in ('emitida','vencida')
   returning sede_id into v_sede;
  if v_sede is null then
    return jsonb_build_object('ok', false, 'error', 'factura no encontrada o ya pagada');
  end if;

  perform public.reactivar_si_sin_deuda(v_sede);
  select count(*) into v_debe from public.factura_sede
   where sede_id = v_sede and estado in ('emitida','vencida');
  return jsonb_build_object('ok', true, 'sede_id', v_sede, 'facturas_pendientes', v_debe);
end $$;
revoke all on function public.marcar_factura_pagada(uuid,uuid) from public, authenticated;
grant execute on function public.marcar_factura_pagada(uuid,uuid) to service_role;

create or replace function public.anular_factura(p_factura_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_sede uuid;
begin
  update public.factura_sede set estado = 'anulada'
   where id = p_factura_id and estado in ('emitida','vencida')
   returning sede_id into v_sede;
  if v_sede is null then
    return jsonb_build_object('ok', false, 'error', 'factura no encontrada o ya cerrada');
  end if;
  perform public.reactivar_si_sin_deuda(v_sede);   -- sin deuda: vuelve a operar
  return jsonb_build_object('ok', true, 'sede_id', v_sede);
end $$;
revoke all on function public.anular_factura(uuid,text) from public, authenticated;
grant execute on function public.anular_factura(uuid,text) to service_role;

-- ── 7. MEDIO: el plan gratis se bloqueaba al vencer el trial ───────────────
-- elegir_plan nunca tocaba `estado`: un gym que elegía Miembros quedaba en
-- 'prueba' → a los 30 días 'vencida' → bloqueado por no pagar un plan gratis.
-- Miembros no necesita trial: ya es gratis por definición.
create or replace function public.elegir_plan(
  p_empresa_id uuid, p_plan text, p_con_app boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_con_app boolean;
begin
  if p_plan not in ('estudio','crecimiento','pro','cadena','academia','ninos','trainer','miembros') then
    raise exception 'Plan inválido';
  end if;
  if not exists (
    select 1 from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id
    where ue.usuario_id = auth.uid() and ue.empresa_id = p_empresa_id
      and ue.activo = true and r.codigo = 'admin'
  ) then
    raise exception 'Solo un administrador del gimnasio puede cambiar el plan';
  end if;

  v_con_app := case
    when p_plan in ('estudio','crecimiento','pro','cadena') then true
    when p_plan = 'miembros' then false
    else coalesce(p_con_app, false)
  end;

  update public.empresa
  set plan_slug = p_plan, plan_con_app = v_con_app
  where id = p_empresa_id;

  update public.suscripcion_plataforma
  set plan_slug = p_plan,
      con_app = v_con_app,
      monto = public.precio_plan(p_plan, v_con_app),
      -- Miembros no tiene cuota: no hay trial que correr ni que vencer. Se pasa
      -- a 'activa' salvo que la cuenta esté cancelada.
      estado = case when p_plan = 'miembros' and estado in ('prueba','vencida')
                    then 'activa' else estado end,
      trial_hasta = case when p_plan = 'miembros' then null else trial_hasta end
  where empresa_id = p_empresa_id
    and estado <> 'activa';

  -- Mismo criterio para las sedes en plan miembros.
  update public.suscripcion_sede
  set estado = 'activa', trial_hasta = null
  where empresa_id = p_empresa_id and p_plan = 'miembros'
    and estado in ('prueba','vencida');
end $$;

-- ── 8. Consumo del mes en curso: que el gym NO se entere al recibir la factura
-- Sin esto el panel muestra "S/ 0 al mes" durante todo el mes y el día 1 le cae
-- la factura. Devuelve lo que lleva gastado HOY cada sede en plan miembros.
create or replace function public.mi_consumo_actual()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sede_id', s.id, 'sede_nombre', s.nombre,
      'socios', public.contar_socios_facturables(s.id, current_date),
      'monto', public.contar_socios_facturables(s.id, current_date) * public.precio_por_socio(),
      'se_cobra_el', (date_trunc('month', current_date) + interval '1 month')::date
    ) order by s.created_at)
    from public.sede s
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where s.empresa_id = v_emp and s.deleted_at is null and s.activa
      and coalesce(ss.plan_slug, e.plan_slug) = 'miembros'
  ), '[]'::jsonb);
end $$;
revoke all on function public.mi_consumo_actual() from public;
grant execute on function public.mi_consumo_actual() to authenticated, service_role;
