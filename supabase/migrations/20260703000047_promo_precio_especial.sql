-- 047: Promoción "precio especial" — cambia precio Y duración de la membresía.
-- Caso: "Paga S/500 y entrena todo el año". valor = precio total,
-- duracion_meses = cuánto dura la membresía con esa promo (pisa al plan).

alter table public.promocion
  add column if not exists duracion_meses int check (duracion_meses between 1 and 36);

alter table public.promocion drop constraint if exists promocion_tipo_check;
alter table public.promocion add constraint promocion_tipo_check
  check (tipo in ('descuento_pct', 'descuento_monto', '2x1', 'semana_gratis', 'precio_especial', 'otro'));

-- inscribir_socio v3: soporta precio_especial
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
          v_matricula := 0;
          v_desc := v_promo.nombre || ' (matrícula gratis)';
        elsif v_promo.tipo = 'precio_especial' then
          -- La promo define el trato completo: precio total y duración propia
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
