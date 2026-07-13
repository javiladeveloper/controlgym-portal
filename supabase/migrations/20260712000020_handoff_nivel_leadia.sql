-- Handoff de Leadia al CRM: el conector ahora recibe el NIVEL (caliente/tibio)
-- del bot y lo guarda en el lead. Modelo real: el socio NO chatea en la app —
-- escribe por las redes conectadas en Leadia; el bot atiende, y empuja al CRM
-- de FitCore los que valen (caliente + tibio) como prospectos reales con su
-- etiqueta. Los fríos NO entran (se consultan aparte para la vista "ignorados").
-- Aditivo: p_nivel default 'caliente' → llamadas viejas siguen igual.

alter table public.lead add column if not exists nivel_leadia text
  check (nivel_leadia in ('caliente','tibio','frio'));

CREATE OR REPLACE FUNCTION public.leadia_ingresar_lead(p_secret text, p_empresa_id uuid, p_nombre text, p_telefono text DEFAULT NULL::text, p_canal text DEFAULT 'whatsapp'::text, p_resumen text DEFAULT NULL::text, p_sede_id uuid DEFAULT NULL::uuid, p_nivel text DEFAULT 'caliente'::text)
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
begin
  -- Autenticación por secreto compartido (Hilo es sistema propio, no terceros)
  if p_secret is distinct from (select valor from privado.secreto where clave = 'leadia_ingest_key') then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'sin_nombre');
  end if;

  -- Sede: la indicada o la primera activa de la empresa
  select coalesce(p_sede_id, (select id from public.sede where empresa_id = p_empresa_id and activa order by created_at limit 1))
    into v_sede;
  if v_sede is null or not exists (select 1 from public.sede where id = v_sede and empresa_id = p_empresa_id) then
    return jsonb_build_object('ok', false, 'motivo', 'empresa_o_sede_invalida');
  end if;

  v_fuente := initcap(coalesce(nullif(trim(p_canal), ''), 'whatsapp')) || ' · Leadia';

  -- Dedup: si esa persona ya tiene un lead ABIERTO en la empresa (mismo
  -- teléfono), no se duplica — se anexa el resumen nuevo a la nota.
  if nullif(trim(p_telefono), '') is not null then
    select * into v_existente from public.lead
    where empresa_id = p_empresa_id and deleted_at is null
      and etapa not in ('inscrito', 'perdido')
      -- últimos 9 dígitos: "+51 999 777 111" y "999777111" son la misma persona
      and right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 9)
          = right(regexp_replace(trim(p_telefono), '\D', '', 'g'), 9)
    order by created_at desc limit 1;
    if v_existente.id is not null then
      -- El nivel puede SUBIR si el bot recalifica al contacto (tibio → caliente),
      -- nunca bajar: un lead que ya se calentó no se enfría por un mensaje nuevo.
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

  insert into public.lead (empresa_id, sede_id, nombre, telefono, fuente, etapa, nota, nivel_leadia)
  values (p_empresa_id, v_sede, trim(p_nombre), nullif(trim(p_telefono), ''), v_fuente, 'nuevo', p_resumen, nullif(p_nivel,''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'lead_id', v_id, 'duplicado', false,
    'asignado_a', (select asignado_a from public.lead where id = v_id));
end $function$;