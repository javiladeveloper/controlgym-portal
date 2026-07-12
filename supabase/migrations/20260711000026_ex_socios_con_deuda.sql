-- Reactivacion (ex-socios): mostrar si se fueron DEBIENDO algo (pedido del
-- owner: "aca tmb debe figurar si se fueron con alguna deuda"). El RPC ahora
-- devuelve 'deuda' = saldo pendiente acumulado de las membresias del socio.

CREATE OR REPLACE FUNCTION public.ex_socios(p_meses integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_tz text;
  v_hoy date;
  v_result jsonb;
begin
  if v_empresa is null then
    raise exception 'Sin empresa activa';
  end if;

  select zona_horaria into v_tz from public.empresa where id = v_empresa;
  v_tz := coalesce(v_tz, 'America/Lima');
  v_hoy := (now() at time zone v_tz)::date;

  with ultima as (
    select distinct on (m.socio_id)
      m.socio_id, m.fecha_fin, p.nombre as plan
    from public.membresia m
    join public.plan p on p.id = m.plan_id
    where m.empresa_id = v_empresa and m.deleted_at is null
    order by m.socio_id, m.fecha_fin desc
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'socio_id', s.id, 'nombre', s.nombre, 'telefono', s.telefono,
      'ultimo_plan', u.plan, 'vencio_hace_dias', v_hoy - u.fecha_fin,
      -- Deuda con la que se fue: saldo pendiente acumulado de sus membresias
      -- (precio acordado + matricula - lo realmente pagado), misma formula
      -- que "saldoDe" en el panel de Membresias.
      'deuda', (
        select coalesce(sum(greatest(0,
          coalesce(m3.precio_pagado, 0) + coalesce(m3.matricula_pagada, 0) - coalesce(m3.monto_pagado, 0)
        )), 0)
        from public.membresia m3
        where m3.socio_id = s.id and m3.empresa_id = v_empresa and m3.deleted_at is null
      )
    ) order by u.fecha_fin desc
  ), '[]'::jsonb)
  into v_result
  from ultima u
  join public.socio s on s.id = u.socio_id and s.empresa_id = v_empresa and s.deleted_at is null
  where u.fecha_fin < v_hoy
    and u.fecha_fin >= v_hoy - (p_meses || ' months')::interval
    and not exists (
      select 1 from public.membresia m2
      where m2.socio_id = u.socio_id and m2.empresa_id = v_empresa
        and m2.deleted_at is null and m2.estado = 'activa'
    );

  return v_result;
end;
$function$;