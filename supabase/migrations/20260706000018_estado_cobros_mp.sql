-- PEDIDO 15 Fase 1.d — El panel necesita saber si el gym ya conectó sus cobros
-- de MercadoPago, PERO empresa_mp tiene RLS con cero policies (el access_token
-- solo lo lee el backend). Exponemos SOLO el estado (conectado sí/no + fecha +
-- mp_user_id), nunca los tokens, vía una RPC SECURITY DEFINER acotada al admin
-- de la empresa activa.

create or replace function public.estado_cobros_mp()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_fila    public.empresa_mp;
begin
  if v_empresa is null then
    return jsonb_build_object('conectado', false);
  end if;
  -- Solo el admin ve/gestiona los cobros del gym.
  if not public.auth_is_admin() then
    return jsonb_build_object('conectado', false, 'motivo', 'solo_admin');
  end if;

  select * into v_fila from public.empresa_mp where empresa_id = v_empresa;
  if v_fila.empresa_id is null then
    return jsonb_build_object('conectado', false);
  end if;

  -- NUNCA devolvemos access_token/refresh_token. Solo el estado.
  return jsonb_build_object(
    'conectado',    true,
    'mp_user_id',   v_fila.mp_user_id,
    'conectado_at', v_fila.conectado_at
  );
end;
$function$;

grant execute on function public.estado_cobros_mp() to authenticated;

-- Desconectar cobros: el admin borra la conexión (el gym deja de cobrar por app).
create or replace function public.desconectar_cobros_mp()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador puede desconectar los cobros';
  end if;
  delete from public.empresa_mp where empresa_id = v_empresa;
end;
$function$;

grant execute on function public.desconectar_cobros_mp() to authenticated;

comment on function public.estado_cobros_mp is
  'Estado de conexión de cobros MercadoPago del gym activo (conectado, mp_user_id, fecha). NUNCA expone los tokens (empresa_mp tiene RLS cerrado). Solo admin. PEDIDO 15.';
