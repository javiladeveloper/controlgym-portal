-- El socio cambia su propia sede desde la app móvil (cambio de sede = gratis).
-- Valida server-side que la sede pertenezca a un gym donde el usuario ES socio, y
-- mueve SU ficha de ese gym a esa sede. Multi-gym seguro: solo toca la ficha del
-- socio cuyo gym coincide con la empresa de la sede destino. Ya aplicada en Supabase.
create or replace function public.cambiar_mi_sede(p_sede_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid;
  v_socio_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autenticado');
  end if;

  -- La empresa de la sede destino (sede válida y no borrada).
  select s.empresa_id into v_empresa
  from public.sede s
  where s.id = p_sede_id and s.deleted_at is null;

  if v_empresa is null then
    return jsonb_build_object('ok', false, 'motivo', 'sede_inexistente');
  end if;

  -- La ficha del socio (de ESTE usuario) en el gym de esa sede.
  select so.id into v_socio_id
  from public.socio so
  where so.usuario_id = v_uid
    and so.empresa_id = v_empresa
    and so.deleted_at is null;

  if v_socio_id is null then
    -- El usuario no es socio del gym al que pertenece esa sede.
    return jsonb_build_object('ok', false, 'motivo', 'no_es_tu_gym');
  end if;

  update public.socio set sede_id = p_sede_id where id = v_socio_id;

  return jsonb_build_object('ok', true, 'sede_id', p_sede_id);
end;
$function$;

grant execute on function public.cambiar_mi_sede(uuid) to authenticated;
