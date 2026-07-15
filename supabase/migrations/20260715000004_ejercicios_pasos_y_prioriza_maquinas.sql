-- Mejoras de ejercicios en la app (PEDIDO 39). Ya aplicadas en Supabase.
--  1) buscar_ejercicios_catalogo: prioriza MÁQUINA/peso libre sobre peso corporal
--     (uno va al gym a usar máquinas) y devuelve instruccion + pasos.
--  2) mi_rutina_detalle: agrega `pasos` por ejercicio (guía paso a paso del
--     catálogo, español o inglés) — data que ya teníamos y no se mostraba.

create or replace function public.buscar_ejercicios_catalogo(
  p_texto text,
  p_body_part text,
  p_equipment text,
  p_target text,
  p_offset integer,
  p_limit integer,
  p_sede_id uuid
) returns setof jsonb
 language sql stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id, 'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular, 'target', target,
    'equipment', equipment, 'gif_url', gif_url, 'foto_url', foto_url,
    'instruccion', coalesce(instrucciones->>'es', instrucciones->>'en'),
    'pasos', coalesce(pasos->'es', pasos->'en'))
  from public.ejercicio_catalogo c
  where activo
    and (p_texto is null or (coalesce(nombre_es,'') || ' ' || nombre) ilike '%'||p_texto||'%')
    and (p_body_part is null or body_part = p_body_part)
    and (p_equipment is null or equipment = p_equipment)
    and (p_target is null or target = p_target)
    and (p_sede_id is null or equipment = 'body weight'
         or equipment in (select equipment from public.sede_equipo where sede_id = p_sede_id and disponible))
  order by
    case
      when equipment in ('body weight', 'assisted') then 2
      when equipment in ('band', 'resistance band', 'stability ball', 'bosu ball',
                         'medicine ball', 'roller', 'wheel roller', 'rope') then 1
      else 0  -- máquinas, mancuernas, barras, poleas, kettlebell…
    end,
    coalesce(nombre_es, nombre)
  offset greatest(p_offset,0) limit least(coalesce(p_limit,30), 60);
$function$;

create or replace function public.mi_rutina_detalle(p_rutina_id uuid)
 returns jsonb
 language sql stable security definer
 set search_path to 'public'
as $function$
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
                  'video_url', coalesce(
                    case when e.video_url is not null and e.video_url not like '%.gif' then e.video_url end,
                    case when c.gif_url is not null and c.gif_url not like '%.gif' then c.gif_url end),
                  'gif_url', coalesce(
                    case when e.video_url like '%.gif' then e.video_url end,
                    case when c.gif_url like '%.gif' then c.gif_url end),
                  'foto_url', coalesce(e.foto_url, c.foto_url),
                  'descripcion', coalesce(nullif(e.descripcion,''), c.instrucciones->>'es', c.instrucciones->>'en'),
                  'pasos', coalesce(c.pasos->'es', c.pasos->'en'),
                  'catalogo_id', c.id,
                  'target', c.target,
                  'body_part', c.body_part,
                  'grupo_muscular', coalesce(e.grupo_muscular, c.grupo_muscular),
                  'secondary', c.secondary,
                  'equipment', c.equipment
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
$function$;
