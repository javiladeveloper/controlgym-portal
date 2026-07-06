-- PEDIDOS 13 y 14 (app) — YA APLICADOS en la BD por la sesión de la app vía MCP
-- (archivos originales 20260704000023 / 000024 en el repo de la app). Se
-- versionan aquí, en supabase/migrations de ESTE repo, según el protocolo: el
-- panel es el dueño del banco de migraciones. Definiciones extraídas de la BD
-- viva (fuente de verdad) para que un reset reproduzca el estado actual.
--
-- PEDIDO 13: cancelar_ayuda — el socio cancela en pendiente O en_camino; si un
--   trainer ya iba, se le encola push "❌ Ayuda cancelada".
-- PEDIDO 14: tomar_ayuda + trg_solicitud_ayuda_alta — el push de ayuda incluye
--   empresa_id (deep-link directo al gym en modo staff) y el texto al socio es
--   "💪 <trainer> ya va hacia ti / Quédate donde estás".

-- ── PEDIDO 13: cancelar_ayuda ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_ayuda(p_ayuda_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fila public.solicitud_ayuda;
  v_socio_nombre text;
begin
  -- Cancela si es del socio que llama y sigue activa (pendiente o en_camino).
  update public.solicitud_ayuda
     set estado = 'cancelada', cerrada_at = now()
   where id = p_ayuda_id
     and estado in ('pendiente', 'en_camino')
     and exists (select 1 from public.socio s
                  where s.id = solicitud_ayuda.socio_id and s.usuario_id = auth.uid())
   returning * into v_fila;

  if v_fila.id is null then
    return jsonb_build_object('cancelada', false,
                              'motivo', 'Ya fue atendida o no es tuya');
  end if;

  -- Si un trainer ya la habia tomado, avisarle que el socio la cancelo.
  if v_fila.atendida_por is not null then
    select nombre into v_socio_nombre from public.socio where id = v_fila.socio_id;
    perform public.encolar_push(
      v_fila.atendida_por,
      '❌ Ayuda cancelada',
      coalesce(v_socio_nombre, 'El socio') || ' canceló la ayuda' ||
        coalesce(' de ' || nullif(v_fila.ejercicio_nombre, ''), '') ||
        '. Ya no necesitas ir.',
      jsonb_build_object('tipo', 'ayuda_cancelada', 'ayuda_id', v_fila.id)
    );
  end if;

  return jsonb_build_object('cancelada', true);
end;
$function$

;

-- ── PEDIDO 14: tomar_ayuda ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tomar_ayuda(p_ayuda_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_fila public.solicitud_ayuda;
  v_socio_usuario uuid;
  v_nombre text;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;

  update public.solicitud_ayuda
     set estado = 'en_camino', atendida_por = auth.uid(), tomada_at = now()
   where id = p_ayuda_id and empresa_id = v_empresa and estado = 'pendiente'
   returning * into v_fila;

  if v_fila.id is null then
    return jsonb_build_object('tomada', false, 'motivo', 'Otro ya está atendiendo esta ayuda');
  end if;

  -- Nombre del trainer que toma (auth.uid()) para avisar al socio.
  select s.usuario_id into v_socio_usuario
  from public.socio s where s.id = v_fila.socio_id;
  select coalesce(nullif(trim(nombre), ''), 'Tu entrenador') into v_nombre
  from public.usuario where id = auth.uid();

  if v_socio_usuario is not null then
    perform public.encolar_push(
      v_socio_usuario,
      '💪 ' || v_nombre || ' ya va hacia ti',
      'Te va a ayudar con ' || coalesce(nullif(v_fila.ejercicio_nombre, ''), 'tu ejercicio') ||
        '. Quédate donde estás.',
      jsonb_build_object('tipo', 'solicitud_ayuda_en_camino', 'ayuda_id', v_fila.id,
                         'empresa_id', v_fila.empresa_id)
    );
    perform public.llamar_push_worker();
  end if;

  return jsonb_build_object('tomada', true, 'ayuda_id', v_fila.id, 'socio_id', v_fila.socio_id);
end;
$function$

;

-- ── PEDIDO 14: trigger de alta (empresa_id en el data del push) ───────────
CREATE OR REPLACE FUNCTION public.trg_solicitud_ayuda_alta()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_socio record;
  v_motivo text;
  v_detalle text;
  v_usuario uuid;
  v_hay_presente boolean;
begin
  select nombre, sede_id into v_socio from public.socio where id = new.socio_id;
  v_motivo := case new.motivo
    when 'tecnica' then 'Técnica'
    when 'pr' then 'Récord (PR)'
    when 'maquina' then 'Máquina/equipo'
    else 'Ayuda' end;
  v_detalle := v_motivo
    || coalesce(' en ' || new.ejercicio_nombre, '')
    || coalesce(' · ' || new.ubicacion_texto, '');

  select exists (
    select 1
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id
    join public.asistencia_staff a
      on a.empresa_id = ue.empresa_id and a.usuario_id = ue.usuario_id
    where ue.empresa_id = new.empresa_id and ue.activo and ro.codigo = 'entrenador'
      and a.fecha = (now() at time zone coalesce(
        (select zona_horaria from public.empresa where id = new.empresa_id), 'America/Lima'))::date
      and a.salida_at is null
  ) into v_hay_presente;

  for v_usuario in
    select * from public.staff_disponible(new.empresa_id, array['entrenador'])
  loop
    perform public.encolar_push(
      v_usuario,
      '🆘 ' || v_socio.nombre || ' pide ayuda',
      v_detalle || ' — toca "Voy yo" para atenderlo',
      jsonb_build_object('tipo', 'solicitud_ayuda', 'ayuda_id', new.id,
                         'socio_id', new.socio_id, 'empresa_id', new.empresa_id)
    );
  end loop;

  if not v_hay_presente then
    insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
    values (new.empresa_id, v_socio.sede_id, 'solicitud_ayuda',
            '🆘 ' || v_socio.nombre || ' pide ayuda y no hay trainer presente',
            v_detalle || ' — no hay entrenadores con entrada marcada, apoya desde recepción',
            'warning', 'solicitud_ayuda', new.id);

    for v_usuario in
      select ue.usuario_id
      from public.usuario_empresa ue
      join public.rol ro on ro.id = ue.rol_id
      where ue.empresa_id = new.empresa_id and ue.activo
        and ro.codigo in ('admin', 'recepcion')
    loop
      perform public.encolar_push(
        v_usuario,
        '🆘 ' || v_socio.nombre || ' pide ayuda',
        v_detalle || ' — no hay trainer presente, apoya tú',
        jsonb_build_object('tipo', 'solicitud_ayuda', 'ayuda_id', new.id,
                           'socio_id', new.socio_id, 'empresa_id', new.empresa_id)
      );
    end loop;
  end if;

  perform public.llamar_push_worker();
  return new;
end;
$function$

;
