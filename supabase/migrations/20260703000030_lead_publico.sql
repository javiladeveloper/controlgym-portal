-- ============================================================================
-- 30 · Captación de leads desde la página pública del gym
--   Los botones "Inscríbete ahora / Elegir plan / Aprovechar oferta" de la
--   landing crean un prospecto real en el CRM del gimnasio.
-- ============================================================================

create or replace function public.crear_lead_publico(
  p_slug text,
  p_nombre text,
  p_telefono text default null,
  p_email text default null,
  p_nota text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_e uuid;
  v_s uuid;
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
  -- Límites básicos anti-abuso
  if length(p_nombre) > 120 or length(coalesce(p_nota,'')) > 500
     or length(coalesce(p_telefono,'')) > 30 or length(coalesce(p_email,'')) > 120 then
    raise exception 'Datos demasiado largos';
  end if;

  select id into v_s from public.sede
   where empresa_id = v_e and activa and deleted_at is null
   order by created_at limit 1;

  insert into public.lead (empresa_id, sede_id, nombre, telefono, email, fuente, etapa, nota)
  values (v_e, v_s, trim(p_nombre), nullif(trim(p_telefono), ''), nullif(trim(p_email), ''),
          'Página web', 'nuevo', nullif(trim(p_nota), ''));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.crear_lead_publico(text, text, text, text, text) to anon, authenticated;

comment on function public.crear_lead_publico is
  'Crea un prospecto en el CRM del gym desde su página pública (botones de la landing).';
