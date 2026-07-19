-- Socios cuya rutina activa vence en <=3 días o ya venció. Para la sección
-- "por vencer" del panel. Filtra por empresa (aislamiento) y sede.
create or replace function public.rutinas_por_vencer(p_sede_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.auth_empresa_id();
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'rutina_id', r.id, 'socio_id', s.id, 'socio', s.nombre,
      'rutina', r.nombre, 'vigencia_fin', r.vigencia_fin,
      'dias_restantes', (r.vigencia_fin - current_date),
      'objetivo', coalesce(o.nombre, r.objetivo))
      order by r.vigencia_fin)
    from public.rutina r
    join public.socio s on s.id = r.socio_id
    left join public.objetivo_entrenamiento o on o.id = r.objetivo_id
    where r.empresa_id = v_emp and r.activa
      and r.vigencia_fin is not null
      and r.vigencia_fin <= current_date + 3
      and (p_sede_id is null or s.sede_id = p_sede_id)
      and s.deleted_at is null
  ), '[]'::jsonb);
end $$;
revoke all on function public.rutinas_por_vencer(uuid) from public;
grant execute on function public.rutinas_por_vencer(uuid) to authenticated, service_role;
