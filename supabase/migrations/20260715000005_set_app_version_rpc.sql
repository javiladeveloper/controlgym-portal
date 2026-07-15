-- RPC para que el CI de la app actualice el versionCode del popup vía HTTPS
-- (PostgREST), evitando psql/connection-string y sus líos de IPv4/IPv6 desde
-- GitHub Actions. Solo se puede llamar con el service_role key (nunca anon).
-- Ya aplicada en Supabase.
create or replace function public.set_app_version(
  p_plataforma text,
  p_version_code int,
  p_version_name text default null
) returns void
 language sql security definer
 set search_path to 'public'
as $function$
  insert into public.app_version (plataforma, version_code, version_name, actualizado_at)
  values (p_plataforma, p_version_code, nullif(p_version_name, ''), now())
  on conflict (plataforma) do update
    set version_code = excluded.version_code,
        version_name = coalesce(excluded.version_name, public.app_version.version_name),
        actualizado_at = now();
$function$;

revoke all on function public.set_app_version(text, int, text) from public, anon, authenticated;
grant execute on function public.set_app_version(text, int, text) to service_role;
