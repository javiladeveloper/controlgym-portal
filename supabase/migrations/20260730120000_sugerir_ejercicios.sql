-- BLOQUE 3 (spec 2026-07-30 entrenamiento completo app): sugerencias de
-- ejercicios mientras el usuario arma su rutina libre. Dado un día
-- (rutina_libre_dia), sugiere ejercicios del catálogo cuyo target/músculo
-- coincide con el 'foco' textual del día (español libre), excluyendo los
-- ya agregados en ese día. Si el foco no matchea ningún músculo conocido
-- (ej. "Día 1" genérico), cae a sugerencias por el objetivo del socio (si
-- lo tiene) o, en último caso, variedad general activa.
--
-- Reusa la misma taxonomía target/body_part que generar_rutina_libre
-- (20260730110000) y el mismo shape jsonb que buscar_ejercicios_catalogo
-- (20260714000002): {id, nombre, grupo_muscular, target, body_part,
-- equipment, gif_url, foto_url}.

create or replace function public.sugerir_ejercicios_para_dia(p_dia_id uuid, p_limit int default 8)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
  v_foco text;
  v_foco_norm text;
  v_targets text[];
  v_objetivo_codigo text;
  v_limit int;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    return;
  end if;

  v_limit := least(greatest(coalesce(p_limit, 8), 1), 30);

  -- Valida que el día pertenece a una rutina_libre del usuario actual.
  select rl.id, d.foco into v_rutina, v_foco
  from public.rutina_libre_dia d
  join public.rutina_libre rl on rl.id = d.rutina_libre_id
  where d.id = p_dia_id and rl.usuario_id = v_usuario;

  if v_rutina is null then
    return;
  end if;

  -- Normaliza: minúsculas y sin tildes (el foco es texto libre en español,
  -- ej. "Glúteos", "Tirón (espalda/bíceps)"); translate() evita depender de
  -- la extensión unaccent (no instalada en esta base).
  v_foco_norm := translate(
    lower(trim(coalesce(v_foco, ''))),
    'áéíóúüñ', 'aeiouun'
  );

  -- Mapeo foco (texto libre en español, ya sin tildes) -> target(s) del
  -- catálogo, misma taxonomía usada por generar_rutina_libre.
  v_targets := case
    when v_foco_norm ilike '%glute%' then array['glutes']
    when v_foco_norm ilike '%pecho%' or v_foco_norm ilike '%pectoral%' then array['pectorals']
    when v_foco_norm ilike '%espalda%' then array['lats','upper back']
    when v_foco_norm ilike '%pierna%' then array['quads','hamstrings','glutes','calves']
    when v_foco_norm ilike '%hombro%' then array['delts']
    when v_foco_norm ilike '%brazo%' then array['biceps','triceps']
    when v_foco_norm ilike '%bicep%' then array['biceps']
    when v_foco_norm ilike '%tricep%' then array['triceps']
    when v_foco_norm ilike '%core%' or v_foco_norm ilike '%abdomen%' or v_foco_norm ilike '%abdominal%' then array['abs']
    when v_foco_norm ilike '%pantorrilla%' or v_foco_norm ilike '%gemelo%' then array['calves']
    when v_foco_norm ilike '%antebrazo%' then array['forearms']
    when v_foco_norm ilike '%empuje%' then array['pectorals','delts','triceps']
    when v_foco_norm ilike '%tiron%' then array['lats','upper back','biceps']
    when v_foco_norm ilike '%full body%' or v_foco_norm ilike '%fullbody%' or v_foco_norm ilike '%full_body%'
      then array['pectorals','lats','quads','glutes','abs']
    else null
  end;

  -- Foco genérico (no matcheó ningún músculo, ej. "Día 1"): cae al
  -- objetivo del socio (si el usuario tiene socio con objetivo asignado).
  if v_targets is null then
    select oe.codigo into v_objetivo_codigo
    from public.socio s
    join public.objetivo_entrenamiento oe on oe.id = s.objetivo_id
    where s.usuario_id = v_usuario
    order by s.created_at desc
    limit 1;

    v_targets := case v_objetivo_codigo
      when 'ganar_masa' then array['pectorals','lats','quads','glutes','delts','biceps','triceps']
      when 'fuerza'     then array['pectorals','lats','quads','glutes','delts']
      when 'resistencia'then array['quads','hamstrings','calves','abs','cardiovascular system']
      when 'bajar_peso' then array['quads','glutes','abs','cardiovascular system']
      when 'tonificar'  then array['glutes','abs','delts','triceps']
      else null -- sin objetivo: variedad general (sin filtro de target)
    end;
  end if;

  return query
  select jsonb_build_object(
    'id', c.id,
    'nombre', coalesce(c.nombre_es, c.nombre),
    'grupo_muscular', c.grupo_muscular,
    'target', c.target,
    'body_part', c.body_part,
    'equipment', c.equipment,
    'gif_url', c.gif_url,
    'foto_url', c.foto_url
  )
  from public.ejercicio_catalogo c
  where c.activo
    and (v_targets is null or c.target = any (v_targets))
    and not exists (
      select 1 from public.rutina_libre_ejercicio re
      where re.rutina_libre_dia_id = p_dia_id and re.catalogo_id = c.id
    )
  order by random()
  limit v_limit;
end;
$function$;

revoke all on function public.sugerir_ejercicios_para_dia(uuid, int) from public;
grant execute on function public.sugerir_ejercicios_para_dia(uuid, int) to authenticated, service_role;
