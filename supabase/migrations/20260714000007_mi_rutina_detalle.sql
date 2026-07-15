-- Rutina del socio para la APP, con la media (GIF/foto/video) ya resuelta por
-- ejercicio. La app hace UNA llamada y muestra la rutina completa con su guía
-- animada, sin tener que conocer el catálogo ni hacer joins.
--
-- Resolución de media por ejercicio (en orden de prioridad):
--   1. video propio del gym (rutina_ejercicio → ejercicio.video_url), si es un
--      video real de TikTok/YouTube (no el .gif heredado).
--   2. GIF del catálogo global, casando por nombre (es o en).
--   3. foto (del gym o del catálogo) como respaldo.
--
-- Seguridad: SECURITY DEFINER; valida que la rutina pertenezca al socio del JWT
-- (auth.uid) y esté enviada. Sin eso, no devuelve nada.
create or replace function public.mi_rutina_detalle(p_rutina_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select rt.* from public.rutina rt
    join public.socio s on s.id = rt.socio_id
    where rt.id = p_rutina_id and rt.enviado_at is not null and s.usuario_id = auth.uid()
  )
  select case when not exists (select 1 from r) then null else
    jsonb_build_object(
      'rutina_id', (select id from r),
      'nombre', (select nombre from r),
      'objetivo', (select objetivo from r),
      'notas', (select notas from r),
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
                  -- Media resuelta y SEPARADA por tipo:
                  --  video_url = video real (TikTok/YouTube/Vimeo) del gym o del
                  --    catálogo migrado — NUNCA un .gif.
                  --  gif_url   = solo un GIF real (.gif de Storage) — nunca un video.
                  'video_url', coalesce(
                    case when e.video_url is not null and e.video_url not like '%.gif' then e.video_url end,
                    case when c.gif_url is not null and c.gif_url not like '%.gif' then c.gif_url end),
                  'gif_url', coalesce(
                    case when e.video_url like '%.gif' then e.video_url end,
                    case when c.gif_url like '%.gif' then c.gif_url end),
                  'foto_url', coalesce(e.foto_url, c.foto_url),
                  'descripcion', coalesce(nullif(e.descripcion,''), c.instrucciones->>'es', c.instrucciones->>'en')
                ) as ej
                from public.rutina_ejercicio re
                left join public.ejercicio e on e.id = re.ejercicio_id
                left join public.ejercicio_catalogo c
                  on lower(coalesce(c.nombre_es, c.nombre)) = lower(re.nombre)
                where re.rutina_dia_id = d.id
              ) x
            ), '[]'::jsonb)
          ) as dia
          from public.rutina_dia d where d.rutina_id = (select id from r)
        ) y
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public.mi_rutina_detalle(uuid) from public;
grant execute on function public.mi_rutina_detalle(uuid) to authenticated, service_role;
