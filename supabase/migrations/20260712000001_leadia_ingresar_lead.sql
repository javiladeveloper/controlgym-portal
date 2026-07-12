-- Conector Leadia (Hilo) → FitCore. ADD-ON FUTURO: sin UI en el panel todavía
-- (Leadia está en construcción), pero el enchufe queda listo y probado.
--
-- Flujo: el gym conecta su WhatsApp/IG en Hilo → la IA califica cada mensaje
-- (frío/tibio/caliente) → SOLO los que valen la pena (handoff) se empujan a
-- FitCore con este RPC → entra como lead fuente "canal · Leadia" y el trigger
-- existente lo asigna al comunicador menos cargado + push. No todos los
-- mensajes pasan a prospecto: ese filtro es exactamente el valor de Leadia.
--
-- Sin función Vercel (estamos al tope de 12 en Hobby): Hilo llama directo a
-- PostgREST — POST /rest/v1/rpc/leadia_ingresar_lead con la apikey ANON y el
-- secreto compartido (privado.secreto 'leadia_ingest_key') en el payload.

create or replace function public.leadia_ingresar_lead(
  p_secret text,
  p_empresa_id uuid,
  p_nombre text,
  p_telefono text default null,
  p_canal text default 'whatsapp',
  p_resumen text default null,
  p_sede_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
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
      update public.lead
        set nota = left(coalesce(nota || E'\n— ', '') || coalesce(p_resumen, 'Nuevo mensaje por ' || v_fuente), 2000)
        where id = v_existente.id;
      return jsonb_build_object('ok', true, 'lead_id', v_existente.id, 'duplicado', true, 'asignado_a', v_existente.asignado_a);
    end if;
  end if;

  insert into public.lead (empresa_id, sede_id, nombre, telefono, fuente, etapa, nota)
  values (p_empresa_id, v_sede, trim(p_nombre), nullif(trim(p_telefono), ''), v_fuente, 'nuevo', p_resumen)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'lead_id', v_id, 'duplicado', false,
    'asignado_a', (select asignado_a from public.lead where id = v_id));
end $$;

revoke all on function public.leadia_ingresar_lead(text, uuid, text, text, text, text, uuid) from public;
grant execute on function public.leadia_ingresar_lead(text, uuid, text, text, text, text, uuid) to anon, authenticated;
