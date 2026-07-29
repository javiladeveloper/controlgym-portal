-- Rutinas prediseñadas curadas para el usuario en casa (sin gym). Catálogo
-- GLOBAL (sin empresa_id), como ejercicio_catalogo: cualquiera las lee, solo
-- service_role las cura. El usuario las "adopta" copiándolas a su rutina_libre.

create table public.rutina_predisenada (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  nombre        text not null,
  categoria     text not null,
  descripcion   text,
  nivel         text not null default 'principiante'
                  check (nivel in ('principiante','intermedio','avanzado')),
  dias_por_semana int not null check (dias_por_semana between 1 and 6),
  equipo        text not null default 'peso_corporal'
                  check (equipo in ('peso_corporal','mancuernas','gym_completo')),
  disclaimer_salud text,
  imagen        text,
  orden         int not null default 0,
  activa        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index rutina_predisenada_cat_idx on public.rutina_predisenada (categoria, activa, orden);

create table public.rutina_predisenada_dia (
  id            uuid primary key default gen_random_uuid(),
  predisenada_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  dia_semana    int not null,
  foco          text
);
create index rutina_predisenada_dia_idx on public.rutina_predisenada_dia (predisenada_id);

create table public.rutina_predisenada_ejercicio (
  id            uuid primary key default gen_random_uuid(),
  predisenada_dia_id uuid not null references public.rutina_predisenada_dia(id) on delete cascade,
  catalogo_id   uuid not null references public.ejercicio_catalogo(id),
  nombre        text not null,
  series        int,
  reps          text,
  descanso      text,
  orden         int not null default 0,
  alternativas_ids uuid[] not null default '{}'
);
create index rutina_predisenada_ej_idx on public.rutina_predisenada_ejercicio (predisenada_dia_id);

-- RLS: lectura para cualquier authenticated (catálogo compartido); escritura
-- solo service_role (curado por SQL).
alter table public.rutina_predisenada enable row level security;
alter table public.rutina_predisenada_dia enable row level security;
alter table public.rutina_predisenada_ejercicio enable row level security;

create policy rutina_predisenada_lee on public.rutina_predisenada
  for select to authenticated using (activa);
create policy rutina_predisenada_dia_lee on public.rutina_predisenada_dia
  for select to authenticated using (true);
create policy rutina_predisenada_ej_lee on public.rutina_predisenada_ejercicio
  for select to authenticated using (true);

grant select on public.rutina_predisenada to authenticated;
grant select on public.rutina_predisenada_dia to authenticated;
grant select on public.rutina_predisenada_ejercicio to authenticated;

-- ── listar: tarjetas de la galería ─────────────────────────────────────────
create or replace function public.listar_rutinas_predisenadas(
  p_categoria text default null, p_equipo text default null
) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by sub.orden, sub.nombre), '[]'::jsonb)
  from (
    select p.orden, p.nombre, jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'nombre', p.nombre, 'categoria', p.categoria,
      'descripcion', p.descripcion, 'nivel', p.nivel,
      'dias_por_semana', p.dias_por_semana, 'equipo', p.equipo,
      'disclaimer_salud', p.disclaimer_salud, 'imagen', p.imagen
    ) as t
    from public.rutina_predisenada p
    where p.activa
      and (p_categoria is null or p.categoria = p_categoria)
      and (p_equipo is null or p.equipo = p_equipo)
  ) sub;
$$;
revoke all on function public.listar_rutinas_predisenadas(text,text) from public;
grant execute on function public.listar_rutinas_predisenadas(text,text) to authenticated, service_role;

-- ── detalle: mismo shape que _rutina_libre_detalle + alternativas[] ─────────
create or replace function public.detalle_rutina_predisenada(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with p as (select * from public.rutina_predisenada where id = p_id and activa)
  select case when not exists (select 1 from p) then null else
    jsonb_build_object(
      'id', (select id from p), 'nombre', (select nombre from p),
      'categoria', (select categoria from p), 'descripcion', (select descripcion from p),
      'nivel', (select nivel from p), 'dias_por_semana', (select dias_por_semana from p),
      'equipo', (select equipo from p), 'disclaimer_salud', (select disclaimer_salud from p),
      'dias', coalesce((
        select jsonb_agg(dia order by dia->>'dia_semana')
        from (
          select jsonb_build_object(
            'id', d.id, 'dia_semana', d.dia_semana, 'foco', d.foco,
            'ejercicios', coalesce((
              select jsonb_agg(ej order by (ej->>'orden')::int)
              from (
                select jsonb_build_object(
                  'id', re.id, 'nombre', re.nombre, 'series', re.series, 'reps', re.reps,
                  'descanso', re.descanso, 'orden', re.orden,
                  'video_url', case when c.gif_url is not null and c.gif_url not like '%.gif' then c.gif_url end,
                  'gif_url', case when c.gif_url like '%.gif' then c.gif_url end,
                  'foto_url', c.foto_url,
                  'descripcion', coalesce(c.instrucciones->>'es', c.instrucciones->>'en'),
                  'catalogo_id', c.id, 'target', c.target, 'body_part', c.body_part,
                  'grupo_muscular', c.grupo_muscular, 'secondary', c.secondary, 'equipment', c.equipment,
                  'alternativas', coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'catalogo_id', ac.id, 'nombre', coalesce(ac.nombre_es, ac.nombre),
                      'target', ac.target, 'equipment', ac.equipment,
                      'gif_url', case when ac.gif_url like '%.gif' then ac.gif_url end,
                      'foto_url', ac.foto_url))
                    from public.ejercicio_catalogo ac
                    where ac.id = any (re.alternativas_ids) and ac.activo
                  ), '[]'::jsonb)
                ) as ej
                from public.rutina_predisenada_ejercicio re
                left join public.ejercicio_catalogo c on c.id = re.catalogo_id
                where re.predisenada_dia_id = d.id
              ) x
            ), '[]'::jsonb)
          ) as dia
          from public.rutina_predisenada_dia d where d.predisenada_id = (select id from p)
        ) y
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public.detalle_rutina_predisenada(uuid) from public;
grant execute on function public.detalle_rutina_predisenada(uuid) to authenticated, service_role;

-- ── adoptar: copia la prediseñada a la rutina_libre activa del usuario ──────
create or replace function public.adoptar_rutina_predisenada(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_rutina uuid;
  v_dia uuid;
  v_p record;
  r_dia record;
  r_ej record;
begin
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;
  select * into v_p from public.rutina_predisenada where id = p_id and activa;
  if not found then raise exception 'rutina prediseñada no encontrada'; end if;

  delete from public.rutina_libre where usuario_id = v_usuario and activa;
  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa)
    values (v_usuario, v_p.nombre, v_p.categoria, true)
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

  return public._rutina_libre_detalle(v_rutina);
end;
$$;
revoke all on function public.adoptar_rutina_predisenada(uuid) from public;
grant execute on function public.adoptar_rutina_predisenada(uuid) to authenticated, service_role;
