-- El piso de un gym no siempre es un rectángulo lleno: puede ser una U, tener un
-- hueco (patio, ducto), un pasillo. Esta tabla marca QUÉ casillas de la grilla
-- SON piso — el gym dibuja la forma real. Las máquinas solo se colocan en casillas
-- que son piso. Mismo patrón de dos capas que sala/sala_posicion (P33).
--
-- Regla: si un piso NO tiene ninguna fila en piso_casilla, se considera "todo
-- piso" (retrocompat con los pisos ya creados como cuadrícula llena). En cuanto
-- el gym pinta al menos una casilla, solo esas cuentan como piso.
create table if not exists public.piso_casilla (
  id       uuid primary key default gen_random_uuid(),
  piso_id  uuid not null references public.sede_piso(id) on delete cascade,
  fila     int not null,
  columna  int not null,
  unique (piso_id, fila, columna)
);
create index if not exists piso_casilla_piso_idx on public.piso_casilla (piso_id);

alter table public.piso_casilla enable row level security;
-- Staff que gestiona el piso (via la RLS de sede_piso: mismo empresa+sede).
drop policy if exists piso_casilla_staff on public.piso_casilla;
create policy piso_casilla_staff on public.piso_casilla for all to authenticated
  using (exists (select 1 from public.sede_piso sp
                 where sp.id = piso_casilla.piso_id
                   and sp.empresa_id = public.auth_empresa_id()
                   and (sp.sede_id in (select public.auth_sede_ids()) or public.auth_is_admin())))
  with check (exists (select 1 from public.sede_piso sp
                 where sp.id = piso_casilla.piso_id
                   and sp.empresa_id = public.auth_empresa_id()
                   and (sp.sede_id in (select public.auth_sede_ids()) or public.auth_is_admin())));
-- Socio: lee las casillas de los pisos de su sede.
drop policy if exists piso_casilla_socio on public.piso_casilla;
create policy piso_casilla_socio on public.piso_casilla for select to authenticated
  using (exists (select 1 from public.sede_piso sp join public.socio s on s.sede_id = sp.sede_id
                 where sp.id = piso_casilla.piso_id and s.usuario_id = auth.uid() and s.deleted_at is null));

-- Casillas que SON piso de un piso dado (para el editor y la app).
create or replace function public.casillas_de_piso(p_piso_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('fila', fila, 'columna', columna)), '[]'::jsonb)
  from public.piso_casilla where piso_id = p_piso_id;
$$;
grant execute on function public.casillas_de_piso(uuid) to authenticated, service_role;

-- Marca/desmarca una casilla como piso (toggle). p_es_piso=true la agrega,
-- false la quita. La RLS de piso_casilla restringe al staff de la sede.
create or replace function public.set_casilla_piso(p_piso_id uuid, p_fila int, p_columna int, p_es_piso boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  -- validar que la casilla esté dentro de la grilla del piso
  if not exists (select 1 from public.sede_piso sp
                 where sp.id = p_piso_id and p_fila >= 0 and p_fila < sp.filas
                   and p_columna >= 0 and p_columna < sp.columnas) then
    raise exception 'casilla fuera del piso';
  end if;
  if p_es_piso then
    insert into public.piso_casilla (piso_id, fila, columna) values (p_piso_id, p_fila, p_columna)
      on conflict (piso_id, fila, columna) do nothing;
  else
    delete from public.piso_casilla where piso_id = p_piso_id and fila = p_fila and columna = p_columna;
    -- si se deja de ser piso, cualquier máquina en esa casilla se despega
    update public.maquina set grid_fila = null, grid_columna = null
      where piso_id = p_piso_id and grid_fila = p_fila and grid_columna = p_columna;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.set_casilla_piso(uuid,int,int,boolean) to authenticated, service_role;

-- Llenar TODO el piso como casillas (para "llenar todo"). Inserta una casilla por
-- cada posición de la grilla que aún no exista.
create or replace function public.llenar_piso(p_piso_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_filas int; v_columnas int;
begin
  select filas, columnas into v_filas, v_columnas from public.sede_piso where id = p_piso_id;
  if v_filas is null then raise exception 'piso no encontrado o sin acceso'; end if;
  insert into public.piso_casilla (piso_id, fila, columna)
  select p_piso_id, f, c from generate_series(0, v_filas - 1) f, generate_series(0, v_columnas - 1) c
  on conflict (piso_id, fila, columna) do nothing;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.llenar_piso(uuid) to authenticated, service_role;

-- Vaciar el piso (quita todas las casillas y despega sus máquinas).
create or replace function public.vaciar_piso(p_piso_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  -- validar acceso via un delete que la RLS acota (si no es del staff, no borra nada)
  delete from public.piso_casilla where piso_id = p_piso_id;
  update public.maquina set grid_fila = null, grid_columna = null where piso_id = p_piso_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.vaciar_piso(uuid) to authenticated, service_role;
