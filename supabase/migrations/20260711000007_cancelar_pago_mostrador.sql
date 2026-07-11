-- Cancelar un cobro de mostrador pendiente (el cajero cierra el modal QR).
-- Si el cliente paga el link DESPUES de cancelado, el webhook NO registra la
-- venta: deja notificacion al admin (reembolsar o registrar manual).

-- 'cancelado' no estaba permitido en pago_app_estado_pago_check: lo agregamos.
alter table public.pago_app drop constraint pago_app_estado_pago_check;
alter table public.pago_app add constraint pago_app_estado_pago_check
  check (estado_pago in ('pendiente','aprobado','rechazado','reembolsado','cancelado'));

create or replace function public.cancelar_pago_mostrador(p_pago_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_empresa uuid := public.auth_empresa_id(); v_ok int;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  update public.pago_app set estado_pago = 'cancelado'
   where id = p_pago_id and empresa_id = v_empresa
     and canal = 'mostrador' and estado_pago = 'pendiente';
  get diagnostics v_ok = row_count;
  return v_ok > 0;
end;
$function$;
grant execute on function public.cancelar_pago_mostrador(uuid) to authenticated;
