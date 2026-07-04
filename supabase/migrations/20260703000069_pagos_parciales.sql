-- ============================================================================
-- 69 · Pagos parciales de membresía (idea de cliente real)
-- El anual de S/700 se paga "S/400 ahora, el resto después". Se registra
-- el monto inicial al inscribir, la membresía guarda cuánto lleva pagado,
-- y los abonos siguientes entran con abonar_membresia (cada abono es un
-- ingreso normal en caja, así Finanzas cuadra sola).
--   total del trato = precio_pagado + matricula_pagada (ya existían)
--   monto_pagado    = lo realmente cobrado hasta hoy (nuevo)
-- ============================================================================

alter table public.membresia add column if not exists monto_pagado numeric(12,2);

-- Las membresías existentes estaban pagadas completas
update public.membresia
   set monto_pagado = coalesce(precio_pagado, 0) + coalesce(matricula_pagada, 0)
 where monto_pagado is null;

alter table public.membresia alter column monto_pagado set default 0;

-- ── Abono a una membresía con saldo ─────────────────────────────────────────
create or replace function public.abonar_membresia(
  p_membresia_id uuid,
  p_monto numeric,
  p_metodo_pago text default 'efectivo'
)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_m public.membresia;
  v_total numeric(12,2);
  v_saldo numeric(12,2);
  v_socio text;
begin
  select * into v_m from public.membresia where id = p_membresia_id;
  if v_m.id is null then raise exception 'Membresía no encontrada o sin acceso'; end if;

  v_total := coalesce(v_m.precio_pagado, 0) + coalesce(v_m.matricula_pagada, 0);
  v_saldo := v_total - coalesce(v_m.monto_pagado, 0);

  if p_monto is null or p_monto <= 0 then raise exception 'Ingresa un monto válido'; end if;
  if v_saldo <= 0 then raise exception 'Esta membresía no tiene saldo pendiente'; end if;
  if p_monto > v_saldo then
    raise exception 'El abono (S/ %) supera el saldo pendiente (S/ %)', p_monto, v_saldo;
  end if;

  update public.membresia
     set monto_pagado = coalesce(monto_pagado, 0) + p_monto
   where id = p_membresia_id;

  select nombre into v_socio from public.socio where id = v_m.socio_id;

  insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
  values (v_m.empresa_id, v_m.sede_id, 'ingreso', 'membresia',
          'Abono membresía · ' || coalesce(v_socio, 'socio') ||
            ' (' || trim(to_char(p_monto, 'FM999990.00')) || ' de ' || trim(to_char(v_total, 'FM999990.00')) ||
            case when v_saldo - p_monto > 0 then ' · queda ' || trim(to_char(v_saldo - p_monto, 'FM999990.00')) else ' · CANCELADO ✓' end || ')',
          p_monto, coalesce(p_metodo_pago, 'efectivo'), 'membresia', p_membresia_id, auth.uid());

  return jsonb_build_object('pagado', coalesce(v_m.monto_pagado, 0) + p_monto, 'total', v_total, 'saldo', v_saldo - p_monto);
end;
$$;

grant execute on function public.abonar_membresia(uuid, numeric, text) to authenticated;
