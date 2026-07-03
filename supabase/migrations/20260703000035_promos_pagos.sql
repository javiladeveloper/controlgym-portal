-- ============================================================================
-- 35 · Promociones aplicadas al cobro + método de pago
--   · movimiento_financiero.metodo_pago: efectivo / yape / plin / tarjeta / transferencia
--   · inscribir_socio: acepta promoción (aplica descuento según su tipo) y método
--   · renew_membership: acepta método de pago
-- ============================================================================

alter table public.movimiento_financiero
  add column if not exists metodo_pago text
  check (metodo_pago in ('efectivo','yape','plin','tarjeta','transferencia','otro'));

-- ── inscribir_socio v2: con promoción y método de pago ──────────────────────
drop function if exists public.inscribir_socio(uuid,text,text,text,text,date,text,uuid,uuid);

create or replace function public.inscribir_socio(
  p_sede_id uuid,
  p_nombre text,
  p_telefono text default null,
  p_email text default null,
  p_documento text default null,
  p_fecha_nacimiento date default null,
  p_objetivo text default null,
  p_plan_id uuid default null,
  p_lead_id uuid default null,
  p_promocion_id uuid default null,
  p_metodo_pago text default 'efectivo'
)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
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
  v_desc text := '';
begin
  select empresa_id into v_empresa from public.sede where id = p_sede_id;
  if v_empresa is null then raise exception 'Sede no encontrada'; end if;
  if coalesce(trim(p_nombre),'') = '' then raise exception 'El nombre es obligatorio'; end if;

  select lpad((coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1)::text, 4, '0')
    into v_codigo
  from public.socio where empresa_id = v_empresa;

  insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, email, documento, fecha_nacimiento, objetivo, estado, created_by)
  values (v_empresa, p_sede_id, v_codigo, trim(p_nombre), nullif(trim(p_telefono),''), nullif(trim(p_email),''),
          nullif(trim(p_documento),''), p_fecha_nacimiento, nullif(trim(p_objetivo),''), 'activo', auth.uid())
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

    -- Aplicar promoción activa (descuenta según su tipo)
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
        elsif v_promo.tipo = '2x1' then
          v_matricula := 0; -- matrícula de cortesía
          v_desc := v_promo.nombre || ' (matrícula gratis)';
        else
          v_desc := v_promo.nombre;
        end if;
        update public.promocion set canjes = canjes + 1 where id = v_promo.id;
      end if;
    end if;

    v_total := v_precio + v_matricula;

    insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, matricula_pagada, promocion_id)
    values (v_empresa, p_sede_id, v_socio, p_plan_id, current_date, v_fin, 'activa', v_precio, v_matricula,
            case when v_promo.id is not null then v_promo.id else null end);

    insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
    values (v_empresa, p_sede_id, 'ingreso', 'membresia',
            'Inscripción ' || v_plan.nombre || ' · ' || trim(p_nombre) ||
              case when v_matricula > 0 then ' (incluye matrícula)' else '' end ||
              case when v_desc <> '' then ' · Promo: ' || v_desc else '' end,
            v_total, coalesce(p_metodo_pago, 'efectivo'), 'socio', v_socio, auth.uid());
  end if;

  if p_lead_id is not null then
    update public.lead set etapa = 'inscrito', socio_id = v_socio where id = p_lead_id;
  end if;

  return jsonb_build_object(
    'socio_id', v_socio, 'codigo', v_codigo, 'total_cobrado', v_total,
    'precio', v_precio, 'matricula', v_matricula,
    'promo_aplicada', nullif(v_desc, ''), 'vence', v_fin
  );
end;
$$;

grant execute on function public.inscribir_socio(uuid,text,text,text,text,date,text,uuid,uuid,uuid,text) to authenticated;

-- ── renew_membership v2: con método de pago ─────────────────────────────────
drop function if exists public.renew_membership(uuid);

create or replace function public.renew_membership(p_membresia_id uuid, p_metodo_pago text default 'efectivo')
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_m public.membresia;
  v_precio numeric(12,2);
  v_unidad text;
  v_nombre_plan text;
  v_nueva_fin date;
begin
  select * into v_m from public.membresia where id = p_membresia_id;
  if v_m.id is null then raise exception 'Membresía no encontrada o sin acceso'; end if;

  select precio, unidad, nombre into v_precio, v_unidad, v_nombre_plan from public.plan where id = v_m.plan_id;

  v_nueva_fin := greatest(v_m.fecha_fin, current_date) +
    case v_unidad
      when 'dia' then interval '1 day' when 'mes' then interval '1 month'
      when 'trimestre' then interval '3 months' when 'anual' then interval '1 year'
      else interval '1 month' end;

  update public.membresia
     set fecha_fin = v_nueva_fin, estado = 'activa', precio_pagado = v_precio
   where id = p_membresia_id;

  insert into public.movimiento_financiero (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, ref_tipo, ref_id, registrado_por)
  values (v_m.empresa_id, v_m.sede_id, 'ingreso', 'membresia',
          'Renovación ' || coalesce(v_nombre_plan, 'membresía'), v_precio,
          coalesce(p_metodo_pago, 'efectivo'), 'membresia', p_membresia_id, auth.uid());

  return jsonb_build_object('estado','activa','fecha_fin', v_nueva_fin, 'monto', v_precio);
end;
$$;

grant execute on function public.renew_membership(uuid, text) to authenticated;
