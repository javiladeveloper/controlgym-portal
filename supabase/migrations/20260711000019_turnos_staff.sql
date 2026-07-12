-- PEDIDO 30 (app): turnos/horarios del personal.
-- El gym define los turnos de cada empleado en el PANEL (soporta medio tiempo:
-- solo algunos días y/o rangos acotados); la app los MUESTRA en el perfil del
-- trainer vía mis_turnos() (contrato exacto: dia_semana, hora_inicio "HH:MM",
-- hora_fin, sede_nombre — la app ya deserializa por esos nombres).

-- 1) Tabla ------------------------------------------------------------------
create table if not exists public.turno_staff (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id),
  usuario_id uuid not null references public.usuario(id),
  sede_id uuid references public.sede(id),
  dia_semana int not null check (dia_semana between 1 and 7), -- 1=lunes .. 7=domingo (ISO)
  hora_inicio time not null,
  hora_fin time not null,
  created_at timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

create index if not exists idx_turno_staff_empresa on public.turno_staff (empresa_id);
create index if not exists idx_turno_staff_usuario on public.turno_staff (usuario_id, dia_semana, hora_inicio);

-- 2) RLS: el staff LEE los turnos de su empresa (para ver el horario del
-- equipo); solo el admin los define/edita.
alter table public.turno_staff enable row level security;

drop policy if exists turno_staff_select on public.turno_staff;
create policy turno_staff_select on public.turno_staff
  for select using (empresa_id = public.auth_empresa_id());

drop policy if exists turno_staff_admin_ins on public.turno_staff;
create policy turno_staff_admin_ins on public.turno_staff
  for insert with check (empresa_id = public.auth_empresa_id() and public.auth_is_admin());

drop policy if exists turno_staff_admin_upd on public.turno_staff;
create policy turno_staff_admin_upd on public.turno_staff
  for update using (empresa_id = public.auth_empresa_id() and public.auth_is_admin());

drop policy if exists turno_staff_admin_del on public.turno_staff;
create policy turno_staff_admin_del on public.turno_staff
  for delete using (empresa_id = public.auth_empresa_id() and public.auth_is_admin());

-- 3) RPC para la app: los turnos del usuario EN SESIÓN (auth.uid), sin args.
-- SECURITY DEFINER: el trainer puede no tener empresa activa en el claim al
-- entrar por la app, así que filtramos por su uid directamente.
create or replace function public.mis_turnos()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'dia_semana',  t.dia_semana,
    'hora_inicio', to_char(t.hora_inicio, 'HH24:MI'),
    'hora_fin',    to_char(t.hora_fin, 'HH24:MI'),
    'sede_nombre', s.nombre
  ) order by t.dia_semana, t.hora_inicio), '[]'::jsonb)
  from public.turno_staff t
  left join public.sede s on s.id = t.sede_id
  where t.usuario_id = auth.uid();
$$;

revoke all on function public.mis_turnos() from public;
grant execute on function public.mis_turnos() to authenticated;
