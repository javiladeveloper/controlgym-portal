-- Billing POR SEDE (decisión del owner: "cada sede paga su propia membresía";
-- acuerdos con cadenas = override manual). Cambio ADITIVO y compatible: la
-- suscripción a nivel EMPRESA sigue existiendo como fallback; una sede sin fila
-- propia hereda el estado de la empresa. Así ningún gym actual se rompe, y los
-- que quieran cobro por sede crean filas por sede.

create table if not exists public.suscripcion_sede (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id),
  sede_id uuid not null references public.sede(id) on delete cascade,
  plan_slug text,
  con_app boolean not null default false,      -- la app del socio se paga POR SEDE
  monto numeric(12,2),                         -- precio de ESTA sede (override manual si difiere)
  monto_override boolean not null default false, -- true = precio pactado a mano; no lo recalcula el sistema
  moneda text not null default 'PEN',
  estado text not null default 'prueba' check (estado in ('prueba','activa','vencida','cancelada')),
  proveedor text, proveedor_suscripcion_id text,
  trial_hasta date,
  proximo_cobro date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sede_id)
);

create index if not exists idx_suscripcion_sede_empresa on public.suscripcion_sede (empresa_id);

alter table public.suscripcion_sede enable row level security;

-- Lectura: staff de la empresa (para ver estado/app de sus sedes).
drop policy if exists suscripcion_sede_sel on public.suscripcion_sede;
create policy suscripcion_sede_sel on public.suscripcion_sede for select
  using (empresa_id = public.auth_empresa_id());
-- Escritura: solo admin del gym (activar/pagar su sede). El precio pactado con
-- cadenas lo fija la PLATAFORMA por SQL/panel-admin, no el gym.
drop policy if exists suscripcion_sede_adm on public.suscripcion_sede;
create policy suscripcion_sede_adm on public.suscripcion_sede for all
  using (empresa_id = public.auth_empresa_id() and public.auth_is_admin())
  with check (empresa_id = public.auth_empresa_id() and public.auth_is_admin());

create or replace function public.touch_suscripcion_sede() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_touch_suscripcion_sede on public.suscripcion_sede;
create trigger trg_touch_suscripcion_sede before update on public.suscripcion_sede
  for each row execute function public.touch_suscripcion_sede();

-- ── Resolución del estado EFECTIVO de una sede ──────────────────────────────
-- Si la sede tiene fila propia, manda; si no, hereda la suscripción de empresa
-- (compatibilidad). Devuelve estado + con_app efectivos para esa sede.
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
    -- prueba vencida se marca al vuelo (igual que la de empresa)
    if v_ss.estado = 'prueba' and v_ss.trial_hasta is not null and v_ss.trial_hasta < current_date then
      update public.suscripcion_sede set estado = 'vencida' where id = v_ss.id returning * into v_ss;
    end if;
    v_estado := v_ss.estado; v_con_app := v_ss.con_app; v_origen := 'sede';
  else
    select * into v_emp_sus from public.suscripcion_plataforma where empresa_id = v_emp;
    v_estado := coalesce(v_emp_sus.estado, 'prueba');
    v_con_app := coalesce(v_emp_sus.con_app, false);
    v_origen := 'empresa';
  end if;

  return jsonb_build_object(
    'encontrado', true, 'sede_id', p_sede_id, 'estado', v_estado,
    'con_app', v_con_app, 'activa', v_estado in ('prueba','activa'), 'origen', v_origen
  );
end $$;
revoke all on function public.estado_suscripcion_sede(uuid) from public;
grant execute on function public.estado_suscripcion_sede(uuid) to authenticated, service_role;

-- Resumen para el panel: todas las sedes con su estado efectivo y monto.
-- El monto sugerido usa precio_plan por sede; si hay override, respeta el monto.
create or replace function public.suscripciones_mis_sedes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'sede_id', s.id, 'sede_nombre', s.nombre,
      'tiene_fila', ss.id is not null,
      'plan_slug', coalesce(ss.plan_slug, e.plan_slug),
      'con_app', coalesce(ss.con_app, e.plan_con_app, false),
      'estado', coalesce(ss.estado, (select estado from public.suscripcion_plataforma where empresa_id = v_emp), 'prueba'),
      'monto', case when ss.monto_override then ss.monto
                    else public.precio_plan(coalesce(ss.plan_slug, e.plan_slug), coalesce(ss.con_app, e.plan_con_app, false)) end,
      'monto_override', coalesce(ss.monto_override, false),
      'trial_hasta', ss.trial_hasta, 'proximo_cobro', ss.proximo_cobro
    ) order by s.created_at)
    from public.sede s
    join public.empresa e on e.id = s.empresa_id
    left join public.suscripcion_sede ss on ss.sede_id = s.id
    where s.empresa_id = v_emp and s.deleted_at is null and s.activa
  ), '[]'::jsonb);
end $$;
revoke all on function public.suscripciones_mis_sedes() from public;
grant execute on function public.suscripciones_mis_sedes() to authenticated, service_role;
