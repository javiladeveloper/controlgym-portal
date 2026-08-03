-- Puntuación por estrellas de rutinas de comunidad + catálogo con filtros y
-- orden. Solo vota quien adoptó la rutina (rutina_libre.origen_predisenada_id
-- la delata): la nota mide si la rutina sirve en la práctica, no si el título
-- suena bien a quien nunca la probó.

create table if not exists public.rutina_voto (
  rutina_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  estrellas int not null check (estrellas between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (rutina_id, usuario_id)
);

alter table public.rutina_voto enable row level security;

-- Cada quien ve y gestiona SUS votos; el agregado (promedio/conteo) va por RPC
-- security definer, no por consulta directa a la tabla.
drop policy if exists rutina_voto_propio on public.rutina_voto;
create policy rutina_voto_propio on public.rutina_voto
  for all to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

-- Denormalizado en rutina_predisenada para ordenar el catálogo sin recalcular
-- el agregado de rutina_voto en cada consulta de listado.
alter table public.rutina_predisenada
  add column if not exists puntuacion_prom numeric(3,2) not null default 0,
  add column if not exists votos int not null default 0,
  add column if not exists veces_adoptada int not null default 0;

-- Vota/actualiza tu voto sobre una rutina de comunidad. Exige haber adoptado
-- esa rutina primero (join contra rutina_libre.origen_predisenada_id): así se
-- evita que la puntuación se convierta en un concurso de popularidad del
-- título/descripcion en vez de una señal de calidad real de la rutina.
create or replace function public.votar_rutina(p_rutina uuid, p_estrellas int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if p_estrellas < 1 or p_estrellas > 5 then
    raise exception 'La puntuación va de 1 a 5';
  end if;
  if not exists (
    select 1 from public.rutina_libre
     where usuario_id = v_uid and origen_predisenada_id = p_rutina
  ) then
    raise exception 'Solo puedes puntuar una rutina que hayas usado';
  end if;

  insert into public.rutina_voto (rutina_id, usuario_id, estrellas)
  values (p_rutina, v_uid, p_estrellas)
  on conflict (rutina_id, usuario_id)
  do update set estrellas = excluded.estrellas, created_at = now();

  update public.rutina_predisenada rp
     set votos = v.n, puntuacion_prom = v.prom
    from (select count(*) n, round(avg(estrellas), 2) prom
          from public.rutina_voto where rutina_id = p_rutina) v
   where rp.id = p_rutina;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.votar_rutina(uuid, int) from public;
grant execute on function public.votar_rutina(uuid, int) to authenticated;

-- Catálogo de comunidad con filtros y orden.
-- El orden 'puntuacion' usa promedio BAYESIANO: sin él, una rutina con un único
-- 5★ encabeza la lista por delante de una con 4.5★ y 200 votos.
create or replace function public.listar_rutinas_comunidad(
  p_orden text default 'puntuacion',
  p_objetivo text default null,
  p_nivel text default null,
  p_dias int default null,
  p_equipo text default null,
  p_buscar text default null
) returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  with params as (
    select 5::numeric as m,
           coalesce((select avg(puntuacion_prom) from public.rutina_predisenada
                      where estado='aprobada' and autor_id is not null and votos > 0), 3.5) as c
  )
  select coalesce(jsonb_agg(t order by
           case when p_orden = 'usadas' then t.veces_adoptada end desc nulls last,
           case when p_orden = 'nuevas' then extract(epoch from t.aprobada_at) end desc nulls last,
           case when p_orden not in ('usadas','nuevas') then t.ranking end desc nulls last
         ), '[]'::jsonb)
  from (
    select rp.id, rp.nombre, rp.descripcion, rp.objetivo, rp.nivel,
           rp.dias_por_semana, rp.equipo, rp.puntuacion_prom, rp.votos,
           rp.veces_adoptada, rp.aprobada_at,
           coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1)) as autor,
           (rp.votos / (rp.votos + p.m)) * rp.puntuacion_prom
             + (p.m / (rp.votos + p.m)) * p.c as ranking
    from public.rutina_predisenada rp
    join public.usuario u on u.id = rp.autor_id
    cross join params p
    where rp.estado = 'aprobada'
      and rp.autor_id is not null
      and (p_objetivo is null or rp.objetivo = p_objetivo)
      and (p_nivel is null or rp.nivel = p_nivel)
      and (p_equipo is null or rp.equipo = p_equipo)
      and (p_dias is null or
           (p_dias = 2 and rp.dias_por_semana <= 2) or
           (p_dias = 4 and rp.dias_por_semana between 3 and 4) or
           (p_dias = 5 and rp.dias_por_semana >= 5))
      and (p_buscar is null or
           rp.nombre ilike '%' || p_buscar || '%' or
           coalesce(rp.descripcion,'') ilike '%' || p_buscar || '%')
  ) t;
$$;

revoke all on function public.listar_rutinas_comunidad(text, text, text, int, text, text) from public;
grant execute on function public.listar_rutinas_comunidad(text, text, text, int, text, text) to authenticated;

-- adoptar_rutina_predisenada: se reescribe ENTERA (misma firma, sin drop) para
-- sumar dos cosas sin tocar el resto de su lógica: dejar constancia de qué
-- rutina de comunidad se adoptó (origen_predisenada_id, lo que luego usa
-- votar_rutina para saber quién puede puntuar) y llevar la cuenta de cuántas
-- veces se adoptó cada rutina (veces_adoptada, para el orden 'usadas' del
-- catálogo).
create or replace function public.adoptar_rutina_predisenada(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
  v_rutina uuid; v_dia uuid; v_p record; r_dia record; r_ej record;
begin
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;
  select * into v_p from public.rutina_predisenada where id = p_id and activa;
  if not found then raise exception 'rutina prediseñada no encontrada'; end if;

  delete from public.rutina_libre where usuario_id = v_usuario and activa;
  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa, equipo)
    values (v_usuario, v_p.nombre, v_p.categoria, true, v_p.equipo)
    returning id into v_rutina;

  for r_dia in select * from public.rutina_predisenada_dia
               where predisenada_id = p_id order by dia_semana loop
    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
      values (v_rutina, r_dia.dia_semana, r_dia.foco) returning id into v_dia;
    for r_ej in select * from public.rutina_predisenada_ejercicio
                where predisenada_dia_id = r_dia.id order by orden loop
      insert into public.rutina_libre_ejercicio
        (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
        values (v_dia, r_ej.catalogo_id, r_ej.nombre, r_ej.series, r_ej.reps, r_ej.descanso, r_ej.orden);
    end loop;
  end loop;

  -- Marca de dónde salió esta rutina adoptada: la usa votar_rutina() para
  -- comprobar que quien puntúa realmente la usó.
  update public.rutina_libre set origen_predisenada_id = p_id
   where id = v_rutina;
  -- Contador para el orden 'usadas' del catálogo de comunidad.
  update public.rutina_predisenada set veces_adoptada = veces_adoptada + 1
   where id = p_id;

  return public._rutina_libre_detalle(v_rutina);
end;
$$;

revoke all on function public.adoptar_rutina_predisenada(uuid) from public;
grant execute on function public.adoptar_rutina_predisenada(uuid) to authenticated;
