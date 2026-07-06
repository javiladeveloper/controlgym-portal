-- ============================================================================
-- 90 (20260705000003) · Precio acordado al inscribir (pana / ex-socio / trato)
--
-- Pedido del cliente: a veces se acuerda un monto distinto al del plan (precio
-- de amigo, ex-socio que retoma, acuerdo puntual). Se agrega el parámetro
-- opcional p_precio_acordado a inscribir_socio: si viene, PISA el precio de la
-- mensualidad (respetando matrícula y método de pago). Aplica SOLO a esta
-- inscripción — al renovar vuelve al precio del plan (decisión del cliente).
--
-- Reglas:
--   · Solo aplica sin promoción de grupo (2x1/grupal usan precio por persona).
--   · Se registra la nota "precio acordado" para que quede claro en Finanzas.
--   · Sigue funcionando el pago en partes (p_monto_inicial).
--
-- Se recompila inscribir_socio inyectando el nuevo parámetro y el override,
-- preservando el resto del cuerpo (grande). NO se cambia ninguna otra lógica.
-- ============================================================================

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef(
    'public.inscribir_socio(uuid,text,text,text,text,date,text,uuid,uuid,uuid,text,jsonb,numeric)'::regprocedure);

  -- ya migrada?
  if position('p_precio_acordado' in v_def) > 0 then
    raise notice 'inscribir_socio ya tiene p_precio_acordado';
    return;
  end if;

  -- 1) Agregar el parámetro nuevo al final de la firma (default null)
  v_def := replace(
    v_def,
    'p_monto_inicial numeric DEFAULT NULL::numeric)',
    'p_monto_inicial numeric DEFAULT NULL::numeric, p_precio_acordado numeric DEFAULT NULL::numeric)');

  -- 2) Inyectar el override JUSTO antes de calcular v_total. Si viene un precio
  --    acordado y NO hay promo de grupo (v_pagan = 1), pisa v_precio.
  v_def := replace(
    v_def,
    E'    v_total := v_precio * v_pagan + v_matricula;',
    E'    -- Precio acordado (pana / ex-socio / trato puntual): pisa la\n'
    || E'    -- mensualidad, salvo en promos de grupo (precio por persona).\n'
    || E'    if p_precio_acordado is not null and v_pagan = 1 then\n'
    || E'      v_precio := greatest(0, p_precio_acordado);\n'
    || E'      v_desc := coalesce(nullif(v_desc, ''''), ''Precio acordado'');\n'
    || E'    end if;\n\n'
    || E'    v_total := v_precio * v_pagan + v_matricula;');

  execute v_def;
end $$;

-- Al recompilar con firma nueva (14 params) queda la versión vieja de 13
-- params → ambigüedad al llamar. Se elimina la vieja (la nueva la cubre, el
-- param nuevo tiene default null).
drop function if exists public.inscribir_socio(uuid,text,text,text,text,date,text,uuid,uuid,uuid,text,jsonb,numeric);
