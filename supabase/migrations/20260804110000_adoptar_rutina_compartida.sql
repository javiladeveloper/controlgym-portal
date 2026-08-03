-- Cierra la otra mitad de "compartir por enlace/QR": hasta ahora
-- `ver_rutina_compartida` dejaba VER la rutina de otro, pero no había forma
-- de quedarse con ella. Esta RPC copia el `contenido` congelado de
-- `rutina_compartida` a una `rutina_libre` nueva y activa de quien la recibe.
--
-- Sigue el mismo patrón que `adoptar_rutina_predisenada` (fix_revision_final_
-- comunidad.sql): ARCHIVA la rutina en curso (nunca la borra — regla del
-- proyecto) y crea la nueva. El unique index parcial
-- `rutina_libre_usuario_activa_uq (usuario_id) where activa` exige que el
-- archivado quede confirmado ANTES del insert, por eso van en ese orden
-- dentro de la misma transacción de la función.
create or replace function public.adoptar_rutina_compartida(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_usuario uuid := auth.uid();
  v_rc record;
  v_nueva uuid;
  v_dia_nuevo uuid;
  v_dia jsonb;
  v_ej jsonb;
  v_orden int;
begin
  if v_usuario is null then raise exception 'Sesión inválida'; end if;

  -- Mismo mensaje y misma condición (activo) que `ver_rutina_compartida`: si
  -- el enlace se revocó o el token no existe, se corta aquí con un mensaje
  -- claro en vez de una excepción críptica de "not found".
  select * into v_rc from public.rutina_compartida
   where token = p_token and activo;
  if not found then
    raise exception 'Este enlace ya no está disponible';
  end if;

  -- ARCHIVA la rutina en curso, NUNCA se borra (regla del proyecto: el
  -- historial/avance de una rutina archivada debe poder consultarse después).
  update public.rutina_libre set activa = false
   where usuario_id = v_usuario and activa;

  insert into public.rutina_libre (usuario_id, nombre, activa)
  values (v_usuario, coalesce(nullif(trim(v_rc.nombre), ''), 'Rutina compartida'), true)
  returning id into v_nueva;

  -- El contenido está congelado en jsonb (mismo shape que arma
  -- `compartir_mi_rutina`): un array de días, cada uno con su foco y su
  -- array de ejercicios. Se recorre con jsonb_array_elements en vez de un
  -- insert...select porque el origen no es una tabla, es jsonb.
  for v_dia in select * from jsonb_array_elements(v_rc.contenido)
  loop
    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
    values (
      v_nueva,
      coalesce((v_dia->>'dia_semana')::int, 1),
      v_dia->>'foco'
    )
    returning id into v_dia_nuevo;

    v_orden := 0;
    for v_ej in select * from jsonb_array_elements(coalesce(v_dia->'ejercicios', '[]'::jsonb))
    loop
      v_orden := v_orden + 1;
      -- catalogo_id queda NULL a propósito: el contenido compartido solo
      -- trae el nombre en texto (congelado), no el id del catálogo — y
      -- rutina_libre_ejercicio.catalogo_id sí admite null (ver
      -- publicar_mi_rutina, mismo caso ya documentado ahí).
      insert into public.rutina_libre_ejercicio
        (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
      values (
        v_dia_nuevo, null,
        coalesce(v_ej->>'nombre', 'Ejercicio'),
        (v_ej->>'series')::int,
        v_ej->>'reps',
        v_ej->>'descanso',
        v_orden
      );
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'rutina_id', v_nueva);
end;
$function$;

revoke all on function public.adoptar_rutina_compartida(text) from public;
grant execute on function public.adoptar_rutina_compartida(text) to authenticated;
