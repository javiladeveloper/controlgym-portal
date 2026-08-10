-- Finny (el bot) pregunta si PUEDE cobrar antes de prometer nada.
--
-- Un bot que ofrece un link de pago y luego no puede generarlo es peor que uno
-- que no lo intenta: el interesado se queda esperando. Esta función responde
-- tres cosas de una: si el gimnasio tiene cobros conectados, si el plan existe
-- y está activo, y cuánto sale con la promoción aplicada.
--
-- Se autentica con el mismo secreto compartido que leadia_ingresar_lead: la
-- llama el motor del bot, no un usuario con sesión.

create or replace function public.finny_preparar_cobro(
  p_secret       text,
  p_empresa_id   uuid,
  p_plan_id      uuid,
  p_promocion_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan        record;
  v_promo       record;
  v_promo_nombre text;
  v_conectado   boolean;
  v_precio      numeric;
begin
  if p_secret is distinct from (select valor from privado.secreto where clave = 'leadia_ingest_key') then
    return jsonb_build_object('ok', false, 'error', 'secreto invalido');
  end if;

  -- ¿El gimnasio tiene MercadoPago conectado? Sin esto no hay cobro posible.
  select exists (
    select 1 from public.empresa_mp where empresa_id = p_empresa_id
  ) into v_conectado;

  if not v_conectado then
    return jsonb_build_object('ok', true, 'puede_cobrar', false,
                              'error', 'el gimnasio no tiene cobros conectados');
  end if;

  select p.id, p.nombre, p.precio into v_plan
  from public.plan p
  where p.id = p_plan_id and p.empresa_id = p_empresa_id
    and p.activo and p.deleted_at is null;

  if not found then
    return jsonb_build_object('ok', true, 'puede_cobrar', false,
                              'error', 'plan no encontrado o inactivo');
  end if;

  v_precio := v_plan.precio;

  -- Promoción: solo se aplica si está vigente y es de esta empresa. Si no lo
  -- está, se cobra el precio de lista en vez de fallar — el interesado igual
  -- quiere pagar.
  if p_promocion_id is not null then
    select pr.id, pr.nombre, pr.tipo, pr.valor into v_promo
    from public.promocion pr
    where pr.id = p_promocion_id and pr.empresa_id = p_empresa_id
      and pr.estado = 'activa' and pr.deleted_at is null;

    if found then
      v_promo_nombre := v_promo.nombre;
      if v_promo.tipo = 'descuento_pct' and v_promo.valor is not null then
        v_precio := round(v_plan.precio * (1 - v_promo.valor / 100.0), 2);
      elsif v_promo.tipo = 'precio_especial' and v_promo.valor is not null then
        v_precio := v_promo.valor;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'puede_cobrar', true,
    'plan_id', v_plan.id,
    'plan_nombre', v_plan.nombre,
    'precio_lista', v_plan.precio,
    'precio_final', v_precio,
    'promo_nombre', v_promo_nombre
  );
end $$;

-- Solo el backend la llama (con el secreto). Nadie con sesión de navegador
-- debe poder preguntar esto.
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from public;
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from anon;
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from authenticated;
