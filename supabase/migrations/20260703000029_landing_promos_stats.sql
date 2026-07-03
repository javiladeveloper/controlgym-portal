-- ============================================================================
-- 29 · Landing: promociones activas + estadísticas reales del gym
--   · promociones: campañas con estado='activa' salen en la página pública.
--   · stats_reales: conteos calculados (socios activos, sedes, clases/semana,
--     entrenadores). El frontend los usa cuando el gym no define stats manuales.
-- ============================================================================

create or replace function public.get_landing_by_slug(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_empresa public.empresa;
  result jsonb;
begin
  select * into v_empresa from public.empresa
   where lower(slug) = lower(p_slug) and estado = 'activa' and deleted_at is null
   limit 1;

  if v_empresa.id is null or not v_empresa.landing_activa then
    return null;
  end if;

  select jsonb_build_object(
    'nombre', v_empresa.nombre,
    'slug', v_empresa.slug,
    'eslogan', v_empresa.eslogan,
    'mensaje_bienvenida', v_empresa.mensaje_bienvenida,
    'direccion', v_empresa.direccion,
    'horario_atencion', v_empresa.horario_atencion,
    'telefono', v_empresa.telefono_contacto,
    'email', v_empresa.email_contacto,
    'redes', v_empresa.redes,
    'moneda', v_empresa.moneda,
    'landing', v_empresa.landing,
    'tema', (select to_jsonb(t) - 'created_at' - 'updated_at' from public.empresa_tema t where t.empresa_id = v_empresa.id),
    'sedes', (select coalesce(jsonb_agg(jsonb_build_object(
                'nombre', s.nombre, 'direccion', s.direccion, 'telefono', s.telefono, 'foto_url', s.foto_url
              ) order by s.nombre), '[]'::jsonb)
              from public.sede s where s.empresa_id = v_empresa.id and s.activa and s.deleted_at is null),
    'planes', (select coalesce(jsonb_agg(jsonb_build_object(
                'nombre', p.nombre, 'precio', p.precio, 'unidad', p.unidad,
                'descripcion', p.descripcion, 'badge', p.badge, 'orden', p.orden
              ) order by p.orden), '[]'::jsonb)
              from public.plan p where p.empresa_id = v_empresa.id and p.activo and p.deleted_at is null),
    'clases', (select coalesce(jsonb_agg(distinct tc.nombre), '[]'::jsonb)
               from public.tipo_clase tc where tc.empresa_id = v_empresa.id),
    -- Promociones activas y vigentes
    'promociones', (select coalesce(jsonb_agg(jsonb_build_object(
                'nombre', pr.nombre, 'descripcion', pr.descripcion,
                'canal', pr.canal, 'fecha_fin', pr.fecha_fin
              ) order by pr.created_at desc), '[]'::jsonb)
              from public.promocion pr
              where pr.empresa_id = v_empresa.id and pr.estado = 'activa' and pr.deleted_at is null
                and (pr.fecha_fin is null or pr.fecha_fin >= current_date)),
    -- Conteos reales para stats automáticas
    'stats_reales', jsonb_build_object(
      'socios_activos', (select count(*) from public.socio so
                          where so.empresa_id = v_empresa.id and so.estado = 'activo' and so.deleted_at is null),
      'sedes', (select count(*) from public.sede s
                 where s.empresa_id = v_empresa.id and s.activa and s.deleted_at is null),
      'clases_semana', (select count(*) from public.clase c
                         where c.empresa_id = v_empresa.id and c.activa and c.deleted_at is null),
      'entrenadores', (select count(distinct ue.usuario_id)
                        from public.usuario_empresa ue
                        join public.rol r on r.id = ue.rol_id
                        where ue.empresa_id = v_empresa.id and ue.activo
                          and r.codigo in ('entrenador','nutricionista'))
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_landing_by_slug(text) to anon, authenticated;
