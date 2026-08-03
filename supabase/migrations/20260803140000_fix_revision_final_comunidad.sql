-- Correcciones de la revisión final whole-branch de las rutinas de comunidad.
-- Los cuatro fallos solo se ven mirando los 9 commits juntos: ninguna revisión
-- por tarea podía detectarlos, porque cada uno cumplía su propio brief.

-- ── 1. CRITICAL: rutinas_pendientes filtraba rutinas ajenas a cualquiera ─────
-- Es `security definer`, así que se salta la RLS que sí protege el SELECT
-- directo. Sin comprobar superadmin, cualquiera con la anon key llamaba la RPC
-- y leía las rutinas pendientes de otros con su descripción y su autor. El gate
-- `esSuperadmin` del panel era solo cosmético: protege el botón, no el dato.
create or replace function public.rutinas_pendientes()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
begin
  if not public.es_superadmin() then
    raise exception 'Solo el administrador de la plataforma puede ver las rutinas pendientes';
  end if;

  return coalesce((
    select jsonb_agg(t order by t.created_at)
    from (
      select rp.id, rp.nombre, rp.descripcion, rp.objetivo, rp.nivel,
             rp.dias_por_semana, rp.equipo, rp.created_at,
             coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1)) as autor
      from public.rutina_predisenada rp
      join public.usuario u on u.id = rp.autor_id
      where rp.estado = 'pendiente'
    ) t
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.rutinas_pendientes() from public;
grant execute on function public.rutinas_pendientes() to authenticated;

-- ── 2. CRITICAL: se podía publicar en 'rehabilitacion' ──────────────────────
-- El spec prohíbe expresamente publicar en categorías sensibles: son las que
-- más daño hacen mal hechas. El bloqueo vivía SOLO en la lista de objetivos del
-- diálogo de la app — o sea, en la interfaz, no en la regla. Cualquiera podía
-- llamar la RPC directamente con 'rehabilitacion' y colarla.
-- ('prenatal' no es un objetivo sino una categoría, así que quedaba cubierto
-- por accidente; se nombra igual para que la regla sea explícita.)
create or replace function public.publicar_mi_rutina(
  p_rutina_libre uuid,
  p_descripcion text,
  p_objetivo text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  -- La regla de salud, en el backend y no solo en la pantalla.
  if p_objetivo in ('rehabilitacion', 'prenatal') then
    raise exception 'Las rutinas de rehabilitación y prenatales solo puede publicarlas FitCore: necesitan revisión profesional';
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

  if exists (
    select 1
    from public.rutina_libre_dia d
    join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
    where d.rutina_libre_id = v_rl.id and e.catalogo_id is null
  ) then
    raise exception 'Tu rutina tiene ejercicios sin enlazar al catálogo; edítala antes de compartirla';
  end if;

  insert into public.rutina_predisenada
    (slug, nombre, categoria, descripcion, nivel, dias_por_semana, equipo,
     activa, autor_id, estado, objetivo)
  values (
    'u-' || replace(gen_random_uuid()::text, '-', ''),
    coalesce(nullif(trim(v_rl.nombre),''), 'Rutina de la comunidad'),
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
$function$;

revoke all on function public.publicar_mi_rutina(uuid, text, text) from public;
grant execute on function public.publicar_mi_rutina(uuid, text, text) to authenticated;

-- ── 3 y 4. IMPORTANT: adoptar borraba la rutina y aceptaba retiradas ────────
-- (3) Toda esta funcionalidad se llama "guarda varias rutinas", pero el camino
--     MÁS usado —adoptar del catálogo— seguía con el `delete` que la Parte A
--     quitó de las otras dos funciones. Se quitó en 2 sitios de 3.
-- (4) Filtraba `where activa` sin mirar `estado`, así que una rutina retirada
--     por reportes seguía siendo adoptable por id: desaparecía del listado pero
--     no del alcance, lo que vacía de sentido a `reportar_rutina`.
create or replace function public.adoptar_rutina_predisenada(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_p record;
  v_nueva uuid;
  v_dia record;
  v_dia_nuevo uuid;
begin
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;

  -- Solo rutinas APROBADAS: una retirada (3 reportes) o pendiente ya no se
  -- puede adoptar aunque se conozca su id.
  select * into v_p from public.rutina_predisenada
   where id = p_id and activa and estado = 'aprobada';
  if not found then raise exception 'Esa rutina ya no está disponible'; end if;

  -- ARCHIVA la anterior, no la borra (igual que generar_rutina_libre).
  update public.rutina_libre set activa = false
   where usuario_id = v_usuario and activa;

  insert into public.rutina_libre
    (usuario_id, nombre, objetivo, activa, equipo, origen_predisenada_id)
  values (v_usuario, v_p.nombre, v_p.objetivo, true, v_p.equipo, p_id)
  returning id into v_nueva;

  for v_dia in
    select * from public.rutina_predisenada_dia
     where predisenada_id = p_id order by dia_semana
  loop
    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
    values (v_nueva, v_dia.dia_semana, v_dia.foco)
    returning id into v_dia_nuevo;

    insert into public.rutina_libre_ejercicio
      (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
    select v_dia_nuevo, e.catalogo_id, e.nombre, e.series, e.reps, e.descanso, e.orden
    from public.rutina_predisenada_ejercicio e
    where e.predisenada_dia_id = v_dia.id
    order by e.orden;
  end loop;

  update public.rutina_predisenada
     set veces_adoptada = veces_adoptada + 1
   where id = p_id;

  return public._rutina_libre_detalle(v_nueva);
end;
$function$;

revoke all on function public.adoptar_rutina_predisenada(uuid) from public;
grant execute on function public.adoptar_rutina_predisenada(uuid) to authenticated;
