-- ============================================================================
-- 74 (20260704000003) · Disparador del worker de push
-- pg_cron llama cada minuto al endpoint /api/push/enviar con el secreto
-- compartido (vive en privado.secreto, clave 'push_worker_secret' — se
-- inserta por fuera, nunca en el repo). Si no hay nada en cola, el endpoint
-- responde en milisegundos.
-- ============================================================================

create or replace function public.llamar_push_worker()
returns void
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_secret text;
begin
  select valor into v_secret from privado.secreto where clave = 'push_worker_secret';
  if v_secret is null then return; end if;

  -- Solo llamar si hay trabajo (ahorra invocaciones de Vercel)
  if not exists (select 1 from public.push_cola where enviado_at is null
                   and creado_at > now() - interval '2 days') then
    return;
  end if;

  begin
    perform net.http_post(
      url := 'https://fitcorecenter.com/api/push/enviar',
      headers := jsonb_build_object('x-push-secret', v_secret, 'Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  exception when others then
    null;
  end;
end;
$$;

select cron.schedule('fitcontrol-push-worker', '* * * * *', $$select public.llamar_push_worker()$$)
where not exists (select 1 from cron.job where jobname = 'fitcontrol-push-worker');
