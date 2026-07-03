-- 039: Plan comercial elegido por la empresa + contador de visitas de la landing.
--
-- 1) empresa.plan_slug / plan_con_app: qué plan de FitControl eligió el gym al
--    registrarse (estudio | crecimiento | cadena) y si contrató la app del socio.
--    Aún no hay billing: es la base para cobrar y para el dashboard de FitControl.
-- 2) landing_visita: una fila por visita a la página pública del gym (con fuente
--    utm) para mostrarle al dueño cuánta gente llega y desde qué red.

alter table public.empresa
  add column if not exists plan_slug text not null default 'crecimiento',
  add column if not exists plan_con_app boolean not null default false;

alter table public.empresa drop constraint if exists empresa_plan_slug_chk;
alter table public.empresa add constraint empresa_plan_slug_chk
  check (plan_slug in ('estudio', 'crecimiento', 'cadena'));

-- El admin de una empresa (aunque no sea la activa: p.ej. recién creada) fija su plan
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
end;
$$;

grant execute on function public.elegir_plan(uuid, text, boolean) to authenticated;

-- ── Visitas de la landing pública ────────────────────────────────────────────
create table if not exists public.landing_visita (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  fuente text,
  created_at timestamptz not null default now()
);

create index if not exists landing_visita_emp_fecha
  on public.landing_visita (empresa_id, created_at);

alter table public.landing_visita enable row level security;

drop policy if exists landing_visita_tenant_select on public.landing_visita;
create policy landing_visita_tenant_select on public.landing_visita
  for select to authenticated
  using (empresa_id = public.auth_empresa_id());

-- RPC pública (anon): registra la visita si la landing existe y está activa.
-- Nunca lanza error hacia el visitante.
create or replace function public.registrar_visita_landing(
  p_slug text,
  p_fuente text default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_emp uuid;
begin
  select id into v_emp
  from public.empresa
  where lower(slug) = lower(trim(p_slug)) and landing_activa;

  if v_emp is null then return; end if;

  insert into public.landing_visita (empresa_id, fuente)
  values (v_emp, nullif(left(trim(coalesce(p_fuente, '')), 60), ''));
exception when others then
  return;
end;
$$;

grant execute on function public.registrar_visita_landing(text, text) to anon, authenticated;
