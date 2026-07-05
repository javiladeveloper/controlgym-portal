-- ============================================================================
-- 75 (20260704000004) · Límites de socios v2 (decisión comercial)
-- Estudio: hasta 100 socios ACTIVOS · Crecimiento y Cadena: ilimitados.
-- El diferenciador entre Crecimiento y Cadena pasa a ser el número de
-- sedes (3 vs ilimitadas) y las capacidades, no el conteo de socios.
-- ============================================================================

create or replace function public.limite_socios_plan(p_plan text)
returns int language sql immutable as $$
  select case p_plan when 'estudio' then 100 else null end
$$;

comment on function public.limite_socios_plan(text) is
  'Tope de socios ACTIVOS: estudio 100; crecimiento/cadena/segmentos ilimitado.';
