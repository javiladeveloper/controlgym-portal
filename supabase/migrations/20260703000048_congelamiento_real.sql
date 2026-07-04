-- 048: Congelamiento que NO consume días de membresía.
-- Bug: al reactivar, la fecha_fin quedaba igual → los días congelados corrían.
-- Ahora: al reactivar, fecha_fin se extiende por los días REALES congelados
-- (current_date - inicio del congelamiento). El tope anual del plan
-- (dias_congelamiento_anio, 0 = no permite) se valida contra días reales.

create or replace function public.freeze_membership(p_membresia_id uuid, p_dias int default null)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_m public.membresia;
  v_tope int;
  v_usados int;
  v_cong public.congelamiento;
  v_reales int;
  v_nueva_fin date;
begin
  select * into v_m from public.membresia where id = p_membresia_id;  -- RLS aplica
  if v_m.id is null then
    raise exception 'Membresía no encontrada o sin acceso';
  end if;

  if v_m.estado = 'congelada' then
    -- Reactivar: los días congelados NO corren → se devuelven al vencimiento
    select * into v_cong from public.congelamiento
     where membresia_id = p_membresia_id and estado = 'aprobado'
     order by fecha_inicio desc limit 1;

    v_reales := greatest(coalesce(current_date - v_cong.fecha_inicio, 0), 0);
    v_nueva_fin := v_m.fecha_fin + v_reales;

    update public.membresia
       set estado = 'activa', fecha_fin = v_nueva_fin
     where id = p_membresia_id;

    update public.congelamiento
       set estado = 'finalizado', fecha_fin = current_date, dias = v_reales
     where id = v_cong.id;

    return jsonb_build_object('estado', 'activa', 'dias_congelados', v_reales, 'nueva_fecha_fin', v_nueva_fin);
  end if;

  -- Congelar: validar que el plan lo permita y el tope anual
  select p.dias_congelamiento_anio into v_tope
  from public.plan p where p.id = v_m.plan_id;

  if coalesce(v_tope, 0) = 0 then
    raise exception 'El plan no permite congelamiento';
  end if;

  select coalesce(sum(dias), 0) into v_usados
  from public.congelamiento
  where membresia_id = p_membresia_id
    and extract(year from fecha_inicio) = extract(year from current_date)
    and estado in ('aprobado', 'finalizado');

  if v_usados + coalesce(p_dias, 1) > v_tope then
    raise exception 'Excede el tope de % días de congelamiento al año (usados: %)', v_tope, v_usados;
  end if;

  update public.membresia set estado = 'congelada' where id = p_membresia_id;
  insert into public.congelamiento (empresa_id, membresia_id, fecha_inicio, dias, estado, aprobado_por)
  values (v_m.empresa_id, p_membresia_id, current_date, coalesce(p_dias, 1), 'aprobado', auth.uid());

  return jsonb_build_object('estado', 'congelada', 'dias_previstos', p_dias, 'tope', v_tope, 'usados_antes', v_usados);
end;
$$;
