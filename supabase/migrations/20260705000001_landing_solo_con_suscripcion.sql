-- ============================================================================
-- 88 (20260705000001) · La landing pública se apaga sin suscripción vigente
--
-- Hueco de negocio (pedido del cliente): al terminar el trial sin pagar, el
-- panel se bloquea (BloqueoPlan) PERO la landing pública del gym seguía
-- sirviéndose — con su botón de WhatsApp. Alguien podría crear su página
-- gratis, captar clientes por ahí y nunca pagar. Se cierra ese hueco tanto en
-- la landing como en el formulario público de leads.
--
-- Regla (fuente única, helper empresa_tiene_acceso): se permite si
--   · suscripción 'activa', o
--   · 'prueba' con trial_hasta >= hoy, o
--   · sin fila de suscripción (demos/vitrina internos: fitcore, powergym…).
-- Se apaga si: trial vencido, o vencida/cancelada/pendiente_pago.
-- ============================================================================

create or replace function public.empresa_tiene_acceso(p_empresa uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select
       case
         when s.estado = 'activa' then true
         when s.estado = 'prueba' and coalesce(s.trial_hasta, current_date) >= current_date then true
         else false
       end
     from public.suscripcion_plataforma s
     where s.empresa_id = p_empresa
     order by s.created_at desc
     limit 1),
    true
  );
$$;

grant execute on function public.empresa_tiene_acceso(uuid) to anon, authenticated;

-- ── get_landing_by_slug: guard antes de armar el JSON (preserva todo el cuerpo)
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.get_landing_by_slug(text)'::regprocedure);
  if position('empresa_tiene_acceso' in v_def) = 0 then
    v_def := replace(
      v_def,
      E'  select jsonb_build_object(',
      E'  if not public.empresa_tiene_acceso(v_empresa.id) then\n    return null;\n  end if;\n\n  select jsonb_build_object(');
    execute v_def;
  end if;
end $$;

-- ── crear_lead_publico: guard tras validar que la empresa existe ────────────
do $$
declare v_def text; v_reg text;
begin
  for v_reg in
    select p.oid::regprocedure::text
    from pg_proc p
    where p.proname = 'crear_lead_publico' and p.pronamespace = 'public'::regnamespace
  loop
    v_def := pg_get_functiondef(v_reg::regprocedure);
    if position('empresa_tiene_acceso' in v_def) = 0 then
      v_def := replace(
        v_def,
        E'  if v_e is null then\n    raise exception ''Gimnasio no encontrado'';\n  end if;',
        E'  if v_e is null then\n    raise exception ''Gimnasio no encontrado'';\n  end if;\n  if not public.empresa_tiene_acceso(v_e) then\n    raise exception ''Este gimnasio no está activo en este momento'';\n  end if;');
      execute v_def;
    end if;
  end loop;
end $$;

-- Limpieza: había 2 versiones de crear_lead_publico (6 y 7 params) que
-- causaban ambigüedad al llamarla. La app usa la de 7 (con documento);
-- se elimina la vieja de 6.
drop function if exists public.crear_lead_publico(text,text,text,text,text,text);

comment on function public.empresa_tiene_acceso is
  'true si el gym puede operar de cara al público (suscripción activa o trial vigente; sin suscripción = demo interno). Apaga landing/leads al vencer el trial sin pago.';
