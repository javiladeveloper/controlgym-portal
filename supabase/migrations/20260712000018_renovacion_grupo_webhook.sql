-- Renovación grupal vía QR MercadoPago: cerrar el hueco de que el webhook solo
-- renovaba al titular (no conocía al grupo). Ahora, tras cobrar la renovación
-- de un socio con beneficio grupal vigente (2×1/grupal "de por vida" o "por
-- meses"), el mismo pago renueva también a sus compañeros con monto 0.
--
-- El webhook corre SIN sesión (auth.uid() null), así que no puede usar
-- promo_beneficio_renovacion (valida auth_empresa_id). Esta RPC replica la
-- decisión del beneficio pero recibe la membresía del pago ya verificada por
-- el webhook (el pago_app enlaza socio_id/ref_id). security definer, sin auth.

create or replace function public.renovar_membresia_grupo_webhook(
  p_membresia_id uuid, p_metodo_pago text default 'mercadopago'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m public.membresia;
  v_promo public.promocion;
  v_origen date;
  v_hoy date;
  v_gracia constant int := 7;
  v_roto boolean := false;
  v_renovados jsonb := '[]'::jsonb;
  r record;
begin
  select * into v_m from public.membresia where id = p_membresia_id and deleted_at is null;
  if v_m.id is null then return jsonb_build_object('ok', false, 'motivo', 'membresia_inexistente'); end if;

  -- 1) Renovar SIEMPRE al titular (el pago ya se aprobó).
  perform public.renew_membership(p_membresia_id, p_metodo_pago, null, null);

  -- 2) ¿Su promo de origen da beneficio GRUPAL vigente al renovar?
  if v_m.promocion_id is null then
    return jsonb_build_object('ok', true, 'grupo_renovado', v_renovados);
  end if;
  select * into v_promo from public.promocion where id = v_m.promocion_id;
  if coalesce(v_promo.vigencia_beneficio, 'primera') = 'primera'
     or v_promo.tipo not in ('2x1', 'grupal') then
    return jsonb_build_object('ok', true, 'grupo_renovado', v_renovados);
  end if;

  v_hoy := (now() at time zone coalesce((select zona_horaria from public.empresa where id = v_m.empresa_id), 'America/Lima'))::date;
  select min(fecha_inicio) into v_origen from public.membresia
   where socio_id = v_m.socio_id and promocion_id = v_promo.id and deleted_at is null;

  -- ventana por meses vencida → sin beneficio
  if v_promo.vigencia_beneficio = 'meses'
     and v_origen + make_interval(months => coalesce(v_promo.vigencia_meses, 0)) <= v_hoy then
    return jsonb_build_object('ok', true, 'grupo_renovado', v_renovados);
  end if;

  -- 3) Renovar a los compañeros vivos del grupo (misma promo, mismo origen).
  for r in
    with companeros as (
      select distinct m2.socio_id from public.membresia m2
      where m2.promocion_id = v_promo.id and m2.empresa_id = v_m.empresa_id
        and m2.deleted_at is null and m2.fecha_inicio = v_origen and m2.socio_id <> v_m.socio_id
    )
    select ult.id as membresia_id, s.nombre, (ult.fecha_fin >= v_hoy - v_gracia) as vivo
    from companeros c
    join public.socio s on s.id = c.socio_id
    cross join lateral (
      select m3.id, m3.fecha_fin from public.membresia m3
      where m3.socio_id = c.socio_id and m3.deleted_at is null
      order by m3.fecha_fin desc limit 1
    ) ult
  loop
    if not r.vivo then
      -- si algún compañero se cortó, el beneficio grupal se rompió: no renovar a nadie más
      return jsonb_build_object('ok', true, 'grupo_renovado', '[]'::jsonb, 'beneficio_roto', true);
    end if;
    perform public.renew_membership(r.membresia_id, p_metodo_pago, 0, 0); -- sin cobro
    v_renovados := v_renovados || jsonb_build_object('nombre', r.nombre);
  end loop;

  return jsonb_build_object('ok', true, 'grupo_renovado', v_renovados);
end $$;

revoke all on function public.renovar_membresia_grupo_webhook(uuid, text) from public, anon, authenticated;
grant execute on function public.renovar_membresia_grupo_webhook(uuid, text) to service_role;
