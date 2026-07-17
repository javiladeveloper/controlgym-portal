-- Consolida vincular_socio: gate de app por sede (P31/PEDIDO 43) + propagación
-- del objetivo del catálogo.
--
-- Por qué: dos trabajos en paralelo tocaron esta función. `20260717000004`
-- (gate_app_por_plan) le añadió `sede_con_app`; `20260717100002` (rename
-- objetivo→objetivo_nota) se basó en una copia SIN el gate y tiene timestamp
-- MAYOR. En la BD viva quedó bien (el gate se aplicó después), pero al recrear
-- desde cero el 100002 ganaría y BORRARÍA el gate: los socios de sedes sin el
-- add-on de app volverían a vincularse. Esta migración fija la versión correcta
-- —con gate Y con objetivo— como la última palabra. (Detectado en el review
-- final; copiada de la definición viva verificada en producción.)
create or replace function public.vincular_socio()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_email text; v_tel text; v_n int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select regexp_replace(coalesce(telefono, ''), '\D', '', 'g') into v_tel
  from public.usuario where id = v_uid;

  update public.socio s set usuario_id = v_uid
   where s.usuario_id is null and s.deleted_at is null
     and ((s.email is not null and lower(s.email) = v_email)
       or (coalesce(v_tel,'') <> '' and length(v_tel) >= 9
           and regexp_replace(coalesce(s.telefono,''), '\D', '', 'g') = v_tel))
     and public.sede_con_app(s.sede_id);
  get diagnostics v_n = row_count;

  update public.socio s
     set nombre = coalesce(u.nombre, s.nombre), telefono = u.telefono,
         documento = coalesce(u.documento, s.documento), fecha_nacimiento = u.fecha_nacimiento,
         objetivo_nota = u.objetivo_nota, objetivo_id = u.objetivo_id, peso_kg = u.peso_kg, talla_m = u.talla_m,
         foto_url = u.foto_url, foto_estado = u.foto_estado, foto_actualizada_at = u.foto_actualizada_at
    from public.usuario u
   where s.usuario_id = v_uid and u.id = v_uid and s.deleted_at is null;

  return jsonb_build_object('vinculados_ahora', v_n,
    'total', (select count(*) from public.socio s
              where s.usuario_id = v_uid and s.deleted_at is null
                and public.sede_con_app(s.sede_id)));
end $function$;
