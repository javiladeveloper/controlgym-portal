-- ============================================================================
-- 80 (20260704000011) · Nuevo socio → avisar al staff que arma su plan
-- Al inscribirse un socio:
--   · campanita del panel (tabla notificacion): "💪 Nuevo socio: X — créale
--     su rutina y plan de alimentación"
--   · push en la app a los ENTRENADORES y NUTRICIONISTAS del gym que tengan
--     la app instalada (via push_cola → worker FCM)
-- Las importaciones masivas NO notifican (flag de sesión 'fitcontrol.bulk').
-- ============================================================================

create or replace function public.trg_notificar_nuevo_socio()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Importador masivo: sin spam de 500 notificaciones
  if coalesce(current_setting('fitcontrol.bulk', true), '') = 'on' then
    return new;
  end if;

  -- Campanita del panel
  insert into public.notificacion (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
  values (new.empresa_id, new.sede_id, 'nuevo_socio',
          '💪 Nuevo socio: ' || new.nombre,
          'Créale su rutina y plan de alimentación en Rutinas y dietas',
          'info', 'socio', new.id);

  -- Push a los especialistas del gym con la app instalada
  for r in
    select ue.usuario_id
    from public.usuario_empresa ue
    join public.rol ro on ro.id = ue.rol_id
    where ue.empresa_id = new.empresa_id and ue.activo
      and ro.codigo in ('entrenador', 'nutricionista')
  loop
    perform public.encolar_push(
      r.usuario_id,
      '💪 Nuevo socio: ' || new.nombre,
      'Se acaba de inscribir — créale su rutina y plan de alimentación',
      jsonb_build_object('tipo', 'nuevo_socio', 'socio_id', new.id)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_socio_notificar_staff on public.socio;
create trigger trg_socio_notificar_staff
  after insert on public.socio
  for each row execute function public.trg_notificar_nuevo_socio();

-- El importador marca el flag de lote para no disparar 500 avisos
-- (redefinición de importar_socios solo agrega el set_config inicial)
create or replace function public.importar_socios(p_sede_id uuid, p_socios jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public
as $$
declare
  v_empresa uuid;
  r jsonb;
  v_cod int;
  v_socio uuid;
  v_plan public.plan;
  v_vence date;
  v_importados int := 0;
  v_saltados int := 0;
  v_sin_plan int := 0;
  v_errores text[] := '{}';
begin
  perform set_config('fitcontrol.bulk', 'on', true); -- local a la transacción

  select empresa_id into v_empresa from public.sede where id = p_sede_id;
  if v_empresa is null then raise exception 'Sede no encontrada'; end if;
  if p_socios is null or jsonb_array_length(p_socios) = 0 then
    raise exception 'No hay filas para importar';
  end if;
  if jsonb_array_length(p_socios) > 500 then
    raise exception 'Máximo 500 socios por importación (divide tu archivo)';
  end if;

  for r in select * from jsonb_array_elements(p_socios)
  loop
    begin
      if coalesce(trim(r->>'nombre'), '') = '' then
        v_saltados := v_saltados + 1;
        continue;
      end if;

      if exists (
        select 1 from public.socio s
        where s.empresa_id = v_empresa and s.deleted_at is null
          and ((nullif(trim(r->>'documento'),'') is not null and s.documento = trim(r->>'documento'))
            or (lower(s.nombre) = lower(trim(r->>'nombre'))
                and coalesce(s.telefono,'') = coalesce(nullif(trim(r->>'telefono'),''), coalesce(s.telefono,''))))
      ) then
        v_saltados := v_saltados + 1;
        continue;
      end if;

      select coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), '')::int), 0) + 1 into v_cod
      from public.socio where empresa_id = v_empresa;

      insert into public.socio (empresa_id, sede_id, codigo, nombre, telefono, email, documento, estado, created_by)
      values (v_empresa, p_sede_id, lpad(v_cod::text, 4, '0'), trim(r->>'nombre'),
              nullif(trim(r->>'telefono'),''), nullif(trim(r->>'email'),''),
              nullif(trim(r->>'documento'),''), 'activo', auth.uid())
      returning id into v_socio;

      v_plan := null;
      if coalesce(trim(r->>'plan'), '') <> '' then
        select * into v_plan from public.plan
         where empresa_id = v_empresa and deleted_at is null and nombre ilike trim(r->>'plan')
         limit 1;
      end if;

      if v_plan.id is not null then
        v_vence := nullif(trim(r->>'vence'), '')::date;
        if v_vence is null then v_vence := current_date + interval '1 month'; end if;

        insert into public.membresia (empresa_id, sede_id, socio_id, plan_id, fecha_inicio, fecha_fin, estado, precio_pagado, monto_pagado)
        values (v_empresa, p_sede_id, v_socio, v_plan.id,
                v_vence - interval '1 month', v_vence,
                case when v_vence < current_date then 'vencida' else 'activa' end,
                v_plan.precio, v_plan.precio);
      else
        v_sin_plan := v_sin_plan + 1;
      end if;

      v_importados := v_importados + 1;
    exception when others then
      v_errores := v_errores || (coalesce(trim(r->>'nombre'), '(sin nombre)') || ': ' || SQLERRM);
      if array_length(v_errores, 1) >= 10 then
        exit;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'importados', v_importados, 'saltados', v_saltados,
    'sin_plan', v_sin_plan, 'errores', to_jsonb(v_errores)
  );
end;
$$;
