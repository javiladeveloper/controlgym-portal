-- ============================================================================
-- 59 · Límite de socios activos por plan comercial
--   estudio → 50 · crecimiento → 200 · cadena y demás segmentos → sin límite
-- Se valida con trigger en socio: cubre inscripciones, 2x1 e importaciones.
-- ============================================================================

create or replace function public.limite_socios_plan(p_plan text)
returns int language sql immutable as $$
  select case p_plan when 'estudio' then 50 when 'crecimiento' then 200 else null end
$$;

create or replace function public.trg_check_limite_socios()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_plan text;
  v_lim int;
  v_count int;
begin
  select plan_slug into v_plan from public.suscripcion_plataforma where empresa_id = new.empresa_id;
  v_lim := public.limite_socios_plan(v_plan);
  if v_lim is not null then
    select count(*) into v_count from public.socio
     where empresa_id = new.empresa_id and deleted_at is null;
    if v_count >= v_lim then
      raise exception 'Alcanzaste el límite de % socios de tu plan %. Sube de plan en Configuración → Mi plan para seguir creciendo.',
        v_lim, initcap(v_plan);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_socio_limite on public.socio;
create trigger trg_socio_limite
  before insert on public.socio
  for each row execute function public.trg_check_limite_socios();

comment on function public.limite_socios_plan(text) is
  'Tope de socios activos según plan comercial (null = ilimitado).';
