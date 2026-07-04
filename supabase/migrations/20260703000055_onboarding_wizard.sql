-- 055: Asistente de bienvenida — arma el negocio con las respuestas del dueño.
-- Reemplaza los datos seed genéricos por LOS SUYOS: disciplinas (con horario
-- ejemplo), planes con sus precios reales, contacto/ubicación, sedes extra
-- (cadenas) y color de marca. Todo editable después desde el panel.
create or replace function public.aplicar_onboarding(p_empresa_id uuid, p_config jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sede uuid;
  d jsonb;
  p jsonb;
  s text;
  v_tipo uuid;
  v_rn int := 0;
  v_orden int := 0;
  v_nueva uuid;
  -- Distribución del horario de ejemplo: días y horas rotativas
  v_dias int[] := array[1, 3, 5, 2, 4, 6];
  v_horas time[] := array['19:00', '18:00', '07:00', '20:00', '09:30', '17:00'];
begin
  if not exists (
    select 1
    from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id
    where ue.usuario_id = v_uid and ue.empresa_id = p_empresa_id and r.codigo = 'admin'
  ) then
    raise exception 'Solo un administrador del negocio puede configurarlo';
  end if;

  select id into v_sede from public.sede
  where empresa_id = p_empresa_id and deleted_at is null
  order by created_at limit 1;

  -- ── Disciplinas/servicios elegidos (reemplazan a los del seed) ──
  if jsonb_array_length(coalesce(p_config->'disciplinas', '[]'::jsonb)) > 0 then
    delete from public.clase where empresa_id = p_empresa_id;
    delete from public.plan_acceso_clase where empresa_id = p_empresa_id;
    delete from public.tipo_clase where empresa_id = p_empresa_id;

    for d in select * from jsonb_array_elements(p_config->'disciplinas') loop
      insert into public.tipo_clase (empresa_id, nombre, color, acceso_libre)
      values (p_empresa_id, d->>'nombre', coalesce(d->>'color', '#FF6B35'),
              coalesce((d->>'acceso_libre')::boolean, false))
      returning id into v_tipo;

      -- Las áreas de acceso libre no llevan horario; el resto recibe 2 clases
      -- de ejemplo repartidas en la semana (el gym las edita después).
      if not coalesce((d->>'acceso_libre')::boolean, false) then
        v_rn := v_rn + 1;
        insert into public.clase (empresa_id, sede_id, tipo_clase_id, nombre, dia_semana, hora, duracion_min, cupo_max, activa)
        values
          (p_empresa_id, v_sede, v_tipo, d->>'nombre',
           v_dias[1 + ((v_rn - 1) % 6)], v_horas[1 + ((v_rn - 1) % 6)], 60, 15, true),
          (p_empresa_id, v_sede, v_tipo, d->>'nombre',
           v_dias[1 + ((v_rn + 2) % 6)], v_horas[1 + ((v_rn + 1) % 6)], 60, 15, true);
      end if;
    end loop;
  end if;

  -- ── Planes con los precios reales del negocio ──
  if jsonb_array_length(coalesce(p_config->'planes', '[]'::jsonb)) > 0 then
    update public.plan set deleted_at = now(), activo = false
    where empresa_id = p_empresa_id and deleted_at is null;

    for p in select * from jsonb_array_elements(p_config->'planes') loop
      v_orden := v_orden + 1;
      insert into public.plan (empresa_id, nombre, precio, unidad, descripcion,
                               cobra_matricula, precio_matricula,
                               dias_congelamiento_anio, incluye_clases, incluye_rutina, orden, badge)
      values (p_empresa_id, p->>'nombre', (p->>'precio')::numeric,
              coalesce(nullif(p->>'unidad', ''), 'mes'),
              nullif(p->>'descripcion', ''),
              coalesce((p->>'matricula')::numeric, 0) > 0,
              coalesce((p->>'matricula')::numeric, 0),
              coalesce((p->>'congela')::int, 0),
              true, true, v_orden,
              case when coalesce((p->>'popular')::boolean, false) then 'MAS POPULAR' end);
    end loop;
  end if;

  -- Matriz de acceso: todos los planes acceden a todo (ajustable en Clases)
  insert into public.plan_acceso_clase (empresa_id, plan_id, tipo_clase_id, incluido)
  select p_empresa_id, pl.id, tc.id, true
  from public.plan pl
  cross join public.tipo_clase tc
  where pl.empresa_id = p_empresa_id and pl.deleted_at is null
    and tc.empresa_id = p_empresa_id
  on conflict (plan_id, tipo_clase_id) do update set incluido = true;

  -- ── Contacto y ubicación ──
  update public.empresa set
    horario_atencion = coalesce(nullif(p_config->>'horario', ''), horario_atencion),
    direccion = coalesce(nullif(p_config->>'direccion', ''), direccion),
    telefono_contacto = coalesce(nullif(p_config->>'whatsapp', ''), telefono_contacto),
    redes = case when nullif(p_config->>'whatsapp', '') is not null
                 then coalesce(redes, '{}'::jsonb) || jsonb_build_object('whatsapp', p_config->>'whatsapp')
                 else redes end,
    landing = case when p_config->'ubicacion' is not null
                   then coalesce(landing, '{}'::jsonb) || jsonb_build_object('ubicacion', p_config->'ubicacion')
                   else landing end
  where id = p_empresa_id;

  -- ── Sedes adicionales (cadenas) ──
  for s in select value from jsonb_array_elements_text(coalesce(p_config->'sedes', '[]'::jsonb)) loop
    if coalesce(trim(s), '') <> '' then
      insert into public.sede (empresa_id, nombre, activa)
      values (p_empresa_id, trim(s), true)
      returning id into v_nueva;
      insert into public.usuario_sede (usuario_id, empresa_id, sede_id)
      values (v_uid, p_empresa_id, v_nueva)
      on conflict do nothing;
    end if;
  end loop;

  -- ── Color de marca ──
  if nullif(p_config->>'color', '') is not null then
    update public.empresa_tema
    set color_primary = p_config->>'color',
        color_primary_hover = p_config->>'color'
    where empresa_id = p_empresa_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.aplicar_onboarding(uuid, jsonb) to authenticated;
