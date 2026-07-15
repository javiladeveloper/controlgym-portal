-- Reemplazo de la fuente de herencia: ahora los ejercicios de los gyms heredan
-- media/datos de ejercicio_catalogo (no del viejo ejercicio_maestro, deprecado).

-- 1) Traer del maestro viejo lo que NO esté ya en el catálogo (por nombre),
--    para no perder contenido curado. ext_id 'maestro-<uuid>' los distingue.
insert into public.ejercicio_catalogo (ext_id, nombre, body_part, grupo_muscular, foto_url, gif_url, instrucciones)
select 'maestro-' || m.id, m.nombre, 'other', m.grupo_muscular, m.foto_url, m.video_url,
       jsonb_build_object('es', coalesce(m.descripcion,''))
from public.ejercicio_maestro m
where not exists (
  select 1 from public.ejercicio_catalogo c
  where lower(c.nombre) = lower(m.nombre) or lower(coalesce(c.nombre_es,'')) = lower(m.nombre))
on conflict (ext_id) do nothing;

-- 2) Reescribir el trigger para leer del catálogo (casando por nombre EN o ES).
create or replace function public.trg_ejercicio_hereda_maestro()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_c public.ejercicio_catalogo;
begin
  if new.descripcion is null and new.video_url is null and new.foto_url is null then
    select * into v_c from public.ejercicio_catalogo
      where lower(nombre) = lower(new.nombre) or lower(coalesce(nombre_es,'')) = lower(new.nombre)
      order by (lower(nombre) = lower(new.nombre)) desc, id
      limit 1;
    if v_c.id is not null then
      new.descripcion    := coalesce(v_c.instrucciones->>'es', v_c.instrucciones->>'en');
      new.video_url      := v_c.gif_url;
      new.foto_url       := v_c.foto_url;
      new.grupo_muscular := coalesce(new.grupo_muscular, v_c.grupo_muscular);
    end if;
  end if;
  return new;
end;
$function$;
-- (El trigger ya está enganchado a public.ejercicio; solo cambia el cuerpo.)
