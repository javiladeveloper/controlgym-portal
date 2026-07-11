-- Cobro por pasarela desde el POS (mostrador): mismo pipeline que la app,
-- pero el canal distingue que NO hay recojo (el cliente ya tiene el producto).
alter table public.pago_app
  add column if not exists canal text not null default 'app';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pago_app_canal_check') then
    alter table public.pago_app add constraint pago_app_canal_check
      check (canal in ('app','mostrador'));
  end if;
end $$;

-- Poll del POS: estado del pago SIN exponer tokens ni datos de otros gyms.
create or replace function public.estado_pago_pos(p_pago_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_pago public.pago_app; v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  select * into v_pago from public.pago_app
    where id = p_pago_id and empresa_id = v_empresa;
  if v_pago.id is null then return jsonb_build_object('encontrado', false); end if;
  return jsonb_build_object(
    'encontrado', true,
    'estado_pago', v_pago.estado_pago,
    'estado_activacion', v_pago.estado_activacion,
    'monto', v_pago.monto,
    'comprobante_estado', v_pago.comprobante_estado);
end;
$function$;
grant execute on function public.estado_pago_pos(uuid) to authenticated;
