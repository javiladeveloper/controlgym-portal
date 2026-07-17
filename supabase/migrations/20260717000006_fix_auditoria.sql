-- Correcciones de la auditoría independiente. Lo grave que sobrevivió a la
-- primera revisión.

-- ── 1. CRÍTICO: el gate de la app no existía en la práctica ────────────────
-- El gate se puso en la policy `socio_app_self`, con el argumento de que era
-- "el único punto por el que pasan todas las lecturas". Falso: un RPC SECURITY
-- DEFINER NO pasa por RLS. get_mi_app_bootstrap (el RPC principal de la app),
-- catalogo_app y mi_qr entregaban el gym completo — incluido el QR de puerta —
-- a los socios de un gym en plan sin app. La promesa que vendemos ("tus socios
-- no se conectan a la app") era falsa y ningún gym necesitaba pagar por la app.
--
-- El gate va DENTRO de cada RPC que entrega datos del gym al socio. La policy
-- se queda como defensa en profundidad, no como única barrera.

-- Bootstrap de la app: solo gyms cuya sede tenga la app contratada.
create or replace function public.get_mi_app_bootstrap()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  return jsonb_build_object(
    'gimnasios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'socio', jsonb_build_object('id', s.id, 'codigo', s.codigo, 'nombre', s.nombre, 'estado', s.estado, 'sede_id', s.sede_id, 'documento', s.documento, 'telefono', s.telefono, 'email', s.email, 'objetivo_nota', s.objetivo_nota, 'objetivo_id', s.objetivo_id, 'foto_url', s.foto_url, 'foto_estado', s.foto_estado, 'fecha_nacimiento', s.fecha_nacimiento),
        'empresa', (select jsonb_build_object('id', e.id, 'nombre', e.nombre, 'slug', e.slug, 'eslogan', e.eslogan,
                      'direccion', e.direccion, 'telefono', e.telefono_contacto, 'horario', e.horario,
                      'horario_atencion', e.horario_atencion, 'redes', e.redes, 'moneda', e.moneda, 'usa_carnet_qr', e.usa_carnet_qr,
                      'cobros_habilitados', exists(select 1 from public.empresa_mp mp where mp.empresa_id = e.id),
                      'evento_social_activo', coalesce(e.evento_social_activo, false),
                      'evento_social', e.evento_social,
                      'restringe_sede', coalesce(e.restringe_sede, false),
                      'sede_nombre', (select se.nombre from public.sede se where se.id = s.sede_id),
                      'croquis_url', (select se.croquis_url from public.sede se where se.id = s.sede_id),
                      'unidad_peso', e.unidad_peso, 'unidad_talla', e.unidad_talla)
                    from public.empresa e where e.id = s.empresa_id),
        'tema', (select to_jsonb(t) - 'created_at' - 'updated_at' from public.empresa_tema t where t.empresa_id = s.empresa_id),
        'membresia', (select jsonb_build_object('id', m.id, 'estado', m.estado, 'fecha_fin', m.fecha_fin,
                        'plan', p.nombre, 'incluye_clases', p.incluye_clases, 'incluye_rutina', p.incluye_rutina,
                        'total', coalesce(m.precio_pagado,0) + coalesce(m.matricula_pagada,0),
                        'saldo', greatest(0, coalesce(m.precio_pagado,0) + coalesce(m.matricula_pagada,0) - coalesce(m.monto_pagado,0)))
                      from public.membresia m join public.plan p on p.id = m.plan_id
                      where m.socio_id = s.id and m.deleted_at is null
                      order by (m.estado = 'activa') desc, m.fecha_fin desc limit 1),
        'rutina_id', (select r.id from public.rutina r where r.socio_id = s.id and r.enviado_at is not null and r.activa order by r.updated_at desc limit 1),
        'dieta_id', (select d.id from public.dieta d where d.socio_id = s.id and d.enviado_at is not null and d.activa order by d.updated_at desc limit 1)
      ) order by s.created_at)
      from public.socio s
      where s.usuario_id = v_uid and s.deleted_at is null
        and public.sede_con_app(s.sede_id)     -- ← el gym debe tener la app
    ), '[]'::jsonb)
  );
end;
$function$;

-- QR de acceso: no se emite para un gym sin app.
create or replace function public.mi_qr(p_empresa_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_socio public.socio;
  v_exp bigint := extract(epoch from now() + interval '7 days')::bigint;
  v_base text;
  v_firma text;
begin
  select * into v_socio from public.socio
   where usuario_id = auth.uid() and deleted_at is null
     and (p_empresa_id is null or empresa_id = p_empresa_id)
     and public.sede_con_app(sede_id)          -- ← sin app no hay QR de puerta
   limit 1;
  if v_socio.id is null then raise exception 'No estás vinculado como socio'; end if;

  v_base := v_socio.id || '.' || v_socio.empresa_id || '.' || v_exp;
  select encode(extensions.hmac(v_base, valor, 'sha256'), 'hex') into v_firma
  from privado.secreto where clave = 'qr_secret';

  return jsonb_build_object('qr', 'FC1.' || v_base || '.' || v_firma,
                            'socio', v_socio.nombre,
                            'expira', v_exp);
end;
$function$;

-- Catálogo/tienda: ya validaba que el llamante fuera socio del gym; le faltaba
-- exigir que la sede tenga la app (si no, la tienda del gym sigue viva en un
-- plan que no la incluye).
create or replace function public.catalogo_app(p_empresa_id uuid, p_sede_id uuid default null)
returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(to_jsonb(t) order by t.precio), '[]'::jsonb)
  from (
    select distinct on (p.id)
           p.id, p.nombre, p.categoria, p.precio, p.imagen_url, p.descripcion, p.beneficio,
           p.descuento_tipo, p.descuento_valor,
           case when p.descuento_tipo = 'porcentaje' and coalesce(p.descuento_valor, 0) > 0
                  then round(p.precio * (1 - p.descuento_valor / 100), 2)
                when p.descuento_tipo = 'monto' and coalesce(p.descuento_valor, 0) > 0
                  then greatest(0, round(p.precio - p.descuento_valor, 2))
                else p.precio
           end as precio_final
      from public.producto p
      join public.inventario_sede i
        on i.producto_id = p.id
       and (p_sede_id is null or i.sede_id = p_sede_id)
     where p.empresa_id = p_empresa_id
       and p.visible_en_app = true
       and p.activo = true
       and p.deleted_at is null
       and i.stock > 0
       -- El socio solo ve el catálogo de un gym donde ES socio (no de cualquiera)
       -- y cuya sede tenga la app contratada.
       and exists (
         select 1 from public.socio s
          where s.usuario_id = auth.uid()
            and s.empresa_id = p_empresa_id
            and s.deleted_at is null
            and public.sede_con_app(s.sede_id)
       )
     order by p.id, p.precio
  ) t;
$function$;

-- ── 2. ALTO: el bloqueo 'impaga' se evadía por UPDATE ──────────────────────
-- Los triggers eran BEFORE INSERT. Un gym impago extendía por PostgREST la
-- fecha_fin de sus membresías (renovar SIN insertar) y revivía socios borrados:
-- nunca insertaba, nunca se bloqueaba, seguía operando sin pagar.
-- Renovar una membresía ES operar. Editar otros datos (nombre, teléfono) sigue
-- permitido: el gym debe poder corregir sus datos mientras regulariza.
-- Una función POR TABLA, no una compartida: plpgsql evalúa `new.fecha_fin`
-- aunque el `and tg_table_name='membresia'` sea falso, así que un trigger
-- compartido explota al correr sobre socio ("record new has no field fecha_fin").
create or replace function public.trg_bloquea_renovacion_si_impaga()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;                  -- backend/cron
  -- Solo la renovación (extender vigencia) equivale a operar. Corregir el resto
  -- de la membresía sigue permitido mientras regulariza.
  if new.fecha_fin is not distinct from old.fecha_fin then return new; end if;
  if new.sede_id is not null and public.sede_solo_lectura(new.sede_id) then
    raise exception 'Tu sede está en modo solo lectura por una factura pendiente. Paga en Configuración → Mi plan para volver a operar.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.trg_bloquea_revivir_si_impaga()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  -- Revivir a un socio dado de baja es un alta encubierta. Editar sus datos no.
  if not (old.deleted_at is not null and new.deleted_at is null) then return new; end if;
  if new.sede_id is not null and public.sede_solo_lectura(new.sede_id) then
    raise exception 'Tu sede está en modo solo lectura por una factura pendiente. Paga en Configuración → Mi plan para volver a operar.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_impaga_membresia_upd on public.membresia;
create trigger trg_impaga_membresia_upd before update on public.membresia
  for each row execute function public.trg_bloquea_renovacion_si_impaga();

drop trigger if exists trg_impaga_socio_upd on public.socio;
create trigger trg_impaga_socio_upd before update on public.socio
  for each row execute function public.trg_bloquea_revivir_si_impaga();

-- ── 3. CRÍTICO: se cobraba deuda inventada a gyms que no existían ──────────
-- emitir_facturas_pendientes(6) iteraba 6 meses atrás y emitía factura por todo
-- periodo, sin saber desde cuándo la sede está en plan miembros. Un gym que se
-- registra hoy con socios de membresía anual (data histórica migrada) recibía 6
-- facturas ya vencidas en su primer cron y quedaba bloqueado antes de empezar.
-- Peor: un gym que migra de Pro a Miembros pagaba dos veces los meses ya pagados.
--
-- Se registra DESDE CUÁNDO la sede está en el plan, y no se emite nada anterior
-- a eso ni a la creación de la sede.
alter table public.suscripcion_sede
  add column if not exists plan_desde date not null default current_date;

comment on column public.suscripcion_sede.plan_desde is
  'Desde cuándo la sede está en su plan actual. El cobro por miembro nunca factura periodos anteriores: evita cobrar meses en que el gym no existía o pagaba otro plan.';

-- Al cambiar de plan se resetea (lo hace elegir_plan más abajo).
create or replace function public.emitir_facturas_periodo(p_periodo date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_periodo date := coalesce(date_trunc('month', p_periodo)::date,
                             (date_trunc('month', current_date) - interval '1 month')::date);
  v_corte date := (date_trunc('month', v_periodo) + interval '1 month - 1 day')::date;
  v_precio numeric := public.precio_por_socio();
  v_emitidas int := 0; v_saltadas int := 0;
  r record;
  v_n int; v_ins int;
begin
  for r in
    select s.id as sede_id, s.empresa_id
    from public.sede s
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where s.deleted_at is null and s.activa
      and coalesce(ss.plan_slug, e.plan_slug) = 'miembros'
      -- No facturar periodos anteriores a que la sede existiera o entrara al
      -- plan: sería cobrar por un servicio que no se prestó.
      and v_corte >= coalesce(ss.plan_desde, s.created_at::date)
      and v_corte >= s.created_at::date
  loop
    v_n := public.contar_socios_facturables(r.sede_id, v_corte);
    if v_n = 0 then
      v_saltadas := v_saltadas + 1;
      continue;
    end if;

    insert into public.factura_sede (
      empresa_id, sede_id, periodo, socios_contados, precio_socio, monto, vence_el)
    values (
      r.empresa_id, r.sede_id, v_periodo, v_n, v_precio, v_n * v_precio,
      -- el plazo de pago corre desde HOY si el periodo ya pasó (recuperación de
      -- un hueco del cron): nunca se emite una factura ya vencida.
      greatest(v_corte + 8, current_date + 7))
    on conflict (sede_id, periodo) do nothing;

    get diagnostics v_ins = row_count;
    v_emitidas := v_emitidas + v_ins;
  end loop;

  return jsonb_build_object('periodo', v_periodo, 'corte', v_corte,
    'emitidas', v_emitidas, 'sin_socios', v_saltadas);
end $$;
revoke all on function public.emitir_facturas_periodo(date) from public, authenticated;
grant execute on function public.emitir_facturas_periodo(date) to service_role;

-- elegir_plan: marcar desde cuándo rige el plan de cada sede.
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
      estado = case when p_plan = 'miembros' and estado in ('prueba','vencida')
                    then 'activa' else estado end,
      trial_hasta = case when p_plan = 'miembros' then null else trial_hasta end
  where empresa_id = p_empresa_id
    and estado <> 'activa';

  -- El plan de la sede arranca HOY: el cobro por miembro no mira hacia atrás.
  update public.suscripcion_sede
  set estado = case when estado in ('prueba','vencida') then 'activa' else estado end,
      trial_hasta = null,
      plan_desde = current_date
  where empresa_id = p_empresa_id and p_plan = 'miembros';
end $$;

-- ── 4. ALTO: factura huérfana al migrar de miembros a un plan fijo ─────────
-- vencer_facturas solo mira sedes que HOY están en miembros (para no bloquear a
-- un gym en plan fijo). Efecto colateral: el que migra deja su última factura
-- 'emitida' para siempre — nadie la vence, nadie la cobra. Migrar era la vía
-- para no pagar el último mes.
--
-- Ahora la factura sí vence (queda visible y cobrable en el panel), pero el
-- BLOQUEO solo aplica a quien está en plan miembros: el de plan fijo paga su
-- suscripción y no se le corta la operación por esto.
create or replace function public.vencer_facturas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_b int;
begin
  -- Vencer es solo marcar la deuda como pasada de plazo: aplica a todas.
  update public.factura_sede
     set estado = 'vencida'
   where estado = 'emitida' and vence_el < current_date;
  get diagnostics v_n = row_count;

  -- Bloquear solo a quien sigue en el plan que este cobro gobierna.
  with morosas as (
    select distinct f.empresa_id, f.sede_id
    from public.factura_sede f
    join public.sede s on s.id = f.sede_id
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where f.estado = 'vencida'
      and coalesce(ss.plan_slug, e.plan_slug) = 'miembros'
  ),
  ins as (
    insert into public.suscripcion_sede (empresa_id, sede_id, plan_slug, con_app, monto, estado)
    select m.empresa_id, m.sede_id, 'miembros', false, 0, 'impaga' from morosas m
    on conflict (sede_id) do update set estado = 'impaga'
    returning 1
  )
  select count(*) into v_b from ins;

  return jsonb_build_object('vencidas', v_n, 'sedes_bloqueadas', v_b);
end $$;
revoke all on function public.vencer_facturas() from public, authenticated;
grant execute on function public.vencer_facturas() to service_role;

-- ── 5. MEDIO: fuga cross-tenant por RPC con sede_id arbitrario ─────────────
-- contar_socios_facturables / sede_solo_lectura / sede_con_app / estado_
-- suscripcion_sede aceptaban cualquier p_sede_id sin validar la empresa del
-- llamante: cualquier gym leía cuántos socios activos, qué plan y qué estado de
-- pago tiene su competencia. Se revoca a authenticated: el panel ya tiene
-- mi_consumo_actual() / mis_facturas_pendientes() / suscripciones_mis_sedes(),
-- que filtran por auth_empresa_id(). Las otras las usan triggers y policies
-- (SECURITY DEFINER: corren con los permisos del owner, no del llamante).
revoke all on function public.contar_socios_facturables(uuid,date) from public, authenticated;
grant execute on function public.contar_socios_facturables(uuid,date) to service_role;
revoke all on function public.sede_solo_lectura(uuid) from public, authenticated;
grant execute on function public.sede_solo_lectura(uuid) to service_role;
revoke all on function public.precio_por_socio() from public, anon;

-- estado_suscripcion_sede la usa el panel (BloqueoPlan) con la sede activa, así
-- que se queda accesible pero validando que la sede sea de la empresa del
-- llamante — salvo que la llame otra función SECURITY DEFINER (sede_con_app).
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

  -- Aislamiento: un gym no puede sondear el estado/plan de otro. auth.uid() is
  -- null = llamada del backend; auth_empresa_id() null = socio de la app (no
  -- staff), que llega aquí vía sede_con_app y solo obtiene el flag de app.
  if auth.uid() is not null and public.auth_empresa_id() is not null
     and public.auth_empresa_id() <> v_emp and not public.es_superadmin() then
    return jsonb_build_object('encontrado', false);
  end if;

  select * into v_ss from public.suscripcion_sede where sede_id = p_sede_id;
  if v_ss.id is not null then
    v_estado := v_ss.estado; v_con_app := v_ss.con_app; v_origen := 'sede';
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
    'activa', v_estado in ('prueba','activa','impaga'),
    'solo_lectura', v_estado = 'impaga',
    'origen', v_origen
  );
end $$;
revoke all on function public.estado_suscripcion_sede(uuid) from public;
grant execute on function public.estado_suscripcion_sede(uuid) to authenticated, service_role;

-- sede_con_app la llaman las policies y RPCs de la app en nombre del socio (que
-- no tiene auth_empresa_id): lee la tabla directo para no depender del chequeo
-- de aislamiento de arriba, y solo devuelve un booleano.
create or replace function public.sede_con_app(p_sede_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ss.con_app from public.suscripcion_sede ss where ss.sede_id = p_sede_id),
    (select sp.con_app from public.sede s
       join public.suscripcion_plataforma sp on sp.empresa_id = s.empresa_id
      where s.id = p_sede_id),
    false);
$$;
revoke all on function public.sede_con_app(uuid) from public;
grant execute on function public.sede_con_app(uuid) to authenticated, service_role;

-- ── 6. MEDIO: facturas por debajo del mínimo de Culqi = impagables ─────────
-- Culqi rechaza cargos menores a ~S/3. Un gym con 1-2 socios recibía una
-- factura de S/1-2 que NO podía pagar, y a los 8 días quedaba bloqueado: justo
-- el gym chico al que apunta el plan. Por debajo del mínimo no se emite: el
-- consumo se arrastra al mes siguiente (el conteo del corte ya es acumulativo,
-- así que basta con no emitir y no bloquear).
create or replace function public.monto_minimo_factura()
returns numeric language sql immutable set search_path = public as $$ select 5::numeric $$;

create or replace function public.emitir_facturas_periodo(p_periodo date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_periodo date := coalesce(date_trunc('month', p_periodo)::date,
                             (date_trunc('month', current_date) - interval '1 month')::date);
  v_corte date := (date_trunc('month', v_periodo) + interval '1 month - 1 day')::date;
  v_precio numeric := public.precio_por_socio();
  v_min numeric := public.monto_minimo_factura();
  v_emitidas int := 0; v_saltadas int := 0; v_bajo_minimo int := 0;
  r record;
  v_n int; v_ins int; v_monto numeric;
begin
  for r in
    select s.id as sede_id, s.empresa_id
    from public.sede s
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where s.deleted_at is null and s.activa
      and coalesce(ss.plan_slug, e.plan_slug) = 'miembros'
      and v_corte >= coalesce(ss.plan_desde, s.created_at::date)
      and v_corte >= s.created_at::date
  loop
    v_n := public.contar_socios_facturables(r.sede_id, v_corte);
    if v_n = 0 then
      v_saltadas := v_saltadas + 1;
      continue;
    end if;
    v_monto := v_n * v_precio;
    if v_monto < v_min then
      -- Impagable por la pasarela: no se emite ni se bloquea. El gym chico
      -- sigue operando gratis hasta que su consumo justifique un cobro.
      v_bajo_minimo := v_bajo_minimo + 1;
      continue;
    end if;

    insert into public.factura_sede (
      empresa_id, sede_id, periodo, socios_contados, precio_socio, monto, vence_el)
    values (r.empresa_id, r.sede_id, v_periodo, v_n, v_precio, v_monto,
            greatest(v_corte + 8, current_date + 7))
    on conflict (sede_id, periodo) do nothing;

    get diagnostics v_ins = row_count;
    v_emitidas := v_emitidas + v_ins;
  end loop;

  return jsonb_build_object('periodo', v_periodo, 'corte', v_corte,
    'emitidas', v_emitidas, 'sin_socios', v_saltadas, 'bajo_minimo', v_bajo_minimo);
end $$;
revoke all on function public.emitir_facturas_periodo(date) from public, authenticated;
grant execute on function public.emitir_facturas_periodo(date) to service_role;

-- ── 7. ALTO: el corte usaba current_date en UTC ────────────────────────────
-- La BD corre en UTC; el gym opera en Perú (UTC-5). El cron de las 4am UTC son
-- las 11pm del día anterior en Lima, y mi_consumo_actual() mostraba el conteo
-- del día siguiente a todo gym que mirara el panel después de las 7pm: socios
-- cuya membresía vence hoy desaparecían del "vas gastando S/X" y reaparecían en
-- la factura. El negocio es peruano: la fecha del negocio es la de Lima.
create or replace function public.hoy_peru()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Lima')::date
$$;
grant execute on function public.hoy_peru() to authenticated, service_role;

create or replace function public.mi_consumo_actual()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id(); v_hoy date := public.hoy_peru();
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sede_id', s.id, 'sede_nombre', s.nombre,
      'socios', public.contar_socios_facturables(s.id, v_hoy),
      'monto', public.contar_socios_facturables(s.id, v_hoy) * public.precio_por_socio(),
      'se_cobra_el', (date_trunc('month', v_hoy) + interval '1 month')::date
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
