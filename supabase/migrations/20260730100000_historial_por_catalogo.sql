-- BLOQUE 1 (spec 2026-07-30-entrenamiento-completo-app-design.md): cimiento de
-- datos para que el historial de un ejercicio SOBREVIVA a cambios de rutina.
--
-- Problema: registro_entreno_libre.rutina_libre_ejercicio_id y
-- registro_entreno_ejercicio.rutina_ejercicio_id atan el registro al SLOT de
-- la rutina, con on delete cascade. Al regenerar/cambiar rutina el slot se
-- borra -> el historial se pierde. El catalogo_id existe en las tablas de
-- slot (rutina_libre_ejercicio.catalogo_id, ejercicio.catalogo_id) pero NO se
-- copiaba al registro.
--
-- Solución (aditiva):
--   1) columna catalogo_id en ambas tablas de registro.
--   2) backfill desde el slot mientras aún exista.
--   3) FK del slot: cascade -> set null (el registro sobrevive, catalogo_id
--      queda como eje estable para cruzar rutinas; el slot_id queda null).
--   4) marcar_entreno_libre / marcar_entreno_ejercicio: resuelven y guardan
--      catalogo_id en cada upsert.

-- ============================================================
-- 1) columnas nuevas
-- ============================================================

alter table public.registro_entreno_libre
  add column if not exists catalogo_id uuid references public.ejercicio_catalogo(id);

alter table public.registro_entreno_ejercicio
  add column if not exists catalogo_id uuid references public.ejercicio_catalogo(id);

-- ============================================================
-- 2) backfill de registros existentes, cruzando por el slot mientras exista
-- ============================================================

update public.registro_entreno_libre r
   set catalogo_id = e.catalogo_id
  from public.rutina_libre_ejercicio e
 where e.id = r.rutina_libre_ejercicio_id
   and r.catalogo_id is null
   and e.catalogo_id is not null;

update public.registro_entreno_ejercicio r
   set catalogo_id = ej.catalogo_id
  from public.rutina_ejercicio re
  join public.ejercicio ej on ej.id = re.ejercicio_id
 where re.id = r.rutina_ejercicio_id
   and r.catalogo_id is null
   and ej.catalogo_id is not null;

-- ============================================================
-- 3) FK del slot: cascade -> set null (columna del slot pasa a nullable)
-- ============================================================

alter table public.registro_entreno_libre
  alter column rutina_libre_ejercicio_id drop not null;

alter table public.registro_entreno_libre
  drop constraint if exists registro_entreno_libre_rutina_libre_ejercicio_id_fkey;

alter table public.registro_entreno_libre
  add constraint registro_entreno_libre_rutina_libre_ejercicio_id_fkey
  foreign key (rutina_libre_ejercicio_id)
  references public.rutina_libre_ejercicio(id)
  on delete set null;

alter table public.registro_entreno_ejercicio
  alter column rutina_ejercicio_id drop not null;

alter table public.registro_entreno_ejercicio
  drop constraint if exists registro_entreno_ejercicio_rutina_ejercicio_id_fkey;

alter table public.registro_entreno_ejercicio
  add constraint registro_entreno_ejercicio_rutina_ejercicio_id_fkey
  foreign key (rutina_ejercicio_id)
  references public.rutina_ejercicio(id)
  on delete set null;

-- Nota: los unique existentes (usuario_id/socio_id, slot_id, fecha) se
-- mantienen intactos. Postgres trata múltiples NULL en slot_id como valores
-- distintos a efectos de unicidad, así que varios registros "huérfanos" (slot
-- borrado) para el mismo usuario/fecha no chocan entre sí.

-- ============================================================
-- 4) marcar_entreno_libre: resuelve y guarda catalogo_id desde el slot
-- ============================================================

create or replace function public.marcar_entreno_libre(
  p_ejercicio_id uuid,
  p_fecha date,
  p_completado boolean,
  p_carga_usada numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_usuario uuid;
  v_completado boolean;
  v_catalogo_id uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  if p_ejercicio_id is null then
    raise exception 'falta el ejercicio';
  end if;

  if p_fecha is null then
    raise exception 'falta la fecha';
  end if;

  select re.catalogo_id into v_catalogo_id
  from public.rutina_libre_ejercicio re
  join public.rutina_libre_dia d on d.id = re.rutina_libre_dia_id
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where re.id = p_ejercicio_id and rl.usuario_id = v_usuario;

  if not found then
    raise exception 'el ejercicio no pertenece a tu rutina libre';
  end if;

  insert into public.registro_entreno_libre
    (usuario_id, rutina_libre_ejercicio_id, fecha, completado, carga_usada, catalogo_id)
  values (v_usuario, p_ejercicio_id, p_fecha, coalesce(p_completado, true), p_carga_usada, v_catalogo_id)
  on conflict (usuario_id, rutina_libre_ejercicio_id, fecha)
  do update set completado = excluded.completado,
                carga_usada = excluded.carga_usada,
                catalogo_id = excluded.catalogo_id
  returning completado into v_completado;

  return jsonb_build_object('ok', true, 'completado', v_completado);
end;
$function$;

revoke all on function public.marcar_entreno_libre(uuid, date, boolean, numeric) from public, authenticated;
grant execute on function public.marcar_entreno_libre(uuid, date, boolean, numeric) to authenticated;

-- ============================================================
-- 4) marcar_entreno_ejercicio: resuelve y guarda catalogo_id desde el slot
-- ============================================================

create or replace function public.marcar_entreno_ejercicio(
  p_rutina_ejercicio_id uuid, p_fecha date, p_completado boolean, p_carga_usada numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_socio uuid;
  v_emp uuid;
  v_completado boolean;
  v_catalogo_id uuid;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  if p_rutina_ejercicio_id is null or p_fecha is null then raise exception 'faltan datos'; end if;

  -- el ejercicio debe ser de una rutina de un socio de este usuario
  select s.id, s.empresa_id, ej.catalogo_id into v_socio, v_emp, v_catalogo_id
  from public.rutina_ejercicio re
  join public.rutina_dia rd on rd.id = re.rutina_dia_id
  join public.rutina r on r.id = rd.rutina_id
  join public.socio s on s.id = r.socio_id
  left join public.ejercicio ej on ej.id = re.ejercicio_id
  where re.id = p_rutina_ejercicio_id and s.usuario_id = v_uid
  limit 1;
  if v_socio is null then raise exception 'el ejercicio no pertenece a tu rutina'; end if;

  insert into public.registro_entreno_ejercicio
    (empresa_id, socio_id, rutina_ejercicio_id, fecha, completado, carga_usada, catalogo_id)
  values (v_emp, v_socio, p_rutina_ejercicio_id, p_fecha, coalesce(p_completado, true), p_carga_usada, v_catalogo_id)
  on conflict (socio_id, rutina_ejercicio_id, fecha)
  do update set completado = excluded.completado,
                carga_usada = excluded.carga_usada,
                catalogo_id = excluded.catalogo_id
  returning completado into v_completado;

  return jsonb_build_object('ok', true, 'completado', v_completado);
end $$;
revoke all on function public.marcar_entreno_ejercicio(uuid,date,boolean,numeric) from public;
grant execute on function public.marcar_entreno_ejercicio(uuid,date,boolean,numeric) to authenticated, service_role;
