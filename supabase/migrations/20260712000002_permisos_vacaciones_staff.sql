-- Permisos y vacaciones del personal (pedido del owner: "¿dónde gestiono
-- permisos o vacaciones? aún no está eso, ¿no?"). El admin registra rangos
-- por colaborador; mientras el permiso está vigente, el colaborador queda
-- FUERA de la cascada de avisos (staff_disponible) — a alguien de vacaciones
-- no le timbra "nuevo socio" ni "ayuda en sala".

create table if not exists public.permiso_staff (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id),
  usuario_id uuid not null references public.usuario(id),
  tipo text not null check (tipo in ('vacaciones', 'permiso', 'descanso_medico')),
  desde date not null,
  hasta date not null,
  nota text,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (hasta >= desde)
);

create index if not exists idx_permiso_staff_empresa on public.permiso_staff (empresa_id, hasta);
create index if not exists idx_permiso_staff_usuario on public.permiso_staff (usuario_id, hasta);

alter table public.permiso_staff enable row level security;

drop policy if exists permiso_staff_select on public.permiso_staff;
create policy permiso_staff_select on public.permiso_staff
  for select using (empresa_id = public.auth_empresa_id());

drop policy if exists permiso_staff_admin_ins on public.permiso_staff;
create policy permiso_staff_admin_ins on public.permiso_staff
  for insert with check (empresa_id = public.auth_empresa_id() and public.auth_is_admin());

drop policy if exists permiso_staff_admin_upd on public.permiso_staff;
create policy permiso_staff_admin_upd on public.permiso_staff
  for update using (empresa_id = public.auth_empresa_id() and public.auth_is_admin());

drop policy if exists permiso_staff_admin_del on public.permiso_staff;
create policy permiso_staff_admin_del on public.permiso_staff
  for delete using (empresa_id = public.auth_empresa_id() and public.auth_is_admin());

-- staff_disponible: quien está de permiso/vacaciones HOY no recibe avisos.
create or replace function public.staff_disponible(p_empresa uuid, p_roles text[])
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  with ahora as (
    select (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::time as hora,
           (now() at time zone coalesce(e.zona_horaria, 'America/Lima'))::date as hoy
    from public.empresa e where e.id = p_empresa
  ),
  candidatos as (
    select ue.usuario_id,
      (ue.turno_inicio is null or ue.turno_fin is null
        or (ue.turno_inicio <= ue.turno_fin
            and (select hora from ahora) between ue.turno_inicio and ue.turno_fin)
        or (ue.turno_inicio > ue.turno_fin  -- turno que cruza medianoche
            and ((select hora from ahora) >= ue.turno_inicio
              or (select hora from ahora) <= ue.turno_fin))) as de_turno,
      exists (select 1 from public.asistencia_staff a
               where a.empresa_id = p_empresa and a.usuario_id = ue.usuario_id
                 and a.fecha = (select hoy from ahora) and a.salida_at is null) as presente
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id
    where ue.empresa_id = p_empresa and ue.activo and ro.codigo = any(p_roles)
      -- de vacaciones / con permiso hoy => fuera de la cascada de avisos
      and not exists (
        select 1 from public.permiso_staff pe
        where pe.empresa_id = p_empresa and pe.usuario_id = ue.usuario_id
          and (select hoy from ahora) between pe.desde and pe.hasta
      )
  )
  select usuario_id from candidatos
  where case
    when exists (select 1 from candidatos where presente and de_turno) then presente and de_turno
    when exists (select 1 from candidatos where de_turno) then de_turno
    else true
  end
$$;
