-- Promociones con DURACIÓN del beneficio (reglas definidas con el owner):
--   'primera'    -> solo la inscripción (comportamiento de siempre, default)
--   'permanente' -> "de por vida MIENTRAS PAGUEN": el beneficio aplica en cada
--                   renovación, pero SE ROMPE PARA SIEMPRE si la membresía se
--                   cortó (más de 7 días vencida antes de renovar). En grupos
--                   (2x1/grupal) además TODOS deben seguir vivos.
--   'meses'      -> beneficio por N meses CONTADOS DESDE LA INSCRIPCIÓN
--                   (ventana calendario, no por número de renovaciones).

alter table public.promocion add column if not exists vigencia_beneficio text
  not null default 'primera'
  check (vigencia_beneficio in ('primera', 'permanente', 'meses'));
alter table public.promocion add column if not exists vigencia_meses int
  check (vigencia_meses between 1 and 60);

-- Motor: dada una membresía a renovar, ¿su promo de ORIGEN sigue dando
-- beneficio? Devuelve el precio sugerido y el porqué, para que el POS lo
-- proponga. NO cobra nada — solo calcula.
create or replace function public.promo_beneficio_renovacion(p_membresia_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_m public.membresia;
  v_promo public.promocion;
  v_plan public.plan;
  v_origen date;            -- primera membresía del socio con esa promo
  v_precio numeric;
  v_gracia constant int := 7; -- días de gracia para no "romper" por renovar tarde
  v_roto boolean := false;
  v_grupo jsonb := '[]'::jsonb;
  v_hoy date;
begin
  select * into v_m from public.membresia where id = p_membresia_id and deleted_at is null;
  if v_m.id is null then return jsonb_build_object('aplica', false, 'motivo', 'membresia_inexistente'); end if;
  if public.auth_empresa_id() is distinct from v_m.empresa_id then
    return jsonb_build_object('aplica', false, 'motivo', 'no_autorizado'); end if;
  if v_m.promocion_id is null then return jsonb_build_object('aplica', false, 'motivo', 'sin_promo_origen'); end if;

  select * into v_promo from public.promocion where id = v_m.promocion_id;
  select * into v_plan from public.plan where id = v_m.plan_id;
  v_hoy := (now() at time zone coalesce((select zona_horaria from public.empresa where id = v_m.empresa_id), 'America/Lima'))::date;

  -- 'primera': el beneficio fue solo al inscribirse
  if coalesce(v_promo.vigencia_beneficio, 'primera') = 'primera' then
    return jsonb_build_object('aplica', false, 'motivo', 'solo_primera_vez',
      'promo', v_promo.nombre);
  end if;

  -- Ventana por meses: desde la PRIMERA membresía del socio con esta promo
  select min(fecha_inicio) into v_origen from public.membresia
  where socio_id = v_m.socio_id and promocion_id = v_promo.id and deleted_at is null;

  if v_promo.vigencia_beneficio = 'meses' then
    if v_origen + make_interval(months => coalesce(v_promo.vigencia_meses, 0)) <= v_hoy then
      return jsonb_build_object('aplica', false, 'motivo', 'beneficio_vencido',
        'promo', v_promo.nombre,
        'vencio', (v_origen + make_interval(months => coalesce(v_promo.vigencia_meses, 0)))::date);
    end if;
  end if;

  -- "Mientras paguen": si esta membresía se cortó (vencida hace > gracia), roto para siempre
  if v_m.fecha_fin < v_hoy - v_gracia then v_roto := true; end if;

  -- Grupos (2x1/grupal): TODOS los que entraron juntos deben seguir vivos.
  -- "Juntos" = membresías del mismo día de origen con la misma promo.
  if not v_roto and v_promo.tipo in ('2x1', 'grupal') then
    -- Compañeros = socios cuya membresía de ORIGEN (misma promo, mismo día de
    -- inicio) los une al grupo; su estado actual es su ÚLTIMA membresía.
    with companeros as (
      select distinct m2.socio_id
      from public.membresia m2
      where m2.promocion_id = v_promo.id and m2.empresa_id = v_m.empresa_id
        and m2.deleted_at is null and m2.fecha_inicio = v_origen
        and m2.socio_id <> v_m.socio_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'socio_id', s.id, 'nombre', s.nombre, 'membresia_id', ult.id,
        'fecha_fin', ult.fecha_fin, 'vivo', ult.fecha_fin >= v_hoy - v_gracia)), '[]'::jsonb)
    into v_grupo
    from companeros c
    join public.socio s on s.id = c.socio_id
    cross join lateral (
      select m3.id, m3.fecha_fin from public.membresia m3
      where m3.socio_id = c.socio_id and m3.deleted_at is null
      order by m3.fecha_fin desc limit 1
    ) ult;
    if exists (
      select 1 from jsonb_array_elements(v_grupo) g where not (g->>'vivo')::boolean
    ) then v_roto := true; end if;
  end if;

  if v_roto then
    return jsonb_build_object('aplica', false, 'motivo', 'beneficio_roto',
      'promo', v_promo.nombre, 'detalle', 'El grupo dejó de pagar junto o la membresía se cortó — el beneficio se pierde de forma definitiva.');
  end if;

  -- Precio con el beneficio aplicado (misma matemática de la inscripción)
  v_precio := v_plan.precio;
  if v_promo.tipo = 'descuento_pct' then
    v_precio := round(v_plan.precio * (1 - coalesce(v_promo.valor, 0) / 100.0), 2);
  elsif v_promo.tipo = 'descuento_monto' then
    v_precio := greatest(0, v_plan.precio - coalesce(v_promo.valor, 0));
  elsif v_promo.tipo = 'precio_especial' then
    v_precio := coalesce(v_promo.valor, v_plan.precio);
  elsif v_promo.tipo = '2x1' then
    v_precio := v_plan.precio; -- se cobra 1 mensualidad y se renueva a los 2 (grupo)
  elsif v_promo.tipo = 'grupal' then
    v_precio := round(v_plan.precio * coalesce(v_promo.grupo_pagan, 1), 2); -- por el grupo
  end if;
  -- semana_gratis: precio normal + 7 días extra (lo aplica quien cobra)

  return jsonb_build_object(
    'aplica', true,
    'promo', v_promo.nombre,
    'tipo', v_promo.tipo,
    'vigencia', v_promo.vigencia_beneficio,
    'precio_sugerido', v_precio,
    'dias_extra', case when v_promo.tipo = 'semana_gratis' then 7 else 0 end,
    'grupo', v_grupo,
    'nota', case
      when v_promo.tipo = '2x1' then 'Cobra 1 mensualidad y renueva a los 2 (usa monto 0 en el acompañante).'
      when v_promo.tipo = 'grupal' then 'Cobra por los que pagan y renueva a todo el grupo.'
      else null end
  );
end $$;

revoke all on function public.promo_beneficio_renovacion(uuid) from public;
grant execute on function public.promo_beneficio_renovacion(uuid) to authenticated;
