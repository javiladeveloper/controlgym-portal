-- Acceso multi-sede del SOCIO configurable por plan (pedido del owner: los
-- beneficios permiten entrar a 1, N, o TODAS las sedes — ej. VIP=3 sedes,
-- Élite=todas). Hasta hoy solo existía el booleano plan.multisede (su sede o
-- todas). Se agrega el "modo" y una lista opcional de sedes específicas.
--
-- OJO (distinto de esto): staff_multisede = dónde trabaja el STAFF, y la
-- suscripción del gym que se paga por sede — son otros temas.

-- modo de acceso del plan:
--   'propia' → solo la sede del socio (default, = multisede false actual)
--   'todas'  → todas las sedes del gym (= multisede true actual)
--   'lista'  → solo las sedes en plan_sede_acceso (ej. VIP a 3 específicas)
--   'n'      → hasta N sedes cualesquiera; se validan las que ya usó
alter table public.plan add column if not exists acceso_sedes text
  not null default 'propia'
  check (acceso_sedes in ('propia', 'todas', 'lista', 'n'));
alter table public.plan add column if not exists acceso_sedes_n int
  check (acceso_sedes_n is null or acceso_sedes_n >= 1);

-- Migrar el booleano existente: multisede=true → 'todas'
update public.plan set acceso_sedes = 'todas' where coalesce(multisede, false) and acceso_sedes = 'propia';

-- Sedes específicas permitidas por plan (para modo 'lista')
create table if not exists public.plan_sede_acceso (
  plan_id uuid not null references public.plan(id) on delete cascade,
  sede_id uuid not null references public.sede(id) on delete cascade,
  primary key (plan_id, sede_id)
);
alter table public.plan_sede_acceso enable row level security;

drop policy if exists plan_sede_acceso_sel on public.plan_sede_acceso;
create policy plan_sede_acceso_sel on public.plan_sede_acceso for select
  using (exists (select 1 from public.plan p where p.id = plan_id and p.empresa_id = public.auth_empresa_id()));
drop policy if exists plan_sede_acceso_adm on public.plan_sede_acceso;
create policy plan_sede_acceso_adm on public.plan_sede_acceso for all
  using (public.auth_is_admin() and exists (select 1 from public.plan p where p.id = plan_id and p.empresa_id = public.auth_empresa_id()))
  with check (public.auth_is_admin() and exists (select 1 from public.plan p where p.id = plan_id and p.empresa_id = public.auth_empresa_id()));

-- Motor de acceso: ¿este socio puede entrar a esta sede HOY?
create or replace function public.socio_puede_entrar_sede(p_socio_id uuid, p_sede_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_socio public.socio;
  v_restringe boolean;
  v_m record;
begin
  select * into v_socio from public.socio where id = p_socio_id;
  if v_socio.id is null then return false; end if;

  -- gym que no restringe por sede → siempre puede
  select coalesce(e.restringe_sede, false) into v_restringe from public.empresa e where e.id = v_socio.empresa_id;
  if not v_restringe then return true; end if;

  -- su propia sede: siempre
  if v_socio.sede_id = p_sede_id then return true; end if;

  -- membresía activa con su plan → decide según el modo de acceso del plan
  for v_m in
    select p.acceso_sedes, p.acceso_sedes_n, p.id as plan_id, coalesce(p.multisede,false) as multi
    from public.membresia m
    join public.plan p on p.id = m.plan_id
    where m.socio_id = p_socio_id and m.estado = 'activa'
      and current_date between m.fecha_inicio and m.fecha_fin
  loop
    if v_m.multi or v_m.acceso_sedes = 'todas' then
      return true;                               -- todas las sedes del gym
    elsif v_m.acceso_sedes = 'lista' then
      if exists (select 1 from public.plan_sede_acceso a
                  where a.plan_id = v_m.plan_id and a.sede_id = p_sede_id) then
        return true;                             -- sede en su lista permitida
      end if;
    elsif v_m.acceso_sedes = 'n' and v_m.acceso_sedes_n is not null then
      -- hasta N sedes DISTINTAS ya usadas por check-in (incluye la propia);
      -- si esta sede ya está entre las usadas, o aún hay cupo, permite.
      if p_sede_id in (
           select distinct c.sede_id from public.checkin c
           where c.socio_id = p_socio_id and c.direccion = 'entrada' and c.resultado = 'permitido'
         )
         or (select count(distinct c.sede_id) from public.checkin c
             where c.socio_id = p_socio_id and c.direccion = 'entrada' and c.resultado = 'permitido')
            < v_m.acceso_sedes_n then
        return true;
      end if;
    end if;
  end loop;

  return false;
end $$;

revoke all on function public.socio_puede_entrar_sede(uuid, uuid) from public;
grant execute on function public.socio_puede_entrar_sede(uuid, uuid) to authenticated, service_role;
