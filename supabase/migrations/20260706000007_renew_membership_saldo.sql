-- FIX CRÍTICO (auditoría pre-demo): renew_membership dejaba "saldo fantasma".
--
-- Problemas de la versión anterior:
--   1. Pisaba precio_pagado con el precio del plan pero NO reiniciaba
--      monto_pagado → el socio aparecía debiendo (o con crédito) del ciclo
--      anterior. El saldo del front (precio_pagado+matricula - monto_pagado)
--      quedaba descuadrado.
--   2. Arrastraba matricula_pagada de la inscripción, inflando el "total" de
--      cada renovación (la matrícula es un cobro de ÚNICA vez al inscribir).
--   3. Registraba en caja el precio del plan completo aunque se cobrara otra
--      cosa, e ignoraba el precio acordado del socio.
--
-- Nueva versión: una renovación abre un ciclo nuevo con su propio cobro.
--   · p_precio_acordado: si viene, es el precio de ESTA renovación (respeta el
--     trato pana/ex-socio); si no, usa el precio de lista del plan.
--   · p_monto_inicial: cuánto se paga AHORA. NULL o >= precio ⇒ pago completo
--     (monto_pagado = precio, saldo 0). Un monto menor ⇒ pago en partes
--     (queda saldo). Nunca deja monto_pagado > precio.
--   · matricula_pagada se pone en 0 (no se recobra al renovar).
--   · En caja entra SOLO lo que realmente se paga ahora.
create or replace function public.renew_membership(
  p_membresia_id   uuid,
  p_metodo_pago    text default 'efectivo',
  p_precio_acordado numeric default null,
  p_monto_inicial  numeric default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m public.membresia;
  v_precio numeric(12,2);
  v_unidad text;
  v_nombre_plan text;
  v_nueva_fin date;
  v_cobra_ahora numeric(12,2);
  v_socio text;
begin
  select * into v_m from public.membresia where id = p_membresia_id;
  if v_m.id is null then raise exception 'Membresía no encontrada o sin acceso'; end if;

  select precio, unidad, nombre into v_precio, v_unidad, v_nombre_plan
  from public.plan where id = v_m.plan_id;

  -- Precio de esta renovación: el acordado si viene, si no el de lista.
  if p_precio_acordado is not null and p_precio_acordado >= 0 then
    v_precio := round(p_precio_acordado, 2);
  end if;

  -- Cuánto entra ahora: por defecto el precio completo; si mandan un inicial,
  -- se acota a [0, precio] (pago en partes).
  v_cobra_ahora := coalesce(p_monto_inicial, v_precio);
  if v_cobra_ahora < 0 then v_cobra_ahora := 0; end if;
  if v_cobra_ahora > v_precio then v_cobra_ahora := v_precio; end if;

  v_nueva_fin := greatest(v_m.fecha_fin, current_date) +
    case v_unidad
      when 'dia' then interval '1 day'
      when 'mes' then interval '1 month'
      when 'trimestre' then interval '3 months'
      when 'anual' then interval '1 year'
      else interval '1 month'
    end;

  update public.membresia
     set fecha_fin       = v_nueva_fin,
         estado          = 'activa',
         precio_pagado   = v_precio,
         matricula_pagada = 0,          -- la matrícula no se recobra al renovar
         monto_pagado    = v_cobra_ahora  -- reinicia el ciclo de pago
   where id = p_membresia_id;

  -- Si estaba de baja, vuelve a ser socio activo
  update public.socio set estado = 'activo'
   where id = v_m.socio_id and estado <> 'activo' and deleted_at is null;

  select nombre into v_socio from public.socio where id = v_m.socio_id;

  -- En caja entra SOLO lo cobrado ahora (0 si renovó sin pagar todavía).
  if v_cobra_ahora > 0 then
    insert into public.movimiento_financiero
      (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
    values (v_m.empresa_id, v_m.sede_id, 'ingreso', 'membresia',
            'Renovación ' || coalesce(v_nombre_plan, 'membresía')
              || case when v_cobra_ahora < v_precio
                      then ' · abono ' || trim(to_char(v_cobra_ahora,'FM999990.00')) || ' de ' || trim(to_char(v_precio,'FM999990.00'))
                      else '' end,
            v_cobra_ahora, coalesce(p_metodo_pago, 'efectivo'),
            'membresia', p_membresia_id, auth.uid());
  end if;

  return jsonb_build_object(
    'estado', 'activa',
    'fecha_fin', v_nueva_fin,
    'precio', v_precio,
    'pagado', v_cobra_ahora,
    'saldo', v_precio - v_cobra_ahora
  );
end;
$function$;

grant execute on function public.renew_membership(uuid, text, numeric, numeric) to authenticated;

-- Elimina la versión anterior de 2 parámetros (uuid, text) para evitar
-- ambigüedad: con la nueva firma de 4 args (2 opcionales) la llamada del
-- frontend {p_membresia_id, p_metodo_pago} resuelve a la nueva.
drop function if exists public.renew_membership(uuid, text);
