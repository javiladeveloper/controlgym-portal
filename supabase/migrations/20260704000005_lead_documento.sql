-- ============================================================================
-- 76 (20260704000005) · DNI en el formulario público del gym
-- El interesado puede dejar su DNI (opcional). NO se valida en la página
-- pública (cero fricción); la verificación contra el padrón (MAXFIND) la ve
-- el gym en su CRM cuando revisa la solicitud.
-- ============================================================================

alter table public.lead add column if not exists documento text;

create or replace function public.crear_lead_publico(
  p_slug text,
  p_nombre text,
  p_telefono text default null,
  p_email text default null,
  p_nota text default null,
  p_fuente text default null,
  p_documento text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_e uuid;
  v_s uuid;
  v_fuente text;
begin
  select id into v_e from public.empresa
   where lower(slug) = lower(p_slug) and estado = 'activa' and deleted_at is null;
  if v_e is null then
    raise exception 'Gimnasio no encontrado';
  end if;

  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El nombre es obligatorio';
  end if;
  if coalesce(trim(p_telefono), '') = '' and coalesce(trim(p_email), '') = '' then
    raise exception 'Deja un teléfono o correo para poder contactarte';
  end if;
  if length(p_nombre) > 120 or length(coalesce(p_nota,'')) > 500
     or length(coalesce(p_telefono,'')) > 30 or length(coalesce(p_email,'')) > 120
     or length(coalesce(p_fuente,'')) > 40 or length(coalesce(p_documento,'')) > 15 then
    raise exception 'Datos demasiado largos';
  end if;

  v_fuente := coalesce(initcap(nullif(trim(p_fuente), '')), 'Página web');

  select id into v_s from public.sede
   where empresa_id = v_e and activa and deleted_at is null
   order by created_at limit 1;

  insert into public.lead (empresa_id, sede_id, nombre, telefono, email, fuente, etapa, nota, documento)
  values (v_e, v_s, trim(p_nombre), nullif(trim(p_telefono), ''), nullif(trim(p_email), ''),
          v_fuente, 'nuevo', nullif(trim(p_nota), ''), nullif(regexp_replace(coalesce(p_documento,''), '\D', '', 'g'), ''));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.crear_lead_publico(text, text, text, text, text, text, text) to anon, authenticated;
