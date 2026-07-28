-- ¿El subdominio del gym quedó aprovisionado en Vercel?
--
-- El sitemap (api/og.js) necesita saber qué subdominios EXISTEN de verdad, porque
-- basta una URL muerta para que Google rechace el sitemap entero. Antes se
-- consultaba la API de Vercel EN LÍNEA en cada request del sitemap, pero esa
-- llamada tardaba ~10s y Google marcaba "no se ha podido obtener". Ahora la
-- fuente de verdad es esta columna en la BD (consulta rápida, sin dependencias
-- externas en el camino crítico).
alter table public.empresa add column if not exists subdominio_ok boolean not null default false;

comment on column public.empresa.subdominio_ok is
  'true cuando <slug>.fitcorecenter.com quedó aprovisionado en Vercel. Lo fija preparar_subdominio. El sitemap solo incluye gyms con esto en true (evita URLs muertas).';

-- Backfill: los gyms cuyo subdominio YA está vivo hoy (verificados en Vercel).
-- Los que no resuelvan quedan en false y se corrigen al re-aprovisionar.
update public.empresa set subdominio_ok = true
where slug in ('fitcore','jonathantrainer','kidsfit','maximusgym','peniel','powder-gym','powergym','mustafa-gym');

-- preparar_subdominio ahora marca subdominio_ok al registrar el dominio en Vercel.
-- pg_net.http_post es asíncrono (devuelve request_id, no status), así que no se
-- puede leer el resultado en línea: se marca optimista (el POST casi siempre crea
-- el subdominio). Si alguno falla, queda sin resolver y se corrige re-aprovisionando.
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
      headers := jsonb_build_object('Authorization','Bearer '||v_token,'Content-Type','application/json'),
      body := jsonb_build_object('name', v_slug || '.fitcorecenter.com')
    );
    update public.empresa set subdominio_ok = true where lower(slug) = v_slug and deleted_at is null;
  exception when others then
    null;
  end;
end;
$$;

grant execute on function public.preparar_subdominio(text) to authenticated;
