-- Peso/talla también son datos del usuario (fuente de verdad). Al registrar una
-- medida personal, además de guardar el histórico en medida_personal, se
-- actualiza usuario.peso_kg/talla_m — así el trigger trg_usuario_propaga los
-- hereda a todas las fichas de socio (el plan automático por IMC del gym usa
-- socio.peso_kg/talla_m). Sin esto, "Mi cuerpo" guardaba la medida pero no
-- llegaba al socio.
create or replace function public.registrar_mi_medida(p_peso_kg numeric, p_talla_m numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;

  insert into public.medida_personal (usuario_id, fecha, peso_kg, talla_m)
  values (v_uid, current_date, p_peso_kg, p_talla_m);

  -- Actualiza la fuente de verdad; el trigger propaga a los socios del usuario.
  update public.usuario
     set peso_kg = coalesce(p_peso_kg, peso_kg),
         talla_m = coalesce(p_talla_m, talla_m),
         updated_at = now()
   where id = v_uid;
end;
$function$;
