-- PEDIDO 25 — Dashboard super-admin: comisiones de MercadoPago (pagos por app).
--
-- El dashboard de plataforma ya existe (get_plataforma_dashboard: KPIs, MRR de
-- suscripciones, tabla de gyms). Le agregamos la data del marketplace que antes
-- no existía: la comisión (5%) que FitCore gana por los pagos por app, el
-- volumen procesado, y cuántos gyms conectaron cobros. Es aditivo: solo se
-- añaden claves nuevas a `kpis` y a cada empresa; el resto queda idéntico.

create or replace function public.get_plataforma_dashboard()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
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
      -- Facturación de FitCore (suscripciones del SaaS)
      'mrr', (select coalesce(sum(monto), 0) from public.suscripcion_plataforma where estado = 'activa'),
      'mrr_potencial', (select coalesce(sum(monto), 0) from public.suscripcion_plataforma
                         where estado in ('activa', 'prueba', 'pendiente_pago')),
      'suscripciones_activas', (select count(*) from public.suscripcion_plataforma where estado = 'activa'),
      'en_prueba', (select count(*) from public.suscripcion_plataforma where estado = 'prueba'),
      'con_problemas', (select count(*) from public.suscripcion_plataforma
                         where estado in ('pendiente_pago', 'vencida')),
      'cobrado_mes', (select coalesce(sum(monto), 0) from public.pago_plataforma
                       where estado = 'exitoso' and pagado_at >= date_trunc('month', now())),
      -- ══ NUEVO (PEDIDO 25): comisiones de MercadoPago por pagos in-app ══
      -- comision_fitcore = el marketplace_fee (5%) que FitCore retuvo por cada
      -- pago aprobado. mes = del mes en curso; total = histórico.
      'comision_mp_mes', (select coalesce(sum(comision_fitcore), 0) from public.pago_app
                           where estado_pago = 'aprobado' and pagado_at >= date_trunc('month', now())),
      'comision_mp_total', (select coalesce(sum(comision_fitcore), 0) from public.pago_app
                             where estado_pago = 'aprobado'),
      -- volumen bruto procesado por app este mes (lo que pagaron los socios)
      'ventas_app_mes', (select coalesce(sum(monto), 0) from public.pago_app
                          where estado_pago = 'aprobado' and pagado_at >= date_trunc('month', now())),
      'ventas_app_total', (select coalesce(sum(monto), 0) from public.pago_app
                            where estado_pago = 'aprobado'),
      -- gyms que conectaron su cuenta de MercadoPago (pueden cobrar por app)
      'gyms_con_cobros', (select count(*) from public.empresa_mp),
      'pagos_app_mes', (select count(*) from public.pago_app
                         where estado_pago = 'aprobado' and pagado_at >= date_trunc('month', now()))
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
                          where mf.empresa_id = e.id and mf.tipo = 'ingreso' and mf.fecha >= date_trunc('month', now())),
        -- NUEVO (PEDIDO 25): cobros por app de este gym
        'cobros_conectados', exists(select 1 from public.empresa_mp mp where mp.empresa_id = e.id),
        'ventas_app_mes', (select coalesce(sum(pa.monto), 0) from public.pago_app pa
                            where pa.empresa_id = e.id and pa.estado_pago = 'aprobado'
                              and pa.pagado_at >= date_trunc('month', now())),
        'comision_mp_mes', (select coalesce(sum(pa.comision_fitcore), 0) from public.pago_app pa
                             where pa.empresa_id = e.id and pa.estado_pago = 'aprobado'
                               and pa.pagado_at >= date_trunc('month', now()))
      ) order by e.created_at desc), '[]'::jsonb)
      from public.empresa e where e.deleted_at is null
    )
  ) into result;

  return result;
end;
$function$;
