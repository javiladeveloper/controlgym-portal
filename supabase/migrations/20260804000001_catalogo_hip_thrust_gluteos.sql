-- Asegura un "Hip thrust" básico para GLÚTEOS en el catálogo global de ejercicios
-- (public.ejercicio_catalogo), bien categorizado y activo, para que aparezca en el
-- banco de ejercicios de todos los gyms (RPC banco_ejercicios_gym).
--
-- Contexto: el dataset importado (1369 con GIF) NO incluye ningún "hip thrust";
-- solo existía como entrada "maestro" curada, que quedó con body_part='other' y
-- sin nombre_es, por lo que al filtrar por glúteos podía no aparecer.
--
-- Idempotente: si ya hay una fila "Hip thrust", solo corrige su categorización;
-- si no existe, la inserta. Se puede correr varias veces sin duplicar.
do $$
declare v_id uuid;
begin
  select id into v_id
    from public.ejercicio_catalogo
   where lower(coalesce(nombre_es, nombre)) = 'hip thrust'
      or lower(nombre) like 'hip thrust%'
      or lower(coalesce(nombre_es, '')) like 'hip thrust%'
   order by (ext_id like 'maestro-%') desc, created_at
   limit 1;

  if v_id is null then
    insert into public.ejercicio_catalogo
      (ext_id, nombre, nombre_es, body_part, grupo_muscular, target, equipment, activo)
    values
      ('curado-hip-thrust', 'Barbell Hip Thrust', 'Hip thrust', 'upper legs', 'Glúteo', 'glutes', 'barbell', true);
  else
    update public.ejercicio_catalogo
       set nombre_es      = coalesce(nombre_es, 'Hip thrust'),
           grupo_muscular = coalesce(nullif(grupo_muscular, ''), 'Glúteo'),
           target         = 'glutes',
           body_part      = case when body_part is null or body_part in ('', 'other') then 'upper legs' else body_part end,
           activo         = true,
           updated_at     = now()
     where id = v_id;
  end if;
end $$;
