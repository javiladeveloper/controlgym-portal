-- Agrega 'fecha_nacimiento' al objeto socio del bootstrap del socio
-- (get_mi_app_bootstrap), para que la app muestre el cumpleaños que el socio
-- edita en su perfil. Cambio QUIRÚRGICO: solo se añadió ese campo al
-- jsonb_build_object del socio, sin tocar el resto de la RPC.
--
-- ⚠️ NOTA PARA EL PANEL: esta es la RPC principal del bootstrap. Fue modificada
-- desde la sesión de la app vía MCP (2026-07-11) SOLO para exponer fecha_nacimiento.
-- Si el panel regenera get_mi_app_bootstrap, conservar este campo en el objeto socio:
--   'fecha_nacimiento', s.fecha_nacimiento
-- Esta migración deja el cambio aplicado; regenera la función con el campo incluido
-- usando el mismo replace idempotente por si el orden de migraciones lo requiere.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname='get_mi_app_bootstrap' and pronamespace='public'::regnamespace;
  if v_def is null then return; end if;
  if v_def ilike '%''fecha_nacimiento'', s.fecha_nacimiento%' then return; end if;  -- ya está
  v_new := replace(v_def,
    '''foto_url'', s.foto_url, ''foto_estado'', s.foto_estado)',
    '''foto_url'', s.foto_url, ''foto_estado'', s.foto_estado, ''fecha_nacimiento'', s.fecha_nacimiento)');
  if v_new <> v_def then execute v_new; end if;
end $$;
