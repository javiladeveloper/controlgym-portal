-- Finny no debe anunciar una promoción cuyo efecto no está en precio_final.
--
-- El checkout real (inscribir_socio / agregar_membresia_socio) aplica cada
-- tipo de promoción a una cosa distinta:
--   - descuento_pct     -> baja el precio (%)
--   - descuento_monto   -> baja el precio (monto fijo)     [faltaba aquí]
--   - precio_especial   -> fija el precio
--   - semana_gratis     -> NO toca el precio, extiende la vigencia (+7 días)
--   - 2x1               -> NO toca el precio de lista, libera la matrícula
--                           y solo el invitado paga 0 (esto no es un plan)
--   - grupal            -> NO toca el precio de lista, reparte cuántos del
--                           grupo pagan (tampoco es un solo plan)
--
-- finny_preparar_cobro solo cotiza UN plan con UN precio_final: no puede
-- representar el ahorro real de 2x1/grupal (depende de cuántos entren) ni
-- el de semana_gratis (es tiempo, no plata). Antes, esos tres tipos caían
-- en el "else" silencioso: el precio quedaba igual al de lista pero
-- promo_nombre salía poblado, como si el descuento sí se hubiera aplicado.
-- El bot terminaba prometiendo un precio que el checkout no iba a cobrar.
--
-- Regla nueva: promo_nombre solo se informa cuando el tipo de promoción
-- efectivamente cambia precio_final en esta cotización. Para los demás
-- tipos, se informa aparte que existe una promo pero que su beneficio no es
-- un descuento de precio (para que Finny no invente una cifra).
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
  v_promo_sin_efecto_precio text;
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
      if v_promo.tipo = 'descuento_pct' and v_promo.valor is not null then
        v_precio := round(v_plan.precio * (1 - v_promo.valor / 100.0), 2);
        v_promo_nombre := v_promo.nombre;
      elsif v_promo.tipo = 'descuento_monto' and v_promo.valor is not null then
        v_precio := greatest(0, v_plan.precio - v_promo.valor);
        v_promo_nombre := v_promo.nombre;
      elsif v_promo.tipo = 'precio_especial' and v_promo.valor is not null then
        v_precio := v_promo.valor;
        v_promo_nombre := v_promo.nombre;
      else
        -- semana_gratis (da días, no descuento), 2x1 y grupal (benefician
        -- según cuántos entren, no cambian el precio de este plan) u otros
        -- tipos sin efecto de precio: no se informa promo_nombre para no
        -- prometer una cifra que el checkout no va a cobrar.
        v_promo_sin_efecto_precio := v_promo.nombre;
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
    'promo_nombre', v_promo_nombre,
    'promo_sin_descuento_en_precio', v_promo_sin_efecto_precio
  );
end $$;

-- Solo el backend la llama (con el secreto). Nadie con sesión de navegador
-- debe poder preguntar esto.
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from public;
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from anon;
revoke all on function public.finny_preparar_cobro(text, uuid, uuid, uuid) from authenticated;
