-- Separar el VIDEO del GIF: cada uno en su propia columna.
--
-- PROBLEMA (detectado con el owner): `ejercicio_catalogo.gif_url` guarda DOS
-- cosas distintas — el GIF animado (.gif de Storage) y, en 44 filas, un link de
-- TikTok que PISÓ al GIF. Lo mismo en `ejercicio.video_url` (tabla del gym), que
-- a veces trae un .gif heredado por trigger y otras un link de video.
-- Consecuencia: todas las RPCs tienen que adivinar con `like '%.gif'` cuál es
-- cuál, y un video sobrescribe al GIF (pérdida de contenido).
--
-- FIX: columna `video_url` propia en el catálogo, mover los links ahí, y dejar
-- `gif_url` SOLO para .gif. Así nunca más un video pisa un GIF, y las RPCs leen
-- cada campo del suyo sin heurísticos.
--
-- Nota: los 44 con TikTok son ejercicios "maestro-*" (catálogo legacy) que nunca
-- tuvieron GIF propio del dataset; no hay GIF que recuperar, solo dejar de
-- mezclarlos. Los gyms conservan sus links (376) en su propia columna.

-- ── 1. Catálogo global: columna de video separada ──────────────────────────
alter table public.ejercicio_catalogo
  add column if not exists video_url text;

comment on column public.ejercicio_catalogo.video_url is
  'Link de video de técnica (YouTube/Vimeo/TikTok). SEPARADO de gif_url para que un video nunca pise el GIF animado.';

-- Mover a video_url lo que NO sea un .gif (los 44 TikToks) y limpiar gif_url.
update public.ejercicio_catalogo
set video_url = gif_url,
    gif_url = null
where gif_url is not null
  and gif_url not like '%.gif'
  and video_url is null;

-- ── 2. Tabla del gym: separar el .gif heredado del video real ──────────────
-- El trigger de herencia copiaba gif_url del catálogo a ejercicio.video_url, así
-- que hay .gif viviendo en una columna de video. Se mueve a gif_url (que ya
-- existe para el gym vía 20260704000019_ejercicio_media / catálogo link).
alter table public.ejercicio
  add column if not exists gif_url text;

comment on column public.ejercicio.gif_url is
  'GIF animado propio del gym (o heredado del catálogo). Separado de video_url.';

update public.ejercicio
set gif_url = video_url,
    video_url = null
where video_url like '%.gif'
  and gif_url is null;

-- ── 3. Trigger de herencia: que copie el GIF a gif_url, no a video_url ─────
-- Antes ensuciaba video_url con un .gif. Ahora cada cosa a su columna.
create or replace function public.heredar_media_de_catalogo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_c record;
begin
  if new.catalogo_id is null then return new; end if;
  select gif_url, foto_url, instrucciones into v_c
  from public.ejercicio_catalogo where id = new.catalogo_id;
  if not found then return new; end if;

  -- Solo rellena lo que el gym no haya personalizado.
  if new.gif_url is null then new.gif_url := v_c.gif_url; end if;
  if new.foto_url is null then new.foto_url := v_c.foto_url; end if;
  if new.descripcion is null then
    new.descripcion := coalesce(v_c.instrucciones->>'es', v_c.instrucciones->>'en');
  end if;
  return new;
end;
$$;

-- ── 4. RPCs: leer cada campo del suyo (sin heurístico de like '%.gif') ─────

-- 4a. Rutina libre
create or replace function public._rutina_libre_detalle(p_rutina_libre_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select rl.* from public.rutina_libre rl where rl.id = p_rutina_libre_id
  )
  select case when not exists (select 1 from r) then null else
    jsonb_build_object(
      'rutina_id', (select id from r),
      'nombre', (select nombre from r),
      'objetivo', (select objetivo from r),
      'notas', (select notas from r),
      'equipo', (select equipo from r),
      'dias', coalesce((
        select jsonb_agg(dia order by dia->>'dia_semana')
        from (
          select jsonb_build_object(
            'id', d.id,
            'dia_semana', d.dia_semana,
            'foco', d.foco,
            'ejercicios', coalesce((
              select jsonb_agg(ej order by (ej->>'orden')::int)
              from (
                select jsonb_build_object(
                  'id', re.id,
                  'nombre', re.nombre,
                  'series', re.series,
                  'reps', re.reps,
                  'descanso', re.descanso,
                  'carga', re.carga,
                  'orden', re.orden,
                  'notas', re.notas,
                  -- Cada uno de su columna: sin adivinar por la extensión.
                  'video_url', c.video_url,
                  'gif_url', c.gif_url,
                  'foto_url', c.foto_url,
                  'descripcion', coalesce(c.instrucciones->>'es', c.instrucciones->>'en'),
                  'catalogo_id', c.id,
                  'target', c.target,
                  'body_part', c.body_part,
                  'grupo_muscular', c.grupo_muscular,
                  'secondary', c.secondary,
                  'equipment', c.equipment
                ) as ej
                from public.rutina_libre_ejercicio re
                left join public.ejercicio_catalogo c on c.id = re.catalogo_id
                where re.rutina_libre_dia_id = d.id
              ) x
            ), '[]'::jsonb)
          ) as dia
          from public.rutina_libre_dia d where d.rutina_libre_id = (select id from r)
        ) y
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public._rutina_libre_detalle(uuid) from public;
grant execute on function public._rutina_libre_detalle(uuid) to authenticated, service_role;

-- 4b. Detalle de rutina prediseñada
create or replace function public.detalle_rutina_predisenada(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with p as (select * from public.rutina_predisenada where id = p_id and activa)
  select case when not exists (select 1 from p) then null else
    jsonb_build_object(
      'rutina_id', (select id from p), 'nombre', (select nombre from p),
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
                  'video_url', c.video_url,
                  'gif_url', c.gif_url,
                  'foto_url', c.foto_url,
                  'descripcion', coalesce(c.instrucciones->>'es', c.instrucciones->>'en'),
                  'catalogo_id', c.id, 'target', c.target, 'body_part', c.body_part,
                  'grupo_muscular', c.grupo_muscular, 'secondary', c.secondary, 'equipment', c.equipment,
                  'alternativas', coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'catalogo_id', ac.id, 'nombre', coalesce(ac.nombre_es, ac.nombre),
                      'target', ac.target, 'equipment', ac.equipment,
                      'gif_url', ac.gif_url,
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

-- 4c. Buscador del catálogo: exponer también el video
create or replace function public.buscar_ejercicios_catalogo(
  p_texto text default null, p_body_part text default null,
  p_equipment text default null, p_target text default null,
  p_offset int default 0, p_limit int default 30)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id,
    'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular,
    'target', target, 'equipment', equipment,
    'gif_url', gif_url, 'video_url', video_url, 'foto_url', foto_url)
  from public.ejercicio_catalogo
  where activo
    and (p_texto is null or (coalesce(nombre_es,'') || ' ' || nombre) ilike '%'||p_texto||'%')
    and (p_body_part is null or body_part = p_body_part)
    and (p_equipment is null or equipment = p_equipment)
    and (p_target is null or target = p_target)
  order by coalesce(nombre_es, nombre)
  offset greatest(p_offset,0) limit least(coalesce(p_limit,30), 60);
$$;
revoke all on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int) from public;
grant execute on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int) to authenticated, service_role;

-- 4d. Detalle de un ejercicio del catálogo
create or replace function public.ejercicio_catalogo_detalle(p_id uuid, p_idioma text default 'es')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id, 'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular, 'target', target,
    'secondary', secondary, 'equipment', equipment,
    'gif_url', gif_url, 'video_url', video_url, 'foto_url', foto_url,
    'attribution', attribution,
    'instruccion', coalesce(instrucciones->>p_idioma, instrucciones->>'es', instrucciones->>'en'),
    'pasos', coalesce(pasos->p_idioma, pasos->'es', pasos->'en', '[]'::jsonb))
  from public.ejercicio_catalogo where id = p_id and activo;
$$;
revoke all on function public.ejercicio_catalogo_detalle(uuid,text) from public;
grant execute on function public.ejercicio_catalogo_detalle(uuid,text) to authenticated, service_role;
