-- ============================================================================
-- 71 · El límite de socios por plan cuenta solo MIEMBROS ACTIVOS
-- Antes contaba todo socio no borrado: un gym con 60 registrados pero 45
-- activos quedaba bloqueado injustamente en el plan Estudio (50). Las bajas
-- y los inactivos ya no ocupan cupo.
-- ============================================================================

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
     where empresa_id = new.empresa_id and deleted_at is null and estado = 'activo';
    if v_count >= v_lim then
      raise exception 'Alcanzaste el límite de % socios ACTIVOS de tu plan %. Sube de plan en Configuración → Mi plan para seguir creciendo.',
        v_lim, initcap(v_plan);
    end if;
  end if;
  return new;
end;
$$;
