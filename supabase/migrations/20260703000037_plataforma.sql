-- ============================================================================
-- 37 · FitControl: dashboard de plataforma (super-admin)
--   El dueño de la plataforma ve TODOS los gimnasios y métricas globales.
--   Se implementa con RPCs security definer que validan es_superadmin —
--   sin tocar las políticas RLS de los tenants.
-- ============================================================================

alter table public.usuario
  add column if not exists es_superadmin boolean not null default false;

-- El dueño de la plataforma
update public.usuario set es_superadmin = true
 where email = 'jonathan.joan.avila@gmail.com';

create or replace function public.es_superadmin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select es_superadmin from public.usuario where id = auth.uid()), false);
$$;

-- ── Dashboard global de la plataforma ───────────────────────────────────────
create or replace function public.get_plataforma_dashboard()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.es_superadmin() then
    raise exception 'Solo el administrador de la plataforma puede ver esto';
  end if;

  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'empresas', (select count(*) from public.empresa where deleted_at is null),
      'empresas_mes', (select count(*) from public.empresa where deleted_at is null
                        and created_at >= date_trunc('month', now())),
      'sedes', (select count(*) from public.sede where deleted_at is null and activa),
      'socios', (select count(*) from public.socio where deleted_at is null and estado = 'activo'),
      'socios_mes', (select count(*) from public.socio where deleted_at is null
                      and created_at >= date_trunc('month', now())),
      'leads_mes', (select count(*) from public.lead where deleted_at is null
                     and created_at >= date_trunc('month', now())),
      'checkins_hoy', (select count(*) from public.checkin
                        where resultado = 'permitido' and ocurrido_en::date = current_date),
      'ingresos_gyms_mes', (select coalesce(sum(monto), 0) from public.movimiento_financiero
                             where tipo = 'ingreso' and fecha >= date_trunc('month', now()))
    ),
    'empresas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'nombre', e.nombre,
        'slug', e.slug,
        'categoria', (select nombre from public.categoria_gym where id = e.categoria_id),
        'created_at', e.created_at,
        'landing_activa', e.landing_activa,
        'email_contacto', e.email_contacto,
        'sedes', (select count(*) from public.sede s where s.empresa_id = e.id and s.deleted_at is null),
        'socios', (select count(*) from public.socio so where so.empresa_id = e.id and so.deleted_at is null and so.estado = 'activo'),
        'leads_mes', (select count(*) from public.lead l where l.empresa_id = e.id and l.deleted_at is null
                       and l.created_at >= date_trunc('month', now())),
        'ingresos_mes', (select coalesce(sum(mf.monto), 0) from public.movimiento_financiero mf
                          where mf.empresa_id = e.id and mf.tipo = 'ingreso' and mf.fecha >= date_trunc('month', now()))
      ) order by e.created_at desc), '[]'::jsonb)
      from public.empresa e where e.deleted_at is null
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.es_superadmin() to authenticated;
grant execute on function public.get_plataforma_dashboard() to authenticated;

-- ── Exponer el flag en el bootstrap ─────────────────────────────────────────
-- (se añade 'es_superadmin' al jsonb del bootstrap)
create or replace function public.get_bootstrap()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_empresa uuid := public.auth_empresa_id();
  result jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
    'usuario', (
      select to_jsonb(u) - 'created_at' - 'updated_at'
      from public.usuario u where u.id = v_uid
    ),
    'es_superadmin', public.es_superadmin(),
    'empresa_activa', (
      select to_jsonb(e) from public.empresa e where e.id = v_empresa
    ),
    'rol', public.auth_rol(),
    'tema', (
      select to_jsonb(t) - 'created_at' - 'updated_at'
      from public.empresa_tema t where t.empresa_id = v_empresa
    ),
    'empresas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'empresa_id', ue.empresa_id,
        'nombre', e.nombre,
        'rol', r.codigo,
        'es_default', ue.es_default
      )), '[]'::jsonb)
      from public.usuario_empresa ue
      join public.empresa e on e.id = ue.empresa_id
      join public.rol r on r.id = ue.rol_id
      where ue.usuario_id = v_uid and ue.activo
    ),
    'modulos', public.get_modulos_activos(),
    'sedes', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.nombre), '[]'::jsonb)
      from public.sede s
      where s.empresa_id = v_empresa
        and s.deleted_at is null
        and (s.id in (select public.auth_sede_ids()) or public.auth_is_admin())
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_bootstrap() to authenticated;
