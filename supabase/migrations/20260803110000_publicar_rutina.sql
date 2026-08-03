-- Publicar rutinas a la comunidad: un usuario copia su rutina_libre a
-- rutina_predisenada como propuesta 'pendiente'; el superadmin la aprueba o
-- la rechaza. Las 5 rutinas curadas no cambian: siguen con autor_id null y
-- estado 'aprobada' por defecto.

-- Campos para que rutina_predisenada aloje también rutinas de usuarios.
-- Las 5 curadas quedan como están: autor_id null + estado 'aprobada'.
alter table public.rutina_predisenada
  add column if not exists autor_id uuid references public.usuario(id) on delete set null,
  add column if not exists estado text not null default 'aprobada'
    check (estado in ('pendiente','aprobada','rechazada','retirada')),
  add column if not exists objetivo text references public.objetivo_entrenamiento(codigo),
  add column if not exists motivo_rechazo text,
  add column if not exists aprobada_at timestamptz;

-- Alias público del autor: usuario.nombre es el nombre REAL, y publicar con
-- nombre y apellido expone a la gente más de lo que espera.
alter table public.usuario add column if not exists nombre_publico text;

-- De qué rutina publicada salió una rutina adoptada. Hace falta para saber
-- quién puede votar (solo vota quien la usó) y para el contador de adopciones.
alter table public.rutina_libre
  add column if not exists origen_predisenada_id uuid
    references public.rutina_predisenada(id) on delete set null;

create index if not exists rutina_predisenada_estado_idx
  on public.rutina_predisenada(estado) where estado = 'aprobada';

-- RLS: la política original (`using (activa)`) solo tenía sentido cuando TODA
-- fila de rutina_predisenada era curada y aprobada de antemano. Ahora que hay
-- propuestas 'pendiente'/'rechazada' insertadas con activa=true, esa política
-- dejaría leer a cualquier authenticated las rutinas de otros mientras esperan
-- moderación (y su motivo_rechazo) con un simple select a la tabla, saltándose
-- por completo el filtro de superadmin de rutinas_pendientes()/resolver_rutina.
-- Se exige además estado='aprobada', o que el autor vea su propia propuesta.
drop policy if exists rutina_predisenada_lee on public.rutina_predisenada;
create policy rutina_predisenada_lee on public.rutina_predisenada
  for select to authenticated
  using (activa and estado = 'aprobada' or autor_id = auth.uid());

-- Los días y ejercicios de una predisenada heredan la misma regla: visibles
-- si la rutina padre está aprobada, o si el que mira es quien la publicó.
drop policy if exists rutina_predisenada_dia_lee on public.rutina_predisenada_dia;
create policy rutina_predisenada_dia_lee on public.rutina_predisenada_dia
  for select to authenticated
  using (exists (
    select 1 from public.rutina_predisenada rp
     where rp.id = rutina_predisenada_dia.predisenada_id
       and (rp.activa and rp.estado = 'aprobada' or rp.autor_id = auth.uid())
  ));

drop policy if exists rutina_predisenada_ej_lee on public.rutina_predisenada_ejercicio;
create policy rutina_predisenada_ej_lee on public.rutina_predisenada_ejercicio
  for select to authenticated
  using (exists (
    select 1 from public.rutina_predisenada_dia d
    join public.rutina_predisenada rp on rp.id = d.predisenada_id
     where d.id = rutina_predisenada_ejercicio.predisenada_dia_id
       and (rp.activa and rp.estado = 'aprobada' or rp.autor_id = auth.uid())
  ));

-- Publica una copia de tu rutina. Se COPIA, no se enlaza: si luego editas la
-- tuya, la publicada no cambia — nadie ve mutar bajo sus pies una rutina que
-- ya está siguiendo.
create or replace function public.publicar_mi_rutina(
  p_rutina_libre uuid,
  p_descripcion text,
  p_objetivo text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_rl record;
  v_nueva uuid;
  v_dia record;
  v_dia_nuevo uuid;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if coalesce(trim(p_descripcion),'') = '' then
    raise exception 'Escribe una descripción para que otros sepan de qué va';
  end if;
  if not exists (select 1 from public.objetivo_entrenamiento where codigo = p_objetivo) then
    raise exception 'Objetivo inválido';
  end if;

  select * into v_rl from public.rutina_libre
   where id = p_rutina_libre and usuario_id = v_uid;
  if not found then raise exception 'Esa rutina no es tuya'; end if;

  if exists (
    select 1 from public.rutina_predisenada
     where autor_id = v_uid and estado = 'pendiente'
  ) then
    raise exception 'Ya tienes una rutina esperando aprobación';
  end if;

  -- rutina_predisenada_ejercicio.catalogo_id es NOT NULL (el catálogo curado
  -- siempre lo trae), pero rutina_libre_ejercicio.catalogo_id sí admite null
  -- (ejercicio suelto sin catálogo). Se corta aquí con un mensaje claro en vez
  -- de reventar con una violación NOT NULL a mitad de copia.
  if exists (
    select 1 from public.rutina_libre_ejercicio e
    join public.rutina_libre_dia d on d.id = e.rutina_libre_dia_id
     where d.rutina_libre_id = v_rl.id and e.catalogo_id is null
  ) then
    raise exception 'Esa rutina tiene ejercicios sin catálogo y no se puede publicar';
  end if;

  insert into public.rutina_predisenada
    (slug, nombre, categoria, descripcion, nivel, dias_por_semana, equipo,
     activa, autor_id, estado, objetivo)
  values (
    'u-' || replace(gen_random_uuid()::text, '-', ''),
    coalesce(nullif(trim(v_rl.nombre),''), 'Rutina de la comunidad'),
    -- categoria 'comunidad' SIEMPRE: prenatal y rehabilitacion quedan
    -- reservadas a las curadas, son las que más daño hacen mal hechas.
    'comunidad',
    trim(p_descripcion),
    'intermedio',
    (select count(*) from public.rutina_libre_dia where rutina_libre_id = v_rl.id),
    coalesce(v_rl.equipo, 'gym_completo'),
    true, v_uid, 'pendiente', p_objetivo
  )
  returning id into v_nueva;

  for v_dia in
    select * from public.rutina_libre_dia
     where rutina_libre_id = v_rl.id order by dia_semana
  loop
    insert into public.rutina_predisenada_dia (predisenada_id, dia_semana, foco)
    values (v_nueva, v_dia.dia_semana, v_dia.foco)
    returning id into v_dia_nuevo;

    insert into public.rutina_predisenada_ejercicio
      (predisenada_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
    select v_dia_nuevo, e.catalogo_id, e.nombre, e.series, e.reps, e.descanso, e.orden
    from public.rutina_libre_ejercicio e
    where e.rutina_libre_dia_id = v_dia.id;
  end loop;

  return jsonb_build_object('ok', true, 'id', v_nueva, 'estado', 'pendiente');
end;
$$;

revoke all on function public.publicar_mi_rutina(uuid, text, text) from public;
grant execute on function public.publicar_mi_rutina(uuid, text, text) to authenticated;

-- Bandeja del owner: rutinas esperando aprobación.
create or replace function public.rutinas_pendientes()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(t order by t.created_at), '[]'::jsonb)
  from (
    select rp.id, rp.nombre, rp.descripcion, rp.objetivo, rp.nivel,
           rp.dias_por_semana, rp.equipo, rp.created_at,
           coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1)) as autor
    from public.rutina_predisenada rp
    join public.usuario u on u.id = rp.autor_id
    where rp.estado = 'pendiente'
  ) t;
$$;

revoke all on function public.rutinas_pendientes() from public;
grant execute on function public.rutinas_pendientes() to authenticated;

-- Aprobar o rechazar. Solo el dueño de la plataforma (no hay rol de moderador
-- todavía): se comprueba con es_superadmin(), la misma que usa
-- get_plataforma_dashboard() para lo mismo — no se crea otro criterio de
-- "quién manda" que con el tiempo acabe divergiendo del original.
create or replace function public.resolver_rutina(
  p_rutina uuid, p_aprobar boolean, p_motivo text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if not public.es_superadmin() then
    raise exception 'Solo el administrador de la plataforma puede moderar rutinas';
  end if;

  update public.rutina_predisenada
     set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         motivo_rechazo = case when p_aprobar then null else p_motivo end,
         aprobada_at = case when p_aprobar then now() else null end
   where id = p_rutina and estado = 'pendiente';
  if not found then raise exception 'Esa rutina no está pendiente'; end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.resolver_rutina(uuid, boolean, text) from public;
grant execute on function public.resolver_rutina(uuid, boolean, text) to authenticated;
