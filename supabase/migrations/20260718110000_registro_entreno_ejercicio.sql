-- Adherencia POR EJERCICIO de la rutina asignada, con la carga usada. Copia el
-- patrón de registro_entreno (por día) + marcar_entreno_libre (upsert). La app
-- persiste aquí su check por ejercicio (hoy solo visual) y la carga.
create table if not exists public.registro_entreno_ejercicio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  socio_id uuid not null references public.socio(id) on delete cascade,
  rutina_ejercicio_id uuid not null references public.rutina_ejercicio(id) on delete cascade,
  fecha date not null,
  completado boolean not null default true,
  carga_usada numeric,
  created_at timestamptz not null default now(),
  unique (socio_id, rutina_ejercicio_id, fecha)
);
create index if not exists ree_socio_fecha_idx on public.registro_entreno_ejercicio (socio_id, fecha);

alter table public.registro_entreno_ejercicio enable row level security;
-- el socio maneja lo suyo
drop policy if exists ree_socio on public.registro_entreno_ejercicio;
create policy ree_socio on public.registro_entreno_ejercicio for all to authenticated
  using (exists (select 1 from public.socio s where s.id = registro_entreno_ejercicio.socio_id and s.usuario_id = auth.uid()))
  with check (exists (select 1 from public.socio s where s.id = registro_entreno_ejercicio.socio_id and s.usuario_id = auth.uid()));
-- el staff lee lo de su empresa
drop policy if exists ree_staff on public.registro_entreno_ejercicio;
create policy ree_staff on public.registro_entreno_ejercicio for select to authenticated
  using (empresa_id = public.auth_empresa_id());

-- RPC: la app la llama al marcar. Valida que el ejercicio es de una rutina del
-- socio autenticado; upsert por (socio, ejercicio, fecha).
create or replace function public.marcar_entreno_ejercicio(
  p_rutina_ejercicio_id uuid, p_fecha date, p_completado boolean, p_carga_usada numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_socio uuid; v_emp uuid; v_completado boolean;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  if p_rutina_ejercicio_id is null or p_fecha is null then raise exception 'faltan datos'; end if;

  -- el ejercicio debe ser de una rutina de un socio de este usuario
  select s.id, s.empresa_id into v_socio, v_emp
  from public.rutina_ejercicio re
  join public.rutina_dia rd on rd.id = re.rutina_dia_id
  join public.rutina r on r.id = rd.rutina_id
  join public.socio s on s.id = r.socio_id
  where re.id = p_rutina_ejercicio_id and s.usuario_id = v_uid
  limit 1;
  if v_socio is null then raise exception 'el ejercicio no pertenece a tu rutina'; end if;

  insert into public.registro_entreno_ejercicio
    (empresa_id, socio_id, rutina_ejercicio_id, fecha, completado, carga_usada)
  values (v_emp, v_socio, p_rutina_ejercicio_id, p_fecha, coalesce(p_completado, true), p_carga_usada)
  on conflict (socio_id, rutina_ejercicio_id, fecha)
  do update set completado = excluded.completado, carga_usada = excluded.carga_usada
  returning completado into v_completado;

  return jsonb_build_object('ok', true, 'completado', v_completado);
end $$;
revoke all on function public.marcar_entreno_ejercicio(uuid,date,boolean,numeric) from public;
grant execute on function public.marcar_entreno_ejercicio(uuid,date,boolean,numeric) to authenticated, service_role;
