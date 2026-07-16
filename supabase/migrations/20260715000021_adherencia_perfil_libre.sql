-- PEDIDO 40 (app): ADHERENCIA de la rutina libre + PERFIL PERSONAL para
-- usuarios SIN gym.
--
-- PARTE 1 — Adherencia: tabla registro_entreno_libre (marca por día si un
-- ejercicio de la rutina libre se completó), RLS aislada por auth.uid().
--   marcar_entreno_libre(p_ejercicio_id, p_fecha, p_completado) -> jsonb
--     Upsert del check del día para un ejercicio de LA PROPIA rutina libre.
--   mi_adherencia_libre(p_fecha) -> jsonb
--     Array de rutina_libre_ejercicio_id completados ese día.
--
-- PARTE 2 — Perfil de usuario sin gym: nuevas columnas en public.usuario
-- (objetivo, foto_url, peso_kg, talla_m, fecha_nacimiento) + RPCs
-- get_mi_perfil / actualizar_mi_perfil / subir_mi_foto_perfil, todas
-- operando exclusivamente sobre auth.uid() (nunca sobre un id externo).

-- ============================================================
-- PARTE 1 — ESQUEMA adherencia
-- ============================================================

create table public.registro_entreno_libre (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid(),
  rutina_libre_ejercicio_id uuid not null references public.rutina_libre_ejercicio(id) on delete cascade,
  fecha date not null,
  completado boolean not null default true,
  creado_at timestamptz not null default now(),
  unique (usuario_id, rutina_libre_ejercicio_id, fecha)
);

create index registro_entreno_libre_usuario_fecha_idx
  on public.registro_entreno_libre (usuario_id, fecha);

alter table public.registro_entreno_libre enable row level security;

create policy registro_entreno_libre_propio on public.registro_entreno_libre
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

grant select, insert, update, delete on public.registro_entreno_libre to authenticated;

-- ============================================================
-- marcar_entreno_libre: upsert del check de un ejercicio en una fecha.
-- Verifica que el ejercicio pertenezca a una rutina libre del usuario.
-- ============================================================

create or replace function public.marcar_entreno_libre(
  p_ejercicio_id uuid,
  p_fecha date,
  p_completado boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_completado boolean;
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

  if not exists (
    select 1
    from public.rutina_libre_ejercicio re
    join public.rutina_libre_dia d on d.id = re.rutina_libre_dia_id
    join public.rutina_libre rl on rl.id = d.rutina_libre_id
    where re.id = p_ejercicio_id and rl.usuario_id = v_usuario
  ) then
    raise exception 'el ejercicio no pertenece a tu rutina libre';
  end if;

  insert into public.registro_entreno_libre
    (usuario_id, rutina_libre_ejercicio_id, fecha, completado)
  values (v_usuario, p_ejercicio_id, p_fecha, coalesce(p_completado, true))
  on conflict (usuario_id, rutina_libre_ejercicio_id, fecha)
  do update set completado = excluded.completado
  returning completado into v_completado;

  return jsonb_build_object('ok', true, 'completado', v_completado);
end;
$function$;

revoke all on function public.marcar_entreno_libre(uuid, date, boolean) from public;
grant execute on function public.marcar_entreno_libre(uuid, date, boolean) to authenticated;

-- ============================================================
-- mi_adherencia_libre: ejercicios completados por el usuario en una fecha.
-- ============================================================

create or replace function public.mi_adherencia_libre(p_fecha date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(rutina_libre_ejercicio_id), '[]'::jsonb)
  from public.registro_entreno_libre
  where usuario_id = auth.uid()
    and fecha = p_fecha
    and completado;
$$;

revoke all on function public.mi_adherencia_libre(date) from public;
grant execute on function public.mi_adherencia_libre(date) to authenticated;

-- ============================================================
-- PARTE 2 — Perfil de usuario sin gym.
-- ============================================================

alter table public.usuario
  add column if not exists objetivo text,
  add column if not exists foto_url text,
  add column if not exists peso_kg numeric,
  add column if not exists talla_m numeric,
  add column if not exists fecha_nacimiento date;

-- ============================================================
-- get_mi_perfil: perfil del usuario logueado (auth.uid()), sin args.
-- ============================================================

create or replace function public.get_mi_perfil()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_perfil jsonb;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  select jsonb_build_object(
    'id', u.id,
    'nombre', u.nombre,
    'email', u.email,
    'telefono', u.telefono,
    'documento', u.documento,
    'objetivo', u.objetivo,
    'foto_url', u.foto_url,
    'peso_kg', u.peso_kg,
    'talla_m', u.talla_m,
    'fecha_nacimiento', u.fecha_nacimiento
  )
  into v_perfil
  from public.usuario u
  where u.id = v_usuario;

  if v_perfil is null then
    v_perfil := jsonb_build_object(
      'id', v_usuario,
      'nombre', null,
      'email', null,
      'telefono', null,
      'documento', null,
      'objetivo', null,
      'foto_url', null,
      'peso_kg', null,
      'talla_m', null,
      'fecha_nacimiento', null
    );
  end if;

  return v_perfil;
end;
$function$;

revoke all on function public.get_mi_perfil() from public;
grant execute on function public.get_mi_perfil() to authenticated;

-- ============================================================
-- actualizar_mi_perfil: actualiza (o crea) la fila usuario del que llama.
-- Cada campo se coalesce con el valor actual para no borrar datos.
-- ============================================================

create or replace function public.actualizar_mi_perfil(
  p_nombre text default null,
  p_telefono text default null,
  p_objetivo text default null,
  p_peso_kg numeric default null,
  p_talla_m numeric default null,
  p_fecha_nacimiento date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  update public.usuario u
     set nombre = coalesce(p_nombre, u.nombre),
         telefono = coalesce(p_telefono, u.telefono),
         objetivo = coalesce(p_objetivo, u.objetivo),
         peso_kg = coalesce(p_peso_kg, u.peso_kg),
         talla_m = coalesce(p_talla_m, u.talla_m),
         fecha_nacimiento = coalesce(p_fecha_nacimiento, u.fecha_nacimiento),
         updated_at = now()
   where u.id = v_usuario;

  if not found then
    insert into public.usuario (id, nombre, telefono, objetivo, peso_kg, talla_m, fecha_nacimiento)
    values (v_usuario, coalesce(p_nombre, ''), p_telefono, p_objetivo, p_peso_kg, p_talla_m, p_fecha_nacimiento);
  end if;

  return public.get_mi_perfil();
end;
$function$;

revoke all on function public.actualizar_mi_perfil(text, text, text, numeric, numeric, date) from public;
grant execute on function public.actualizar_mi_perfil(text, text, text, numeric, numeric, date) to authenticated;

-- ============================================================
-- subir_mi_foto_perfil: sube/actualiza la foto de perfil a nivel usuario
-- (distinto de subir_mi_foto, que exige ser socio y opera sobre `socio`).
-- ============================================================

create or replace function public.subir_mi_foto_perfil(p_foto_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  if coalesce(trim(p_foto_url), '') = '' then
    raise exception 'Falta la foto';
  end if;

  update public.usuario
     set foto_url = p_foto_url, updated_at = now()
   where id = v_usuario;

  if not found then
    insert into public.usuario (id, nombre, foto_url)
    values (v_usuario, '', p_foto_url);
  end if;

  return jsonb_build_object('ok', true, 'foto_url', p_foto_url);
end;
$function$;

revoke all on function public.subir_mi_foto_perfil(text) from public;
grant execute on function public.subir_mi_foto_perfil(text) to authenticated;
