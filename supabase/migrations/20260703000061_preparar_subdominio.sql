-- ============================================================================
-- 61 · Pre-registro del subdominio en Vercel
-- La empresa ahora se crea al FINAL del wizard, así que el SSL del subdominio
-- arrancaba en frío justo cuando el usuario presiona "Ver mi página".
-- Este RPC registra <slug>.fitcorecenter.com apenas empieza el wizard:
-- para cuando el usuario termina las 4 preguntas, el certificado ya está listo.
-- Registrar un dominio que no llega a usarse es inofensivo (muestra
-- "gym no encontrado" y el trigger del alta lo vuelve a pedir igual).
-- ============================================================================

create or replace function public.preparar_subdominio(p_slug text)
returns void
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_token text;
  v_slug text := lower(trim(p_slug));
begin
  if v_slug is null or v_slug = '' or v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    return;
  end if;

  select valor into v_token from privado.secreto where clave = 'vercel_token';
  if v_token is null then return; end if;

  begin
    perform net.http_post(
      url := 'https://api.vercel.com/v10/projects/fitcore/domains?teamId=team_kr4GLmjqzYi9UCOFFz8MPoR6',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('name', v_slug || '.fitcorecenter.com')
    );
  exception when others then
    null;
  end;
end;
$$;

grant execute on function public.preparar_subdominio(text) to authenticated;
