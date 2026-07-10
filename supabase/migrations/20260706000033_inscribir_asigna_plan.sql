-- Task 5: inscribir_socio asigna plan automatico (rutina+dieta) segun objetivo_id
-- + backfill de objetivo_id en socios existentes a partir del texto libre `objetivo`.
--
-- Cambios en inscribir_socio (mismo cuerpo que la version anterior, solo se agrega):
--   a. nuevo parametro p_objetivo_id uuid default null (al final, no rompe llamadas existentes)
--   b. columna objetivo_id en el insert de public.socio
--   c. variable v_plan jsonb en el bloque declare + llamada a asignar_plan_automatico(v_socio)
--      antes del return, solo si p_objetivo_id no es null
--   d. campo 'plan' en el jsonb de retorno
--
-- NOTA: inscribir_socio no recibe peso_kg/talla_m como parametros, por lo que el socio
-- recien inscrito no tiene esos datos. asignar_plan_automatico devolvera
-- {asignado:false, motivo:'sin_peso_talla'} en ese caso -- comportamiento esperado.
-- El plan se generara mas adelante cuando se registre el peso/talla del socio.

-- Postgres trata un nuevo parametro (aunque tenga default) como un cambio de identidad
-- de la funcion: CREATE OR REPLACE no pisa la version anterior de 14 parametros, crea
-- un overload nuevo. Eliminamos explicitamente la firma vieja para quedar con una sola.
drop function if exists public.inscribir_socio(uuid, text, text, text, text, date, text, uuid, uuid, uuid, text, jsonb, numeric, numeric);

create or replace function public.inscribir_socio(p_sede_id uuid, p_nombre text, p_telefono text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_documento text DEFAULT NULL::text, p_fecha_nacimiento date DEFAULT NULL::date, p_objetivo text DEFAULT NULL::text, p_plan_id uuid DEFAULT NULL::uuid, p_lead_id uuid DEFAULT NULL::uuid, p_promocion_id uuid DEFAULT NULL::uuid, p_metodo_pago text DEFAULT 'efectivo'::text, p_invitados jsonb DEFAULT NULL::jsonb, p_monto_inicial numeric DEFAULT NULL::numeric, p_precio_acordado numeric DEFAULT NULL::numeric, p_objetivo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_empresa uuid;
  v_codigo text;
  v_socio uuid;
  v_plan public.plan;
  v_promo public.promocion;
  v_fin date;
  v_precio numeric(12,2) := 0;
  v_matricula numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_cobrado numeric(12,2) := 0;
  v_desc text := '';
  v_pagan int := 1;
  v_n_inv int := 0;
  v_inv jsonb;
  v_i int := 0;
  v_codigo_inv text;
  v_socio_inv uuid;
  v_codigos_inv text[] := '{}';
  v_nombres text;
  v_plan_auto jsonb := null;
begin
  select empresa_id into v_empresa from public.sede where id = p_sede_id;
  if v_empresa is null then raise exception 'Sede no encontrada'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  select lpad((coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
    into v_codigo
  from public.socio where empresa_id = v_empresa;

  insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, email, documento, fecha_nacimiento, objetivo, objetivo_id, estado, created_by)
  values (v_empresa, p_sede_id, v_codigo, trim(p_nombre), nullif(trim(p_telefono),''), nullif(trim(p_email),''),
          nullif(trim(p_documento),''), p_fecha_nacimiento, nullif(trim(p_objetivo),''), p_objetivo_id, 'activo', auth.uid())
  returning id into v_socio;

  if p_plan_id is not null then
    select * into v_plan from public.plan where id = p_plan_id and empresa_id = v_empresa;
    if v_plan.id is null then raise exception 'Plan no válido'; end if;

    v_fin := current_date + case v_plan.unidad
      when 'dia' then interval '1 day' when 'mes' then interval '1 month'
      when 'trimestre' then interval '3 months' when 'anual' then interval '1 year'
      else interval '1 month' end;

    v_precio := v_plan.precio;
    v_matricula := case when v_plan.cobra_matricula then coalesce(v_plan.precio_matricula,0) else 0 end;

    v_n_inv := coalesce(jsonb_array_length(p_invitados), 0);

    if p_promocion_id is not null then
      select * into v_promo from public.promocion
       where id = p_promocion_id and empresa_id = v_empresa and estado = 'activa' and deleted_at is null;
      if v_promo.id is not null then
        if v_promo.tipo = 'descuento_pct' then
          v_precio := round(v_precio * (1 - coalesce(v_promo.valor,0) / 100), 2);
          v_desc := v_promo.nombre || ' (−' || coalesce(v_promo.valor,0) || '%)';
        elsif v_promo.tipo = 'descuento_monto' then
          v_precio := greatest(0, v_precio - coalesce(v_promo.valor,0));
          v_desc := v_promo.nombre;
        elsif v_promo.tipo = 'semana_gratis' then
          v_fin := v_fin + 7;
          v_desc := v_promo.nombre || ' (+7 días)';
        elsif v_promo.tipo in ('2x1', 'grupal') then
          if v_n_inv > 0 then
            v_pagan := case when v_promo.tipo = '2x1' then 1 else coalesce(v_promo.grupo_pagan, 1) end;
            v_pagan := least(v_pagan, 1 + v_n_inv);
            v_desc := v_promo.nombre || ' (' || (1 + v_n_inv) || ' personas, pagan ' || v_pagan || ')';
          elsif v_promo.tipo = '2x1' then
            v_matricula := 0;
            v_desc := v_promo.nombre || ' (matrícula gratis)';
          else
            v_desc := v_promo.nombre;
          end if;
        elsif v_promo.tipo = 'precio_especial' then
          v_precio := coalesce(v_promo.valor, v_precio);
          if v_promo.duracion_meses is not null then
            v_fin := current_date + (v_promo.duracion_meses || ' months')::interval;
          end if;
          v_desc := v_promo.nombre ||
            case when v_promo.duracion_meses is not null
              then ' (' || v_promo.duracion_meses || ' meses por ' || coalesce(v_promo.valor, 0) || ')'
              else '' end;
        else
          v_desc := v_promo.nombre;
        end if;
        update public.promocion set canjes = canjes + 1 where id = v_promo.id;
      end if;
    end if;

    -- Precio acordado (pana / ex-socio / trato puntual): pisa la
    -- mensualidad, salvo en promos de grupo (precio por persona).
    if p_precio_acordado is not null and v_pagan = 1 then
      v_precio := greatest(0, p_precio_acordado);
      v_desc := coalesce(nullif(v_desc, ''), 'Precio acordado');
    end if;

    v_total := v_precio * v_pagan + v_matricula;

    -- Pago inicial: solo sin grupo; se recorta al total y nunca es negativo
    if p_monto_inicial is not null and v_n_inv = 0 then
      v_cobrado := greatest(0, least(p_monto_inicial, v_total));
    else
      v_cobrado := v_total;
    end if;

    insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, matricula_pagada, promocion_id, monto_pagado)
    values (v_empresa, p_sede_id, v_socio, p_plan_id, current_date, v_fin, 'activa', v_precio, v_matricula,
            case when v_promo.id is not null then v_promo.id else null end,
            case when v_n_inv = 0 then v_cobrado else v_precio + v_matricula end);

    if v_promo.id is not null and v_promo.tipo in ('2x1','grupal') and v_n_inv > 0 then
      for v_inv in select * from jsonb_array_elements(p_invitados)
      loop
        v_i := v_i + 1;
        if coalesce(trim(v_inv->>'nombre'),'') = '' then continue; end if;

        select lpad((coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
          into v_codigo_inv
        from public.socio where empresa_id = v_empresa;

        insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, documento, estado, created_by)
        values (v_empresa, p_sede_id, v_codigo_inv, trim(v_inv->>'nombre'),
                nullif(trim(v_inv->>'telefono'),''), nullif(trim(v_inv->>'documento'),''), 'activo', auth.uid())
        returning id into v_socio_inv;

        insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, matricula_pagada, promocion_id, monto_pagado)
        values (v_empresa, p_sede_id, v_socio_inv, p_plan_id, current_date, v_fin, 'activa',
                case when v_i < v_pagan then v_precio else 0 end, 0, v_promo.id,
                case when v_i < v_pagan then v_precio else 0 end);

        v_codigos_inv := v_codigos_inv || v_codigo_inv;
      end loop;
    end if;

    select string_agg(x->>'nombre', ' + ') into v_nombres from jsonb_array_elements(coalesce(p_invitados, '[]'::jsonb)) x
     where coalesce(trim(x->>'nombre'),'') <> '';

    if v_cobrado > 0 then
      insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
      values (v_empresa, p_sede_id, 'ingreso', 'membresia',
              'Inscripción ' || v_plan.nombre || ' · ' || trim(p_nombre) ||
                case when v_nombres is not null then ' + ' || v_nombres else '' end ||
                case when v_matricula > 0 then ' (incluye matrícula)' else '' end ||
                case when v_desc <> '' then ' · Promo: ' || v_desc else '' end ||
                case when v_cobrado < v_total
                  then ' · PAGO PARCIAL ' || trim(to_char(v_cobrado, 'FM999990.00')) || ' de ' || trim(to_char(v_total, 'FM999990.00'))
                  else '' end,
              v_cobrado, coalesce(p_metodo_pago, 'efectivo'), 'socio', v_socio, auth.uid());
    end if;
  end if;

  if p_lead_id is not null then
    update public.lead set etapa = 'inscrito', socio_id = v_socio where id = p_lead_id;
  end if;

  if p_objetivo_id is not null then
    v_plan_auto := public.asignar_plan_automatico(v_socio);
  end if;

  return jsonb_build_object(
    'socio_id', v_socio, 'codigo', v_codigo, 'total_cobrado', v_cobrado,
    'precio', v_precio, 'matricula', v_matricula, 'saldo', v_total - v_cobrado,
    'promo_aplicada', nullif(v_desc, ''), 'vence', v_fin,
    'codigos_invitados', to_jsonb(v_codigos_inv),
    'plan', v_plan_auto
  );
end;
$function$;

-- Backfill: mapea el texto libre `socio.objetivo` a `objetivo_id` para socios existentes
-- que aun no tienen objetivo_id. NO asigna plan retroactivamente (eso queda para cuando
-- el socio registre peso/talla y se dispare la asignacion, o para un proceso aparte).
update public.socio s set objetivo_id = o.id
from public.objetivo_entrenamiento o
where s.objetivo_id is null and o.codigo = case
  when s.objetivo ilike '%baj%peso%' or s.objetivo ilike '%grasa%' or s.objetivo ilike '%perd%' then 'bajar_peso'
  when s.objetivo ilike '%masa%' or s.objetivo ilike '%muscul%' or s.objetivo ilike '%ganar%' then 'ganar_masa'
  when s.objetivo ilike '%tonific%' then 'tonificar'
  when s.objetivo ilike '%fuerza%' then 'fuerza'
  when s.objetivo ilike '%resist%' or s.objetivo ilike '%cardio%' then 'resistencia'
  when s.objetivo ilike '%rehab%' or s.objetivo ilike '%postura%' then 'rehabilitacion'
  when s.objetivo ilike '%deport%' or s.objetivo ilike '%prepar%' then 'prep_deportiva'
  when s.objetivo ilike '%salud%' or s.objetivo ilike '%general%' then 'salud_general'
  else null end;
