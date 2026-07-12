-- Fase 2 de promos en renovación: RENOVACIÓN GRUPAL EN UN CLIC + canjes.
--
-- Al cobrar la renovación de un titular con beneficio grupal vigente (2×1 /
-- grupal "de por vida" o "por meses"), el MISMO cobro renueva también a sus
-- compañeros de grupo con monto 0 — recepción ya no lo hace a mano. Además,
-- toda renovación donde intervino una promo (la de origen o una alternativa
-- elegida en el POS) SUMA UN CANJE a la campaña, que antes solo contaba
-- inscripciones.
--
-- Seguridad: el servidor NO confía en la lista de compañeros del cliente —
-- recalcula promo_beneficio_renovacion y solo renueva gratis a quienes ese
-- motor confirma como grupo vigente.

create or replace function public.cobrar_renovacion_grupo_pos(
  p_membresia_id uuid,
  p_metodo_pago text default 'efectivo',
  p_monto numeric default null,
  p_con_beneficio boolean default false,   -- la promo de ORIGEN sigue vigente y se aplicó
  p_renovar_grupo boolean default true,    -- renovar también a los compañeros (monto 0)
  p_promocion_alt uuid default null,       -- promo ALTERNATIVA aplicada (sin beneficio de origen)
  p_cliente_tipo_doc text default '0',
  p_cliente_num_doc text default null,
  p_cliente_nombre text default 'CLIENTE VARIOS',
  p_cliente_email text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_m public.membresia;
  v_res jsonb;
  v_benef jsonb;
  v_g jsonb;
  v_renovados jsonb := '[]'::jsonb;
  v_canje uuid := null;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  select * into v_m from public.membresia where id = p_membresia_id and deleted_at is null;
  if v_m.id is null or v_m.empresa_id <> v_empresa then
    raise exception 'Membresía no encontrada o sin acceso';
  end if;

  -- 1) Validar el beneficio ANTES de cobrar: la renovación pone fecha_fin
  -- futura y un titular ya cortado pasaría el chequeo de continuidad.
  if p_con_beneficio then
    v_benef := public.promo_beneficio_renovacion(p_membresia_id);
  end if;

  -- 2) Cobro del titular (mismo camino de siempre: caja + boleta electrónica)
  v_res := public.cobrar_membresia_pos(p_membresia_id, p_metodo_pago, p_monto,
             p_cliente_tipo_doc, p_cliente_num_doc, p_cliente_nombre, p_cliente_email);

  -- 3) Beneficio de origen validado: renovar al grupo con 0
  if p_con_beneficio then
    if coalesce((v_benef->>'aplica')::boolean, false) then
      v_canje := v_m.promocion_id;
      if p_renovar_grupo and (v_benef->>'tipo') in ('2x1', 'grupal') then
        for v_g in select * from jsonb_array_elements(coalesce(v_benef->'grupo', '[]'::jsonb)) loop
          -- renovación sin cobro: extiende su periodo, sin movimiento de caja
          perform public.renew_membership((v_g->>'membresia_id')::uuid, p_metodo_pago, 0, 0);
          v_renovados := v_renovados || jsonb_build_object(
            'socio_id', v_g->>'socio_id', 'nombre', v_g->>'nombre');
        end loop;
      end if;
    end if;
  -- 4) Promo alternativa (el beneficio de origen no corría): solo cuenta el canje
  elsif p_promocion_alt is not null then
    if exists (select 1 from public.promocion pr
                where pr.id = p_promocion_alt and pr.empresa_id = v_empresa
                  and pr.estado = 'activa' and pr.deleted_at is null) then
      v_canje := p_promocion_alt;
    end if;
  end if;

  if v_canje is not null then
    update public.promocion set canjes = coalesce(canjes, 0) + 1 where id = v_canje;
  end if;

  return v_res || jsonb_build_object(
    'grupo_renovado', v_renovados,
    'canje_promocion', v_canje is not null
  );
end $$;

revoke all on function public.cobrar_renovacion_grupo_pos(uuid, text, numeric, boolean, boolean, uuid, text, text, text, text) from public;
grant execute on function public.cobrar_renovacion_grupo_pos(uuid, text, numeric, boolean, boolean, uuid, text, text, text, text) to authenticated;
