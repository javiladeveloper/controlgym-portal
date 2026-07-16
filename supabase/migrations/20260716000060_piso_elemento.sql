-- Elementos colocados en el croquis de un piso. Reemplaza la posición ÚNICA que
-- tenía cada máquina (maquina.grid_fila/columna) por una tabla donde:
--   · una máquina con N unidades ocupa N casillas (N filas tipo 'maquina',
--     mismo maquina_id) — cada unidad física en su lugar real.
--   · además se marcan PUNTOS DE REFERENCIA (entrada, escalera, baño…) para que
--     el socio se ubique.
-- Una casilla = un elemento (unique piso_id/fila/columna).

create table if not exists public.piso_elemento (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  piso_id    uuid not null references public.sede_piso(id) on delete cascade,
  fila       int not null,
  columna    int not null,
  tipo       text not null check (tipo in ('maquina','entrada','salida','escalera','ascensor','bano','vestuario','recepcion','otro')),
  maquina_id uuid references public.maquina(id) on delete cascade,  -- solo si tipo='maquina'
  etiqueta   text,                                                  -- texto libre (ref 'otro', o nota)
  created_at timestamptz not null default now(),
  unique (piso_id, fila, columna)
);
create index if not exists piso_elemento_piso_idx on public.piso_elemento (piso_id);
create index if not exists piso_elemento_maquina_idx on public.piso_elemento (maquina_id);

alter table public.piso_elemento enable row level security;
-- Staff de la sede del piso (via sede_piso).
drop policy if exists piso_elemento_staff on public.piso_elemento;
create policy piso_elemento_staff on public.piso_elemento for all to authenticated
  using (exists (select 1 from public.sede_piso sp
                 where sp.id = piso_elemento.piso_id and sp.empresa_id = public.auth_empresa_id()
                   and (sp.sede_id in (select public.auth_sede_ids()) or public.auth_is_admin())))
  with check (exists (select 1 from public.sede_piso sp
                 where sp.id = piso_elemento.piso_id and sp.empresa_id = public.auth_empresa_id()
                   and (sp.sede_id in (select public.auth_sede_ids()) or public.auth_is_admin())));
-- Socio: lee los elementos de los pisos de su sede.
drop policy if exists piso_elemento_socio on public.piso_elemento;
create policy piso_elemento_socio on public.piso_elemento for select to authenticated
  using (exists (select 1 from public.sede_piso sp join public.socio s on s.sede_id = sp.sede_id
                 where sp.id = piso_elemento.piso_id and s.usuario_id = auth.uid() and s.deleted_at is null));

-- Todo lo colocado en un piso: máquinas (con su nombre) y referencias (con etiqueta).
create or replace function public.elementos_del_piso(p_piso_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pe.id, 'fila', pe.fila, 'columna', pe.columna, 'tipo', pe.tipo,
    'maquina_id', pe.maquina_id, 'etiqueta', pe.etiqueta,
    'nombre', coalesce(m.nombre, pe.etiqueta), 'zona', m.zona, 'estado', m.estado)
    order by pe.fila, pe.columna), '[]'::jsonb)
  from public.piso_elemento pe
  left join public.maquina m on m.id = pe.maquina_id
  where pe.piso_id = p_piso_id;
$$;
grant execute on function public.elementos_del_piso(uuid) to authenticated, service_role;

-- Colocar un elemento en una casilla. Valida: casilla dentro de la grilla, que sea
-- piso (existe en piso_casilla, o el piso no tiene forma = todo piso), y que la
-- máquina (si tipo='maquina') sea de la sede del piso. La RLS restringe al staff.
create or replace function public.colocar_elemento(
  p_piso_id uuid, p_fila int, p_columna int, p_tipo text, p_maquina_id uuid default null, p_etiqueta text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_emp uuid; v_sede uuid; v_filas int; v_columnas int; v_tiene_forma boolean;
begin
  select empresa_id, sede_id, filas, columnas into v_emp, v_sede, v_filas, v_columnas
    from public.sede_piso where id = p_piso_id;
  if v_emp is null then raise exception 'piso no encontrado o sin acceso'; end if;
  if p_fila < 0 or p_fila >= v_filas or p_columna < 0 or p_columna >= v_columnas then
    raise exception 'casilla fuera del piso';
  end if;
  -- si el piso tiene forma dibujada, la casilla debe ser piso
  select exists (select 1 from public.piso_casilla where piso_id = p_piso_id) into v_tiene_forma;
  if v_tiene_forma and not exists (select 1 from public.piso_casilla where piso_id = p_piso_id and fila = p_fila and columna = p_columna) then
    raise exception 'esa casilla no es parte del piso';
  end if;
  if p_tipo = 'maquina' then
    if p_maquina_id is null then raise exception 'falta la máquina'; end if;
    if not exists (select 1 from public.maquina where id = p_maquina_id and sede_id = v_sede and deleted_at is null) then
      raise exception 'la máquina no es de esta sede';
    end if;
  end if;
  insert into public.piso_elemento (empresa_id, piso_id, fila, columna, tipo, maquina_id, etiqueta)
  values (v_emp, p_piso_id, p_fila, p_columna, p_tipo, case when p_tipo='maquina' then p_maquina_id else null end, nullif(trim(p_etiqueta),''))
  on conflict (piso_id, fila, columna) do update
    set tipo = excluded.tipo, maquina_id = excluded.maquina_id, etiqueta = excluded.etiqueta;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.colocar_elemento(uuid,int,int,text,uuid,text) to authenticated, service_role;

-- Quitar el elemento de una casilla.
create or replace function public.quitar_elemento(p_piso_id uuid, p_fila int, p_columna int)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  delete from public.piso_elemento where piso_id = p_piso_id and fila = p_fila and columna = p_columna;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.quitar_elemento(uuid,int,int) to authenticated, service_role;

-- Cuántas unidades de cada máquina de la sede ya están colocadas (en cualquier
-- piso), para que el editor muestre "quedan N por ubicar" = unidades − colocadas.
create or replace function public.maquinas_colocadas_sede(p_sede_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_object_agg(maquina_id, n), '{}'::jsonb) from (
    select pe.maquina_id, count(*) as n
    from public.piso_elemento pe
    join public.maquina m on m.id = pe.maquina_id
    where m.sede_id = p_sede_id and pe.tipo = 'maquina'
    group by pe.maquina_id
  ) x;
$$;
grant execute on function public.maquinas_colocadas_sede(uuid) to authenticated, service_role;
