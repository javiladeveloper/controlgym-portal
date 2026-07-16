-- Cada gimnasio elige en qué unidades ve/ingresa el PESO CORPORAL (kg o
-- libras) y la TALLA (metros o pies) del socio. Solo afecta presentación:
-- la BD sigue guardando SIEMPRE en métrico (socio.peso_kg, socio.talla_m).
--
-- El panel lee estas columnas directo de `empresa` vía get_bootstrap(), que
-- ya expone la fila completa como to_jsonb(e) — no requiere tocar esa RPC.
alter table public.empresa add column if not exists unidad_peso text not null default 'kg' check (unidad_peso in ('kg','lb'));
alter table public.empresa add column if not exists unidad_talla text not null default 'm' check (unidad_talla in ('m','ft'));

-- get_mi_app_bootstrap (app del socio) arma el objeto 'empresa' a mano con
-- jsonb_build_object (no to_jsonb), así que sí hay que añadir los 2 campos
-- explícitamente. Cambio quirúrgico vía pg_get_functiondef + replace,
-- mismo patrón usado en 20260711000020_bootstrap_expone_fecha_nacimiento.sql,
-- para no reescribir a mano toda la función y arriesgar un desfase.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname='get_mi_app_bootstrap' and pronamespace='public'::regnamespace;
  if v_def is null then return; end if;
  if v_def ilike '%''unidad_peso'', e.unidad_peso%' then return; end if;  -- ya está
  v_new := replace(v_def,
    '''croquis_url'', (select se.croquis_url from public.sede se where se.id = s.sede_id))',
    '''croquis_url'', (select se.croquis_url from public.sede se where se.id = s.sede_id),
                      ''unidad_peso'', e.unidad_peso, ''unidad_talla'', e.unidad_talla)');
  if v_new <> v_def then execute v_new; end if;
end $$;
