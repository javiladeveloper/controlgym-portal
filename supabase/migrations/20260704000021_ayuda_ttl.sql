-- ============================================================================
-- 93 (20260704000021) · Ayuda a socios: TTL + push inmediato (PEDIDO 11 app)
--
-- 11.1 TTL: las solicitudes de ayuda viven 60 min. Se marcan 'expirada'
--      server-side (cron) para que el push no tome una zombie vieja y se
--      liberen los uniques por socio. La función viene del app agent; aquí
--      agrego 'expirada' al CHECK (no estaba) y programo el cron.
-- 11.3 El push de AYUDA tarda: el trigger ya encola inmediato, pero esperaba
--      al worker (cron cada minuto). Ahora el trigger DISPARA el worker al
--      instante (llamar_push_worker) → el trainer lo recibe en segundos.
-- 11.4 Push sin datos: el trigger YA arma el cuerpo con motivo+ejercicio+
--      ubicación desde la fila recién creada (new.*), por id. El "push sin
--      datos" era una solicitud zombie vieja → lo resuelve el TTL (11.1).
-- ============================================================================

-- ── 11.1a: aceptar el estado 'expirada' ────────────────────────────────────
alter table public.solicitud_ayuda drop constraint if exists solicitud_ayuda_estado_check;
alter table public.solicitud_ayuda add constraint solicitud_ayuda_estado_check
  check (estado in ('pendiente','en_camino','atendida','cancelada','expirada'));

-- ── 11.1b: función de expiración (del app agent, idempotente) ───────────────
create or replace function public.expirar_ayudas_vencidas()
returns integer
language sql
security definer
set search_path = public
as $$
  with vencidas as (
    update public.solicitud_ayuda
       set estado = 'expirada', cerrada_at = coalesce(cerrada_at, now())
     where estado in ('pendiente', 'en_camino')
       and creado_at < now() - interval '60 minutes'
    returning 1
  )
  select count(*)::int from vencidas;
$$;

-- ── 11.1c: cron cada 2 min ──────────────────────────────────────────────────
select cron.unschedule('expirar-ayudas') where exists (select 1 from cron.job where jobname = 'expirar-ayudas');
select cron.schedule('expirar-ayudas', '*/2 * * * *', $$ select public.expirar_ayudas_vencidas(); $$);

-- ── 11.3: el trigger de alta dispara el worker de push al instante ──────────
-- (se recompila el trigger existente agregando la llamada al final; preserva
-- todo el cuerpo actual que ya arma bien el cuerpo del push por new.*)
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.trg_solicitud_ayuda_alta()'::regprocedure);
  if position('llamar_push_worker' in v_def) > 0 then return; end if;
  -- Insertar la llamada justo antes del "return new;" final
  v_def := replace(
    v_def,
    E'\n  return new;\nend;',
    E'\n  -- Push en TIEMPO REAL: el socio espera en el gym. No aguardar al cron.\n  perform public.llamar_push_worker();\n\n  return new;\nend;');
  execute v_def;
end $$;
