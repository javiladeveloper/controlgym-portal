-- AUDITORÍA DE SEGURIDAD (advisors de Supabase, 12-jul-2026). Cuatro arreglos:
--
-- 1) [ERROR] v_dashboard_sede era SECURITY DEFINER: cualquier usuario
--    autenticado de CUALQUIER gym podía leer los KPIs de todas las sedes de
--    todos los gyms (saltaba el RLS de las tablas de abajo). Pasa a
--    security_invoker: la vista respeta el RLS del que consulta.
-- 2) [ERROR] 4 tablas de dedup de crons sin RLS (mant_avisado, sla_lead_avisado,
--    cumple_avisado, aforo_avisado): expuestas a lectura/escritura por la API.
--    RLS on sin policies = la API las niega; los crons (definer/postgres) siguen.
-- 3) [WARN] 7 funciones sin search_path fijo (riesgo de hijacking por schema).
-- 4) [WARN] 134 funciones ejecutables por ANON (grant implícito vía PUBLIC).
--    Se revoca PUBLIC/anon de TODAS las funciones de public y se concede solo
--    a authenticated + service_role, con lista blanca explícita para lo que
--    la web pública SÍ necesita como anon, y el hook de tokens para GoTrue.

-- 1) La vista del dashboard respeta el RLS del consultante
alter view public.v_dashboard_sede set (security_invoker = true);

-- 2) Tablas de dedup de crons: negadas a la API (sin policies a propósito)
alter table public.mant_avisado enable row level security;
alter table public.sla_lead_avisado enable row level security;
alter table public.cumple_avisado enable row level security;
alter table public.aforo_avisado enable row level security;

-- 3) search_path fijo en las funciones que no lo tenían
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('set_updated_at','auth_is_admin','rpc_asistencia_por_hora',
                        'precio_plan','limite_socios_plan','sync_usa_carnet_qr',
                        'stamp_lead_asignado_at')
  loop
    execute format('alter function %s set search_path = public', r.firma);
  end loop;
end $$;

-- 4) Funciones: fuera anon/PUBLIC, entra authenticated/service_role.
--    Lista blanca anon = lo que la web pública del gym usa sin sesión.
do $$
declare
  r record;
  anon_ok constant text[] := array[
    'crear_lead_publico',        -- formulario de la landing del gym
    'get_landing_by_slug',       -- carga de la landing pública
    'registrar_visita_landing',  -- contador de visitas
    'enviar_sugerencia',         -- buzón de sugerencias público
    'crear_reclamacion',         -- libro de reclamaciones (obligación legal)
    'leadia_ingresar_lead'       -- conector Leadia (protegido por secreto propio)
  ];
begin
  for r in
    select p.oid::regprocedure as firma, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public', r.firma);
    execute format('revoke all on function %s from anon', r.firma);
    execute format('grant execute on function %s to authenticated, service_role', r.firma);
    if r.proname = any(anon_ok) then
      execute format('grant execute on function %s to anon', r.firma);
    end if;
    -- GoTrue invoca el hook de claims con su propio rol: sin esto, NADIE loguea
    if r.proname = 'custom_access_token_hook' then
      execute format('grant execute on function %s to supabase_auth_admin', r.firma);
    end if;
  end loop;
end $$;

-- Las funciones FUTURAS nacen sin grant para anon/PUBLIC (default privileges
-- del rol postgres, que es quien corre las migraciones).
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
