-- ============================================================================
-- Receptor de eventos asíncronos de Finny (motor LeadAI → FitCore)
-- ============================================================================
-- El motor manda por /api/chat la respuesta síncrona, pero hay salientes que NO
-- nacen de un request: los seguimientos del cron, la reactivación y los
-- handoffs. Hoy esos mensajes mueren en silencio porque FitCore no tenía dónde
-- recibirlos. Esta RPC es el conector (misma forma que leadia_ingresar_lead:
-- se autentica con el secreto compartido, no con JWT — la llama el motor).
--
-- DÓNDE SE GUARDA (decisión): en `lead_tarea` + `lead.nota`, no en una tabla
-- nueva. La razón es la visibilidad: la "Agenda de seguimiento" del CRM
-- (src/pages/CRM.jsx) está abierta por defecto y lee lead_tarea vía
-- agenda_comercial(); una tarea con vence_at = now() cae en "Hoy"/"Vencidas" y
-- el gimnasio la ve SIN tocar una línea de UI. Una tabla `finny_mensaje` nueva
-- sería más "correcta" en el papel, pero quedaría invisible hasta que alguien
-- construya el panel que la lea — o sea, el mismo silencio que venimos a
-- arreglar. La nota del lead además ya se pinta en la tarjeta del kanban.
--
-- El check de `tipo` de lead_tarea es ('llamada','whatsapp','email','visita'):
-- 'whatsapp' describe exactamente lo que es (Finny atiende el WhatsApp del gym),
-- así que no hay que tocar el constraint ni inventar un tipo nuevo.

-- Dedupe: el motor avisa que la respuesta síncrona de /api/chat puede traer el
-- MISMO texto que el evento asíncrono, y `mensajeId` es lo que desempata.
-- Índice parcial: solo filas con id externo, para no chocar con las tareas que
-- crea el equipo a mano (finny_mensaje_id null).
alter table public.lead_tarea add column if not exists finny_mensaje_id text;

create unique index if not exists lead_tarea_finny_mensaje_id_uq
  on public.lead_tarea (empresa_id, finny_mensaje_id)
  where finny_mensaje_id is not null;

-- Índice para resolver el lead por el id que el motor conoce (leadId de LeadAI).
-- Ya existe lead_leadia_lead_id_uq (unique on empresa_id, leadia_lead_id) que
-- sirve para esta búsqueda, así que no agregamos otro.

create or replace function public.finny_registrar_evento(
  p_secret text,
  p_empresa_id uuid,
  p_tipo text,                       -- 'mensaje' | 'handoff'
  p_texto text default null,
  p_origen text default 'ia',        -- ia | humano | fija | sistema
  p_mensaje_id text default null,
  p_leadia_lead_id text default null,
  p_sujeto text default null,        -- 'prospecto_91': el id de contacto de FitCore
  p_sede_id uuid default null,
  p_nivel text default null,
  p_resumen text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_lead public.lead;
  v_sede uuid;
  v_tarea uuid;
  v_texto text;
  v_detalle text;
  v_sujeto_lead uuid;
begin
  -- Mismo mecanismo que leadia_ingresar_lead: secreto compartido, sin JWT.
  if p_secret is distinct from (select valor from privado.secreto where clave = 'leadia_ingest_key') then
    return jsonb_build_object('ok', false, 'error', 'no_autorizado');
  end if;

  if p_tipo is null or p_tipo not in ('mensaje', 'handoff') then
    return jsonb_build_object('ok', false, 'error', 'tipo_invalido');
  end if;

  -- DEDUPE primero que nada: si este mensajeId ya entró, salimos sin tocar
  -- nada. Se comprueba antes de resolver el lead para que un reintento del
  -- motor no vuelva a anexar la nota ni a mover el nivel.
  if nullif(trim(p_mensaje_id), '') is not null then
    select id into v_tarea from public.lead_tarea
      where empresa_id = p_empresa_id and finny_mensaje_id = trim(p_mensaje_id)
      limit 1;
    if v_tarea is not null then
      return jsonb_build_object('ok', true, 'duplicado', true, 'tarea_id', v_tarea);
    end if;
  end if;

  -- Resolver a qué lead pertenece. Orden de preferencia:
  --   1) leadId de LeadAI (lo que el motor considera la identidad del contacto)
  --   2) el `sujeto` que FitCore mandó en /api/chat, cuando es 'lead_<uuid>' o
  --      un uuid pelado — es el id de nuestro propio lead viajando de vuelta.
  if nullif(trim(p_leadia_lead_id), '') is not null then
    select * into v_lead from public.lead
      where empresa_id = p_empresa_id and leadia_lead_id = trim(p_leadia_lead_id)
      limit 1;
  end if;

  if v_lead.id is null and nullif(trim(p_sujeto), '') is not null then
    -- 'lead_<uuid>' o '<uuid>'. Cualquier otra cosa (prospecto_91, un id de
    -- socio de la app) no resuelve y cae al camino de abajo.
    begin
      v_sujeto_lead := nullif(regexp_replace(trim(p_sujeto), '^lead[_-]', ''), '')::uuid;
    exception when others then
      v_sujeto_lead := null;
    end;
    if v_sujeto_lead is not null then
      select * into v_lead from public.lead
        where empresa_id = p_empresa_id and id = v_sujeto_lead limit 1;
    end if;
  end if;

  -- Sin lead resoluble no hay dónde pintarlo. Devolvemos ok:true igual: para el
  -- motor "entregado" significa que no debe reintentar, y reintentar esto no lo
  -- va a arreglar. El caso normal es un contacto que nunca escaló al CRM (el
  -- lead solo se crea cuando el bot lo califica caliente/tibio).
  if v_lead.id is null then
    return jsonb_build_object('ok', true, 'sin_lead', true);
  end if;

  v_sede := coalesce(p_sede_id, v_lead.sede_id);
  v_texto := left(coalesce(nullif(trim(p_texto), ''), ''), 1000);

  -- El detalle de la tarea es lo que el comunicador lee en la agenda: quién
  -- habló y qué dijo. Un handoff sin texto igual tiene que decir algo.
  if p_tipo = 'handoff' then
    v_detalle := '🤝 Finny pide que lo tomes tú' ||
                 case when v_texto <> '' then ': ' || v_texto else '' end;
  else
    v_detalle := case coalesce(nullif(trim(p_origen), ''), 'ia')
                   when 'humano' then '👤 '
                   when 'sistema' then '⚙️ '
                   else '🤖 Finny: ' end || v_texto;
  end if;

  -- La tarea: vence AHORA para que caiga en "Hoy" de la agenda, y se asigna a
  -- quien ya lleva el lead (si no hay nadie, queda sin asignar y la ve
  -- admin/recepción — el comunicador solo ve las suyas).
  -- on conflict do nothing + returning: el select de arriba es la ruta rápida,
  -- pero la garantía DURA contra la ráfaga (el motor reintentando mientras la
  -- primera entrega todavía no commiteó) es este índice único. Si otra sesión
  -- ganó, el insert no devuelve fila y salimos como duplicado SIN tocar la nota.
  insert into public.lead_tarea (empresa_id, lead_id, tipo, detalle, vence_at, asignado_a, finny_mensaje_id)
  values (p_empresa_id, v_lead.id, 'whatsapp', left(v_detalle, 500), now(), v_lead.asignado_a,
          nullif(trim(p_mensaje_id), ''))
  on conflict (empresa_id, finny_mensaje_id) where finny_mensaje_id is not null do nothing
  returning id into v_tarea;

  if v_tarea is null then
    return jsonb_build_object('ok', true, 'duplicado', true);
  end if;

  -- Y la nota del lead, que es lo que se ve en la tarjeta del kanban sin abrir
  -- nada. Mismo formato de anexado que usa leadia_ingresar_lead.
  update public.lead
    set nota = left(coalesce(nota || E'\n— ', '') || coalesce(nullif(trim(p_resumen), ''), v_detalle), 2000),
        nivel_leadia = case
          when p_nivel = 'caliente' then 'caliente'
          when p_nivel = 'tibio' and coalesce(nivel_leadia, '') <> 'caliente' then 'tibio'
          else nivel_leadia end,
        sede_id = coalesce(sede_id, v_sede)
    where id = v_lead.id;

  return jsonb_build_object('ok', true, 'duplicado', false, 'tarea_id', v_tarea, 'lead_id', v_lead.id);
end $function$;

-- Como leadia_ingresar_lead: el secreto es la autenticación, pero igual
-- cerramos a public/anon. La serverless entra con service_role.
revoke all on function public.finny_registrar_evento(text, uuid, text, text, text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finny_registrar_evento(text, uuid, text, text, text, text, text, text, uuid, text, text) to service_role;

comment on function public.finny_registrar_evento(text, uuid, text, text, text, text, text, text, uuid, text, text) is
  'Recibe un evento asíncrono del motor de Finny (seguimiento del cron, reactivación, handoff) y lo deja visible en la agenda del CRM. Dedupe por mensajeId.';
