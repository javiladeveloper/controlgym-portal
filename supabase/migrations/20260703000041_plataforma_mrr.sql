-- 041: Dashboard FitControl con métricas de facturación (MRR, suscripciones).
-- Extiende get_plataforma_dashboard con lo que cobra la PLATAFORMA a los gyms.

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
                             where tipo = 'ingreso' and fecha >= date_trunc('month', now())),
      -- Facturación de FitControl
      'mrr', (select coalesce(sum(monto), 0) from public.suscripcion_plataforma where estado = 'activa'),
      'mrr_potencial', (select coalesce(sum(monto), 0) from public.suscripcion_plataforma
                         where estado in ('activa', 'prueba', 'pendiente_pago')),
      'suscripciones_activas', (select count(*) from public.suscripcion_plataforma where estado = 'activa'),
      'en_prueba', (select count(*) from public.suscripcion_plataforma where estado = 'prueba'),
      'con_problemas', (select count(*) from public.suscripcion_plataforma
                         where estado in ('pendiente_pago', 'vencida')),
      'cobrado_mes', (select coalesce(sum(monto), 0) from public.pago_plataforma
                       where estado = 'exitoso' and pagado_at >= date_trunc('month', now()))
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
        'plan', e.plan_slug,
        'plan_con_app', e.plan_con_app,
        'suscripcion_estado', (select sp.estado from public.suscripcion_plataforma sp where sp.empresa_id = e.id),
        'suscripcion_monto', (select sp.monto from public.suscripcion_plataforma sp where sp.empresa_id = e.id),
        'trial_hasta', (select sp.trial_hasta from public.suscripcion_plataforma sp where sp.empresa_id = e.id),
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
