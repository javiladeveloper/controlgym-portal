-- 052: El app para academias/estudios cuesta menos (+S/20, no +S/30):
-- sus alumnos solo ven membresía y reservan clases — sin rutinas ni cámaras.
create or replace function public.precio_plan(p_plan text, p_con_app boolean)
returns numeric
language sql immutable
as $$
  select case p_plan
    when 'trainer' then case when p_con_app then 49 else 29 end
    when 'academia' then case when p_con_app then 69 else 49 end
    when 'ninos' then case when p_con_app then 109 else 69 end
    when 'estudio' then case when p_con_app then 79 else 49 end
    when 'crecimiento' then case when p_con_app then 139 else 99 end
    when 'cadena' then case when p_con_app then 229 else 179 end
  end::numeric
$$;

-- Sincronizar montos de suscripciones no activas que ya eligieron academia+app
update public.suscripcion_plataforma
set monto = public.precio_plan(plan_slug, con_app)
where estado <> 'activa';
