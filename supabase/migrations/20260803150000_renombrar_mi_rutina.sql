-- Poner nombre a una rutina propia.
--
-- REPORTADO por el owner al probar: "cada rutina que yo cree o se me cree, yo
-- puedo colocarle un nombre general a esa rutina".
--
-- Hoy el nombre lo pone el sistema ("Rutina Ganar Masa (5 días)") y no hay forma
-- de cambiarlo: existe `renombrar_dia_libre` para los DÍAS, pero nada para la
-- rutina entera. Con varias rutinas guardadas (Parte A) el nombre pasa a ser lo
-- único que las distingue en la lista, así que sin esto son indistinguibles:
-- "Rutina Ganar Masa (5 días)" tres veces.
--
-- El nombre viaja además a la comunidad: `publicar_mi_rutina` lo copia como
-- título de la rutina publicada.
create or replace function public.renombrar_mi_rutina(p_rutina uuid, p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_limpio text;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  v_limpio := nullif(trim(p_nombre), '');
  if v_limpio is null then
    raise exception 'Ponle un nombre a tu rutina';
  end if;
  -- Tope generoso pero real: el nombre se pinta en tarjetas y en la ficha
  -- pública, y uno de 300 caracteres rompe cualquier diseño.
  if length(v_limpio) > 60 then
    raise exception 'El nombre no puede pasar de 60 caracteres';
  end if;

  update public.rutina_libre
     set nombre = v_limpio
   where id = p_rutina and usuario_id = v_uid;
  if not found then raise exception 'Esa rutina no es tuya'; end if;

  return jsonb_build_object('ok', true, 'nombre', v_limpio);
end;
$function$;

revoke all on function public.renombrar_mi_rutina(uuid, text) from public;
grant execute on function public.renombrar_mi_rutina(uuid, text) to authenticated;
