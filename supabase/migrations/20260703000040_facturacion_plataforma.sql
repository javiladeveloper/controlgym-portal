-- 040: Facturación de la plataforma (FitControl cobra a los gimnasios).
--
-- suscripcion_plataforma: 1 fila por empresa con su plan, monto y estado.
--   Todo gym arranca en 'prueba' (30 días desde su registro, sin tarjeta).
--   Al activar el pago automático (Culqi) pasa a 'activa'.
-- pago_plataforma: historial de cobros (webhook de la pasarela los inserta).
-- Las escrituras las hacen las funciones del backend (conexión directa);
-- el panel solo lee (admin de la empresa o superadmin).

create table if not exists public.suscripcion_plataforma (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresa(id) on delete cascade,
  plan_slug text not null default 'crecimiento' check (plan_slug in ('estudio', 'crecimiento', 'cadena')),
  con_app boolean not null default false,
  monto numeric(10,2) not null,
  moneda text not null default 'PEN',
  estado text not null default 'prueba'
    check (estado in ('prueba', 'activa', 'pendiente_pago', 'vencida', 'cancelada')),
  proveedor text,                    -- 'culqi'
  proveedor_customer_id text,
  proveedor_card_id text,
  proveedor_suscripcion_id text,
  trial_hasta date,
  proximo_cobro date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists suscripcion_plataforma_updated on public.suscripcion_plataforma;
create trigger suscripcion_plataforma_updated
  before update on public.suscripcion_plataforma
  for each row execute function public.set_updated_at();

create table if not exists public.pago_plataforma (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  suscripcion_id uuid references public.suscripcion_plataforma(id) on delete set null,
  monto numeric(10,2) not null,
  moneda text not null default 'PEN',
  estado text not null default 'exitoso' check (estado in ('exitoso', 'fallido', 'reembolsado')),
  proveedor text,
  proveedor_pago_id text unique,
  raw jsonb,
  pagado_at timestamptz not null default now()
);

create index if not exists pago_plataforma_emp on public.pago_plataforma (empresa_id, pagado_at desc);

alter table public.suscripcion_plataforma enable row level security;
alter table public.pago_plataforma enable row level security;

drop policy if exists suscripcion_plataforma_select on public.suscripcion_plataforma;
create policy suscripcion_plataforma_select on public.suscripcion_plataforma
  for select to authenticated
  using (empresa_id = public.auth_empresa_id() or public.es_superadmin());

drop policy if exists pago_plataforma_select on public.pago_plataforma;
create policy pago_plataforma_select on public.pago_plataforma
  for select to authenticated
  using (empresa_id = public.auth_empresa_id() or public.es_superadmin());

-- Precio de lista de cada plan (única fuente de verdad en BD)
create or replace function public.precio_plan(p_plan text, p_con_app boolean)
returns numeric
language sql immutable
as $$
  select case p_plan
    when 'estudio' then case when p_con_app then 79 else 49 end
    when 'crecimiento' then case when p_con_app then 139 else 99 end
    when 'cadena' then case when p_con_app then 229 else 179 end
  end::numeric
$$;

-- Devuelve (creándola si falta) la suscripción de la empresa activa.
-- El trial corre desde la creación de la empresa: 30 días gratis.
create or replace function public.get_mi_suscripcion()
returns public.suscripcion_plataforma
language plpgsql security definer
set search_path = public
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_row public.suscripcion_plataforma;
begin
  if v_emp is null then
    raise exception 'Sin empresa activa';
  end if;

  select * into v_row from public.suscripcion_plataforma where empresa_id = v_emp;
  if not found then
    insert into public.suscripcion_plataforma (empresa_id, plan_slug, con_app, monto, estado, trial_hasta)
    select e.id, e.plan_slug, e.plan_con_app,
           public.precio_plan(e.plan_slug, e.plan_con_app),
           'prueba', (e.created_at + interval '30 days')::date
    from public.empresa e where e.id = v_emp
    returning * into v_row;
  end if;

  -- Prueba vencida y sin pago configurado → marcarla vencida al vuelo
  if v_row.estado = 'prueba' and v_row.trial_hasta < current_date then
    update public.suscripcion_plataforma set estado = 'vencida'
    where id = v_row.id returning * into v_row;
  end if;

  return v_row;
end;
$$;

grant execute on function public.get_mi_suscripcion() to authenticated;

-- elegir_plan ahora también sincroniza la suscripción (plan/monto).
create or replace function public.elegir_plan(
  p_empresa_id uuid,
  p_plan text,
  p_con_app boolean default false
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_plan not in ('estudio', 'crecimiento', 'cadena') then
    raise exception 'Plan inválido';
  end if;
  if not exists (
    select 1
    from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = p_empresa_id
      and r.codigo = 'admin'
  ) then
    raise exception 'Solo un administrador del gimnasio puede cambiar el plan';
  end if;

  update public.empresa
  set plan_slug = p_plan, plan_con_app = coalesce(p_con_app, false)
  where id = p_empresa_id;

  update public.suscripcion_plataforma
  set plan_slug = p_plan,
      con_app = coalesce(p_con_app, false),
      monto = public.precio_plan(p_plan, coalesce(p_con_app, false))
  where empresa_id = p_empresa_id
    and estado <> 'activa';  -- con pago activo, el cambio se coordina con soporte
end;
$$;
