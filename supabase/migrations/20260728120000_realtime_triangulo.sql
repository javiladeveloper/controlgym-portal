-- Realtime en el "triángulo" socio ↔ trainer ↔ panel.
--
-- PEDIDO del owner: "todo debe ser reactivo, por cada cambio la info se debe
-- actualizar". Hoy NO hay Supabase Realtime en ninguna parte (0 tablas en la
-- publicación); la reactividad se aproxima con polling (60s en el panel, 10-15s
-- en la app) + push FCM (cron 1 min). Esta migración habilita Realtime en las
-- tablas del triángulo para que los cambios lleguen al instante.
--
-- SEGURIDAD (respeta RLS existente): Supabase Realtime evalúa las policies RLS
-- con el JWT del cliente suscrito, así que cada cliente solo recibe SUS filas.
-- Las tablas ya tienen RLS acotada por empresa (auth_empresa_id()):
--   · notificacion / solicitud_carga / rutina / dieta → policy _scope/_tenant
--     (empresa_id = auth_empresa_id()), migración 20260703000016.
--   · solicitud_ayuda → policy staff FOR ALL por empresa, migración 20260704000016.
-- No hace falta reforzar policies; sí hace falta REPLICA IDENTITY FULL para que
-- los eventos UPDATE/DELETE traigan la fila completa (Realtime la necesita para
-- evaluar RLS sobre el registro y para que el cliente tenga el payload).
--
-- Idempotente: la publicación supabase_realtime la crea Supabase; aquí solo
-- agregamos tablas (comprobando que no estén ya) y fijamos replica identity.

-- ── 1. REPLICA IDENTITY FULL en las tablas del triángulo ───────────────────
-- Sin esto, un UPDATE emite solo la PK en el "old record" y Realtime no puede
-- evaluar RLS sobre filas borradas/actualizadas ni entregar el payload completo.
alter table public.solicitud_carga  replica identity full;
alter table public.solicitud_ayuda  replica identity full;
alter table public.notificacion     replica identity full;
alter table public.rutina           replica identity full;
alter table public.dieta            replica identity full;

-- ── 2. Agregar las tablas a la publicación supabase_realtime ───────────────
-- La publicación ya existe (la crea Supabase al iniciar el proyecto). Agregamos
-- solo lo que falte para no fallar si algo ya estuviera.
do $$
declare
  t text;
  v_tablas text[] := array[
    'solicitud_carga', 'solicitud_ayuda', 'notificacion', 'rutina', 'dieta'
  ];
begin
  -- Crear la publicación si por algún motivo no existiera (proyecto muy viejo).
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array v_tablas loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;

-- ── 3. RPC: marcar notificaciones como leídas ──────────────────────────────
-- BUG que arreglamos: el botón "Marcar leídas" del panel era un <div> sin acción
-- y no existía forma de marcar notificacion.leida. Esta RPC marca todas las no
-- leídas de la empresa del usuario (respeta el tenant vía auth_empresa_id()).
-- Con Realtime activo, el UPDATE se propaga y el badge se apaga en vivo.
create or replace function public.marcar_notificaciones_leidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_n integer;
begin
  if v_empresa is null then
    return 0;
  end if;
  update public.notificacion
     set leida = true
   where empresa_id = v_empresa
     and not leida;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Grants: solo authenticated (el barrido de 20260712000006 hace lo mismo, pero
-- lo dejamos explícito para no depender de él y por el default privilege).
revoke all on function public.marcar_notificaciones_leidas() from public;
grant execute on function public.marcar_notificaciones_leidas() to authenticated, service_role;

comment on function public.marcar_notificaciones_leidas() is
  'Marca como leídas todas las notificaciones no leídas de la empresa del usuario. Devuelve cuántas marcó.';
