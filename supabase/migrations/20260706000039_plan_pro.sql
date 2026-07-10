-- Renombre comercial: el plan tope 'cadena' pasa a llamarse 'pro' (no ata el
-- plan a ser una cadena/franquicia: cualquier gym equipado con torniquetes,
-- huella o cámaras lo quiere, sea 1 sede o varias). Mismo precio (179 / 229).
-- Mantenemos 'cadena' como alias por compatibilidad (ninguna empresa lo usa hoy,
-- pero por si algún registro o enlace viejo lo referencia).
create or replace function public.precio_plan(p_plan text, p_con_app boolean)
returns numeric
language sql
immutable
as $function$
  select case p_plan
    when 'trainer' then case when p_con_app then 49 else 29 end
    when 'academia' then case when p_con_app then 69 else 49 end
    when 'ninos' then case when p_con_app then 109 else 69 end
    when 'estudio' then case when p_con_app then 79 else 49 end
    when 'crecimiento' then case when p_con_app then 139 else 99 end
    when 'pro' then case when p_con_app then 229 else 179 end
    when 'cadena' then case when p_con_app then 229 else 179 end  -- alias legado
  end::numeric
$function$;
