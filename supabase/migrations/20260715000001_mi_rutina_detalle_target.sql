-- PEDIDO 37 (app): mi_rutina_detalle devuelve, por ejercicio, el músculo objetivo
-- (target), la zona (body_part) y el id del catálogo — para que la app sugiera
-- "más ejercicios que trabajan lo mismo" (buscar_ejercicios_catalogo por target).
-- Vienen del mismo join al catálogo que ya se usa para la media; null si no matchea.
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
                  'descripcion', coalesce(nullif(e.descripcion,''), c.instrucciones->>'es', c.instrucciones->>'en'),
                  -- PEDIDO 37: datos del catálogo para sugerir ejercicios similares
                  'catalogo_id', c.id,          -- id en ejercicio_catalogo (null si no matchea)
                  'target', c.target,           -- músculo objetivo (biceps, abs…)
                  'body_part', c.body_part,     -- zona (upper arms, chest…)
                  'grupo_muscular', coalesce(e.grupo_muscular, c.grupo_muscular),
                  'secondary', c.secondary,     -- músculos secundarios
                  'equipment', c.equipment      -- equipo del ejercicio
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
