-- Facturación del plan 'miembros': S/1 por socio con membresía vigente al
-- cierre del mes, cobrado a mes vencido con 7 días para pagar.
--
-- Hoy existe pago_plataforma (historial de cobros) pero no existe el "cuánto
-- debes": esta tabla es ese estado de cuenta. Congela el conteo del corte para
-- que dar de baja socios el día 2 no cambie la factura del mes cerrado.

create table if not exists public.factura_sede (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  sede_id uuid not null references public.sede(id) on delete cascade,
  periodo date not null,                       -- 2026-07-01 = julio (siempre día 1)
  socios_contados int not null,
  precio_socio numeric(10,2) not null,         -- congelado: si mañana sube a 2, las viejas no cambian
  monto numeric(12,2) not null,
  moneda text not null default 'PEN',
  estado text not null default 'emitida'
    check (estado in ('emitida','pagada','vencida','anulada')),
  vence_el date not null,
  pagada_at timestamptz,
  pago_id uuid references public.pago_plataforma(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sede_id, periodo)                    -- idempotencia del cierre mensual
);

create index if not exists factura_sede_emp on public.factura_sede (empresa_id, periodo desc);
create index if not exists factura_sede_impagas on public.factura_sede (estado, vence_el)
  where estado in ('emitida','vencida');

drop trigger if exists trg_touch_factura_sede on public.factura_sede;
create trigger trg_touch_factura_sede before update on public.factura_sede
  for each row execute function public.set_updated_at();

alter table public.factura_sede enable row level security;

-- Solo lectura para el staff de la empresa: las facturas las emite y las paga
-- el backend (conexión directa), igual que pago_plataforma. Sin policy de
-- insert/update/delete: nadie con JWT puede marcarse una factura como pagada.
drop policy if exists factura_sede_sel on public.factura_sede;
create policy factura_sede_sel on public.factura_sede for select to authenticated
  using (empresa_id = public.auth_empresa_id() or public.es_superadmin());

-- ── Conteo: qué se cobra ────────────────────────────────────────────────────
-- Socios con membresía vigente a una fecha. Cuenta por FECHAS y no por
-- estado='activa': el flag depende de que vencer_membresias() haya corrido, la
-- fecha es la verdad. Así el cobro no arrastra el bug de otro cron.
--
-- 'congelada' no se cobra: el socio no está usando el gym.
-- 'cancelada' tampoco. Un socio con dos membresías vigentes cuenta UNA vez.
create or replace function public.contar_socios_facturables(p_sede_id uuid, p_fecha date)
returns int language sql stable security definer set search_path = public as $$
  select count(distinct m.socio_id)::int
  from public.membresia m
  join public.socio s on s.id = m.socio_id
  where m.sede_id = p_sede_id
    and m.deleted_at is null
    and s.deleted_at is null
    and m.estado in ('activa','vencida')   -- 'vencida' puede ser flag viejo: manda la fecha
    and m.fecha_inicio <= p_fecha
    and m.fecha_fin >= p_fecha;
$$;
revoke all on function public.contar_socios_facturables(uuid,date) from public;
grant execute on function public.contar_socios_facturables(uuid,date) to authenticated, service_role;

-- Precio por socio del plan 'miembros'. Función y no constante para que subirlo
-- sea un create or replace (mismo patrón que precio_plan).
create or replace function public.precio_por_socio()
returns numeric language sql immutable set search_path = public as $$ select 1::numeric $$;

-- ── Cierre de mes: emitir las facturas del periodo ──────────────────────────
-- Idempotente por unique(sede_id, periodo): correrla N veces el mismo día no
-- duplica. No emite factura si la sede no tuvo socios (nada que cobrar): es el
-- caso del gym que recién entra, y sostiene "si no registras socios no pagas".
--
-- p_periodo = primer día del mes YA CERRADO. El corte se mide el último día de
-- ese mes: quien tenía membresía vigente ese día, se cobra.
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
  -- Solo sedes en plan 'miembros'. El plan de la sede manda; si no tiene fila
  -- propia de suscripción, hereda el de la empresa (mismo criterio que
  -- plan_de_sede / modulos_de_sede).
  for r in
    select s.id as sede_id, s.empresa_id
    from public.sede s
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where s.deleted_at is null and s.activa
      and coalesce(ss.plan_slug, e.plan_slug) = 'miembros'
  loop
    v_n := public.contar_socios_facturables(r.sede_id, v_corte);
    if v_n = 0 then
      v_saltadas := v_saltadas + 1;
      continue;                              -- sin socios: no se emite factura
    end if;

    insert into public.factura_sede (
      empresa_id, sede_id, periodo, socios_contados, precio_socio, monto, vence_el)
    values (
      r.empresa_id, r.sede_id, v_periodo, v_n, v_precio, v_n * v_precio, v_corte + 8)
    on conflict (sede_id, periodo) do nothing;  -- ya emitida: el conteo queda congelado

    get diagnostics v_ins = row_count;          -- 0 si ya existía (conteo congelado)
    v_emitidas := v_emitidas + v_ins;
  end loop;

  return jsonb_build_object('periodo', v_periodo, 'corte', v_corte,
    'emitidas', v_emitidas, 'sin_socios', v_saltadas);
end $$;
revoke all on function public.emitir_facturas_periodo(date) from public;
grant execute on function public.emitir_facturas_periodo(date) to service_role;

-- ── Estado 'impaga' = solo lectura ──────────────────────────────────────────
-- Se suma al check de suscripcion_sede. No se reutiliza 'vencida' (que ya
-- significa "trial vencido") para no confundir dos causas distintas de bloqueo.
alter table public.suscripcion_sede drop constraint if exists suscripcion_sede_estado_check;
alter table public.suscripcion_sede add constraint suscripcion_sede_estado_check
  check (estado in ('prueba','activa','vencida','cancelada','impaga'));

-- ── Vencer las impagas → sede a solo lectura ────────────────────────────────
-- Se guía por fecha, no por "hoy es el día 8": si el cron no corre un día, al
-- siguiente vence igual las que tocaban.
create or replace function public.vencer_facturas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.factura_sede
     set estado = 'vencida'
   where estado = 'emitida' and vence_el < current_date;
  get diagnostics v_n = row_count;

  -- Toda sede con factura vencida pasa a 'impaga' (solo lectura). Las sedes en
  -- plan miembros pueden no tener fila de suscripción todavía: se crea.
  insert into public.suscripcion_sede (empresa_id, sede_id, plan_slug, con_app, monto, estado)
  select distinct f.empresa_id, f.sede_id, 'miembros', false, 0, 'impaga'
  from public.factura_sede f
  where f.estado = 'vencida'
  on conflict (sede_id) do update set estado = 'impaga';

  return jsonb_build_object('vencidas', v_n);
end $$;
revoke all on function public.vencer_facturas() from public;
grant execute on function public.vencer_facturas() to service_role;

-- ── Marcar pagada → la sede vuelve a operar ─────────────────────────────────
-- La llama el webhook de Culqi tras confirmar el cobro. Reactiva la sede solo
-- si ya no le quedan facturas impagas (podría deber dos meses).
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

  select count(*) into v_debe from public.factura_sede
   where sede_id = v_sede and estado in ('emitida','vencida');

  if v_debe = 0 then
    update public.suscripcion_sede set estado = 'activa'
     where sede_id = v_sede and estado = 'impaga';
  end if;

  return jsonb_build_object('ok', true, 'sede_id', v_sede, 'facturas_pendientes', v_debe);
end $$;
revoke all on function public.marcar_factura_pagada(uuid,uuid) from public;
grant execute on function public.marcar_factura_pagada(uuid,uuid) to service_role;

-- ── Lo que el panel necesita: mi deuda ──────────────────────────────────────
-- Facturas pendientes de las sedes de mi empresa, con el detalle para la barra
-- de cobro y el botón de pago.
create or replace function public.mis_facturas_pendientes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'sede_id', f.sede_id, 'sede_nombre', s.nombre,
      'periodo', f.periodo, 'socios', f.socios_contados, 'monto', f.monto,
      'estado', f.estado, 'vence_el', f.vence_el,
      'dias_restantes', (f.vence_el - current_date)
    ) order by f.periodo)
    from public.factura_sede f
    join public.sede s on s.id = f.sede_id
    where f.empresa_id = v_emp and f.estado in ('emitida','vencida')
  ), '[]'::jsonb);
end $$;
revoke all on function public.mis_facturas_pendientes() from public;
grant execute on function public.mis_facturas_pendientes() to authenticated, service_role;
