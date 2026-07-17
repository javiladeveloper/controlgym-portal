-- inscribir_socio quedó ROTA por el rename objetivo → objetivo_nota: su insert
-- principal seguía nombrando la columna vieja, así que TODA inscripción de socio
-- desde el panel fallaba con "column objetivo of relation socio does not exist"
-- (Postgres no revalida el cuerpo de una plpgsql al renombrar la columna: el
-- rename pasa en silencio y revienta en la primera inscripción).
-- Único cambio respecto a la versión vigente (20260715000010_invitados_objetivo):
-- `objetivo` → `objetivo_nota` en el insert principal. El parámetro p_objetivo
-- mantiene su nombre (compatibilidad con el panel) y ahora escribe la NOTA.
create or replace function public.inscribir_socio(
  p_sede_id uuid, p_nombre text, p_telefono text default null, p_email text default null,
  p_documento text default null, p_fecha_nacimiento date default null, p_objetivo text default null,
  p_plan_id uuid default null, p_lead_id uuid default null, p_promocion_id uuid default null,
  p_metodo_pago text default 'efectivo', p_invitados jsonb default null,
  p_monto_inicial numeric default null, p_precio_acordado numeric default null,
  p_objetivo_id uuid default null, p_peso_kg numeric default null, p_talla_m numeric default null)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
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
  v_talla numeric := case when p_talla_m > 3 then round(p_talla_m / 100, 2) else p_talla_m end;
begin
  select empresa_id into v_empresa from public.sede where id = p_sede_id;
  if v_empresa is null then raise exception 'Sede no encontrada'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  select lpad((coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
    into v_codigo
  from public.socio where empresa_id = v_empresa;

  insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, email, documento, fecha_nacimiento, objetivo_nota, objetivo_id, peso_kg, talla_m, estado, created_by)
  values (v_empresa, p_sede_id, v_codigo, trim(p_nombre), nullif(trim(p_telefono),''), nullif(trim(p_email),''),
          nullif(trim(p_documento),''), p_fecha_nacimiento, nullif(trim(p_objetivo),''), p_objetivo_id, p_peso_kg, v_talla, 'activo', auth.uid())
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

        insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, email, documento, objetivo_id, estado, created_by)
        values (v_empresa, p_sede_id, v_codigo_inv, trim(v_inv->>'nombre'),
                nullif(trim(v_inv->>'telefono'),''), nullif(trim(v_inv->>'email'),''), nullif(trim(v_inv->>'documento'),''),
                nullif(v_inv->>'objetivo_id','')::uuid, 'activo', auth.uid())
        returning id into v_socio_inv;

        insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, matricula_pagada, promocion_id, monto_pagado)
        values (v_empresa, p_sede_id, v_socio_inv, p_plan_id, current_date, v_fin, 'activa',
                case when v_i < v_pagan then v_precio else 0 end, 0, v_promo.id,
                case when v_i < v_pagan then v_precio else 0 end);

        if nullif(v_inv->>'objetivo_id','') is not null then
          perform public.asignar_plan_automatico(v_socio_inv);
        end if;

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
    -- Sus tareas de seguimiento pendientes ya no tienen sentido: el lead
    -- convirtio. Sin esto quedaban "vencidas" para siempre en la agenda.
    update public.lead_tarea set completada = true where lead_id = p_lead_id and not completada;
  elsif nullif(trim(p_documento), '') is not null then
    -- Inscripcion DIRECTA (sin venir del CRM) cuyo documento coincide con un
    -- lead abierto del gym: es la misma persona -> el lead pasa a 'inscrito'
    -- solo, con sus tareas cerradas ("dice que es socio pero sigue en clase
    -- de prueba" - inconsistencia reportada por el owner).
    update public.lead set etapa = 'inscrito', socio_id = v_socio
      where empresa_id = v_empresa and socio_id is null and deleted_at is null
        and etapa <> 'inscrito' and documento = trim(p_documento);
    update public.lead_tarea t set completada = true
      from public.lead l
      where l.id = t.lead_id and l.socio_id = v_socio and not t.completada;
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
