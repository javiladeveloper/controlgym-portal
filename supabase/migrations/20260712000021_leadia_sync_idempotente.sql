-- Sync PULL de Leadia → CRM. El modelo es pull (FitCore consume, Leadia no
-- empuja): cuando el admin abre el CRM, una serverless trae de Leadia los
-- calientes+tibios (GET /leads?nivel=...) y los ingresa con este conector.
--
-- Problema que resuelve esta migración: el dedup viejo solo funcionaba por
-- teléfono. Un lead de Instagram/Facebook NO tiene teléfono (su contacto es un
-- id de canal), así que un sync repetido lo DUPLICARÍA. Solución: guardar el id
-- del lead en Leadia (leadia_lead_id) y deduplicar por él para cualquier canal.
-- Además: el sync puede traer leads anónimos (sin nombre) — se permite un
-- nombre genérico SOLO cuando viene un leadia_lead_id (es decir, del sync),
-- para no relajar el conector para llamadas manuales.

alter table public.lead add column if not exists leadia_lead_id text;

-- Idempotencia: un lead de Leadia entra UNA vez por empresa. Índice parcial
-- (solo filas con id externo) para no chocar con los leads manuales (null).
create unique index if not exists lead_leadia_lead_id_uq
  on public.lead (empresa_id, leadia_lead_id)
  where leadia_lead_id is not null;

-- Quitamos las sobrecargas anteriores (7 y 8 args) para dejar UNA sola firma
-- canónica (9 args); si no, una llamada posicional queda ambigua entre ellas.
drop function if exists public.leadia_ingresar_lead(text, uuid, text, text, text, text, uuid);
drop function if exists public.leadia_ingresar_lead(text, uuid, text, text, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.leadia_ingresar_lead(
  p_secret text,
  p_empresa_id uuid,
  p_nombre text,
  p_telefono text DEFAULT NULL::text,
  p_canal text DEFAULT 'whatsapp'::text,
  p_resumen text DEFAULT NULL::text,
  p_sede_id uuid DEFAULT NULL::uuid,
  p_nivel text DEFAULT 'caliente'::text,
  p_leadia_lead_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sede uuid;
  v_fuente text;
  v_existente public.lead;
  v_id uuid;
  v_nombre text;
begin
  -- Autenticación por secreto compartido (Hilo es sistema propio, no terceros)
  if p_secret is distinct from (select valor from privado.secreto where clave = 'leadia_ingest_key') then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  -- Nombre: normalmente obligatorio. Excepción: el sync (trae leadia_lead_id)
  -- puede ingresar un contacto anónimo con nombre genérico por canal, para no
  -- perder un caliente/tibio real que aún no dio su nombre.
  v_nombre := nullif(trim(p_nombre), '');
  if v_nombre is null then
    if nullif(trim(p_leadia_lead_id), '') is not null then
      v_nombre := 'Contacto ' || initcap(coalesce(nullif(trim(p_canal), ''), 'WhatsApp'));
    else
      return jsonb_build_object('ok', false, 'motivo', 'sin_nombre');
    end if;
  end if;

  -- Sede: la indicada o la primera activa de la empresa
  select coalesce(p_sede_id, (select id from public.sede where empresa_id = p_empresa_id and activa order by created_at limit 1))
    into v_sede;
  if v_sede is null or not exists (select 1 from public.sede where id = v_sede and empresa_id = p_empresa_id) then
    return jsonb_build_object('ok', false, 'motivo', 'empresa_o_sede_invalida');
  end if;

  v_fuente := initcap(coalesce(nullif(trim(p_canal), ''), 'whatsapp')) || ' · Leadia';

  -- Dedup 1 (preferente): por el id del lead en Leadia. Sirve para CUALQUIER
  -- canal (incl. IG/FB sin teléfono) y hace el sync idempotente. Si ya existe,
  -- actualiza el nivel (sube, no baja) y anexa el resumen. No reabre terminales.
  if nullif(trim(p_leadia_lead_id), '') is not null then
    select * into v_existente from public.lead
      where empresa_id = p_empresa_id and leadia_lead_id = trim(p_leadia_lead_id)
      limit 1;
    if v_existente.id is not null then
      update public.lead
        set nota = left(coalesce(nota || E'\n— ', '') || coalesce(p_resumen, 'Nuevo mensaje por ' || v_fuente), 2000),
            nivel_leadia = case
              when p_nivel = 'caliente' then 'caliente'
              when p_nivel = 'tibio' and coalesce(nivel_leadia, '') <> 'caliente' then 'tibio'
              else nivel_leadia end
        where id = v_existente.id;
      return jsonb_build_object('ok', true, 'lead_id', v_existente.id, 'duplicado', true, 'asignado_a', v_existente.asignado_a);
    end if;
  end if;

  -- Dedup 2: por teléfono, si esa persona ya tiene un lead ABIERTO en la
  -- empresa. Se conserva para llamadas sin id externo y para casar un lead
  -- manual con el mismo teléfono.
  if nullif(trim(p_telefono), '') is not null then
    select * into v_existente from public.lead
    where empresa_id = p_empresa_id and deleted_at is null
      and etapa not in ('inscrito', 'perdido')
      -- últimos 9 dígitos: "+51 999 777 111" y "999777111" son la misma persona
      and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 9)
          = right(regexp_replace(trim(p_telefono), '\D', '', 'g'), 9)
    order by created_at desc limit 1;
    if v_existente.id is not null then
      update public.lead
        set nota = left(coalesce(nota || E'\n— ', '') || coalesce(p_resumen, 'Nuevo mensaje por ' || v_fuente), 2000),
            nivel_leadia = case
              when p_nivel = 'caliente' then 'caliente'
              when p_nivel = 'tibio' and coalesce(nivel_leadia, '') <> 'caliente' then 'tibio'
              else nivel_leadia end,
            -- si el lead manual aún no tenía id externo, lo casa con este
            leadia_lead_id = coalesce(leadia_lead_id, nullif(trim(p_leadia_lead_id), ''))
        where id = v_existente.id;
      return jsonb_build_object('ok', true, 'lead_id', v_existente.id, 'duplicado', true, 'asignado_a', v_existente.asignado_a);
    end if;
  end if;

  insert into public.lead (empresa_id, sede_id, nombre, telefono, fuente, etapa, nota, nivel_leadia, leadia_lead_id)
  values (p_empresa_id, v_sede, v_nombre, nullif(trim(p_telefono), ''), v_fuente, 'nuevo', p_resumen,
          nullif(p_nivel,''), nullif(trim(p_leadia_lead_id), ''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'lead_id', v_id, 'duplicado', false,
    'asignado_a', (select asignado_a from public.lead where id = v_id));
end $function$;

-- La firma vieja (8 args) y la de 7 conviven; aseguramos grants en la nueva (9).
revoke all on function public.leadia_ingresar_lead(text, uuid, text, text, text, text, uuid, text, text) from public;
grant execute on function public.leadia_ingresar_lead(text, uuid, text, text, text, text, uuid, text, text) to anon, authenticated, service_role;
