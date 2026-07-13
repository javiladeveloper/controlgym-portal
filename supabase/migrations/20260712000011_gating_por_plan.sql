-- Gating de FEATURES por plan de la SEDE (decisión del owner: cada sede paga
-- su plan y las funciones que ofrece FitCore se restringen según ese plan).
-- Reparto confirmado con el owner:
--   ESTUDIO      → dashboard, clientes, membresías, ventas, clases (lo esencial)
--   CRECIMIENTO  → + CRM, rutinas, kardex, personal, promociones, finanzas, reportes, máquinas, sponsors
--   PRO          → + control de acceso avanzado / facturación / cohortes (features 'pro' dentro de módulos)
--
-- Nota de diseño: el gating es por MÓDULO (pantalla). Los sub-features 'pro'
-- (facturación electrónica, torniquete/huella, cohortes) viven DENTRO de
-- módulos ya visibles en crecimiento y se gatean en el front con el mismo
-- nivel de plan expuesto en el bootstrap. Los planes de segmento
-- (academia/ninos/trainer) traen su set por categoría — no se recortan aquí.

-- Nivel mínimo de plan que habilita cada módulo (jerarquía estudio<crecimiento<pro).
create or replace function public.plan_rank(p_slug text)
returns int language sql immutable set search_path = public as $$
  select case p_slug
    when 'estudio' then 1
    when 'academia' then 1 when 'ninos' then 1 when 'trainer' then 1
    when 'crecimiento' then 2
    when 'pro' then 3 when 'cadena' then 3
    else 1 end
$$;

create or replace function public.modulo_min_rank(p_slug text)
returns int language sql immutable set search_path = public as $$
  select case p_slug
    -- Estudio (rank 1)
    when 'dashboard' then 1 when 'clientes' then 1 when 'membresias' then 1
    when 'ventas' then 1 when 'clases' then 1 when 'configuracion' then 1
    -- Crecimiento (rank 2)
    when 'crm' then 2 when 'rutinas' then 2 when 'kardex' then 2 when 'personal' then 2
    when 'promociones' then 2 when 'finanzas' then 2 when 'reportes' then 2
    when 'maquinas' then 2 when 'sponsors' then 2
    else 1 end
$$;

-- RPC nuevo: módulos de UNA sede = categoría del gym ∩ plan de esa sede.
-- El front lo llama al cargar y al cambiar de sede (la sede vive en el front,
-- no en el JWT). get_modulos_activos() se deja intacto como fallback por
-- categoría (compat con la app y con quien no pase sede).
create or replace function public.modulos_de_sede(p_sede_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_plan text;
  v_rank int;
begin
  if v_emp is null then return '[]'::jsonb; end if;
  -- la sede debe ser de la empresa activa (aislamiento)
  if not exists (select 1 from public.sede where id = p_sede_id and empresa_id = v_emp) then
    return public.get_modulos_activos();  -- sede inválida → cae al set por categoría
  end if;

  select coalesce(ss.plan_slug, e.plan_slug) into v_plan
  from public.sede s
  join public.empresa e on e.id = s.empresa_id
  left join public.suscripcion_sede ss on ss.sede_id = s.id
  where s.id = p_sede_id;
  v_rank := public.plan_rank(coalesce(v_plan, 'estudio'));

  return coalesce((
    select jsonb_agg(distinct slug)
    from jsonb_array_elements_text(public.get_modulos_activos()) slug
    where public.modulo_min_rank(slug) <= v_rank
  ), '[]'::jsonb);
end $$;
revoke all on function public.modulos_de_sede(uuid) from public;
grant execute on function public.modulos_de_sede(uuid) to authenticated, service_role;

-- Plan efectivo de una sede (para el candado "sube tu plan" en el front).
create or replace function public.plan_de_sede(p_sede_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(ss.plan_slug, e.plan_slug, 'estudio')
  from public.sede s
  join public.empresa e on e.id = s.empresa_id
  left join public.suscripcion_sede ss on ss.sede_id = s.id
  where s.id = p_sede_id and e.id = public.auth_empresa_id();
$$;
revoke all on function public.plan_de_sede(uuid) from public;
grant execute on function public.plan_de_sede(uuid) to authenticated, service_role;
