-- FIX CRÍTICO (auditoría pre-demo): anular_membresia con devolución
-- reembolsaba el TOTAL DEL TRATO (precio_pagado + matricula_pagada) en vez de
-- lo que el socio REALMENTE pagó (monto_pagado). Con pagos en partes, el gym
-- devolvía dinero que nunca recibió (ej. pagó S/40 de S/90 → le "devolvían"
-- S/90, S/50 de pérdida real en caja).
--
-- Fix: la devolución es exactamente monto_pagado (lo efectivamente cobrado).
-- Si no pagó nada, no hay movimiento de devolución.
create or replace function public.anular_membresia(p_membresia_id uuid, p_devolver boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m public.membresia;
  v_socio text;
  v_devuelto numeric(12,2);
begin
  select * into v_m from public.membresia where id = p_membresia_id; -- RLS aplica
  if v_m.id is null then raise exception 'Membresía no encontrada o sin acceso'; end if;
  if v_m.estado = 'cancelada' then raise exception 'La membresía ya está anulada'; end if;

  select nombre into v_socio from public.socio where id = v_m.socio_id;

  update public.membresia set estado = 'cancelada' where id = p_membresia_id;
  update public.congelamiento set estado = 'finalizado', fecha_fin = current_date
   where membresia_id = p_membresia_id and estado = 'aprobado';

  -- Devolver SOLO lo realmente pagado (monto_pagado), no el total del trato.
  v_devuelto := coalesce(v_m.monto_pagado, 0);
  if p_devolver and v_devuelto > 0 then
    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
    values (v_m.empresa_id, v_m.sede_id, 'gasto', 'membresia',
            'Devolución por anulación de membresía · ' || coalesce(v_socio, ''),
            v_devuelto, 'efectivo', 'membresia', p_membresia_id, auth.uid());
  end if;

  return jsonb_build_object('estado', 'cancelada', 'devolucion', p_devolver, 'monto_devuelto', case when p_devolver then v_devuelto else 0 end);
end;
$function$;
