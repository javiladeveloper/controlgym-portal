-- ============================================================================
-- 38 · Alta automática del subdominio en Vercel
--   Cuando se crea una empresa (o cambia su slug), se registra
--   <slug>.fitcorecenter.com en el proyecto de Vercel vía API (pg_net).
--   El token vive en privado.secreto ('vercel_token'). Nunca bloquea el alta.
-- ============================================================================

create or replace function public.registrar_subdominio_vercel()
returns trigger
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_token text;
begin
  if new.slug is null or new.slug = '' then
    return new;
  end if;
  -- solo si el slug es nuevo o cambió
  if tg_op = 'UPDATE' and new.slug is not distinct from old.slug then
    return new;
  end if;

  select valor into v_token from privado.secreto where clave = 'vercel_token';
  if v_token is null then
    return new;
  end if;

  begin
    perform net.http_post(
      url := 'https://api.vercel.com/v10/projects/fitcore/domains?teamId=team_kr4GLmjqzYi9UCOFFz8MPoR6',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('name', new.slug || '.fitcorecenter.com')
    );
  exception when others then
    null; -- el dominio jamás debe romper el registro del gym
  end;

  return new;
end;
$$;

drop trigger if exists trg_subdominio_vercel on public.empresa;
create trigger trg_subdominio_vercel
  after insert or update of slug on public.empresa
  for each row execute function public.registrar_subdominio_vercel();
