-- Análisis de campañas por COHORTES (pedido del cliente Pro: "la IA analice
-- quiénes se inscribieron en campañas pasadas y ya no están, para llegar a
-- ellos con ofertas"). Decisión de producto: el QUIÉN se calcula exacto con
-- SQL (esto); el QUÉ ofrecerles queda para Leadia (teaser "Sugerencia IA").
--
-- Por cada campaña de la empresa: cuántos socios entraron con ella, cuántos
-- siguen activos y quiénes se fueron (con teléfono, listos para reactivar).

create or replace function public.cohorte_campanias()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_hoy date;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  v_hoy := (now() at time zone coalesce((select zona_horaria from public.empresa where id = v_empresa), 'America/Lima'))::date;

  return coalesce((
    with cohorte as (
      -- cada socio que ALGUNA VEZ entró/renovó con la promo
      select m.promocion_id, m.socio_id,
             bool_or(ult.fecha_fin >= v_hoy and ult.estado = 'activa') as sigue_activo,
             max(ult.fecha_fin) as ultima_fin
      from public.membresia m
      join public.socio s on s.id = m.socio_id and s.deleted_at is null
      cross join lateral (
        select m2.fecha_fin, m2.estado from public.membresia m2
        where m2.socio_id = m.socio_id and m2.deleted_at is null
        order by m2.fecha_fin desc limit 1
      ) ult
      where m.empresa_id = v_empresa and m.deleted_at is null and m.promocion_id is not null
      group by m.promocion_id, m.socio_id
    )
    select jsonb_agg(fila order by (fila->>'inscritos')::int desc)
    from (
      select jsonb_build_object(
        'promocion_id', p.id,
        'nombre', p.nombre,
        'tipo', p.tipo,
        'estado', p.estado,
        'inscritos', count(c.socio_id),
        'activos', count(c.socio_id) filter (where c.sigue_activo),
        'perdidos', count(c.socio_id) filter (where not c.sigue_activo),
        -- los que se fueron, listos para contactar (tope 30 por campaña)
        'perdidos_lista', coalesce((
          select jsonb_agg(jsonb_build_object(
              'socio_id', s.id, 'nombre', s.nombre, 'telefono', s.telefono,
              'vencio_hace_dias', v_hoy - c2.ultima_fin) order by c2.ultima_fin desc)
          from (select * from cohorte c2 where c2.promocion_id = p.id and not c2.sigue_activo limit 30) c2
          join public.socio s on s.id = c2.socio_id
        ), '[]'::jsonb)
      ) as fila
      from public.promocion p
      join cohorte c on c.promocion_id = p.id
      where p.empresa_id = v_empresa and p.deleted_at is null
      group by p.id, p.nombre, p.tipo, p.estado
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.cohorte_campanias() from public;
grant execute on function public.cohorte_campanias() to authenticated;
