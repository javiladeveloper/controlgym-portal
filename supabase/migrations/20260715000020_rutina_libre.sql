-- PEDIDO 38 (app): RUTINA LIBRE — cualquier usuario autenticado (con o sin
-- gym) genera y ve una rutina de entrenamiento del catálogo GLOBAL de
-- ejercicios, atada a su cuenta (auth.uid), sin empresa/sede de por medio.
--
-- Esquema: 3 tablas nuevas (rutina_libre, rutina_libre_dia,
-- rutina_libre_ejercicio), todas RLS-aisladas por auth.uid(). Una sola
-- rutina "activa" por usuario a la vez (índice único parcial).
--
-- RPCs:
--   generar_rutina_libre(objetivo, nivel, dias_semana, equipo) -> jsonb
--     Reutiliza el reparto de músculos por día del generador v2 del panel
--     (split empuje/tirón/pierna para ganar_masa/fuerza; full-body A/B/C
--     para el resto), filtra por equipo disponible, guarda la rutina
--     (reemplazando la activa anterior del usuario) y devuelve el detalle
--     completo con el MISMO shape que mi_rutina_detalle.
--   mi_rutina_libre() -> jsonb
--     Devuelve la rutina libre activa del usuario actual con ese shape, o
--     {"rutina_id": null} si no tiene ninguna.

-- ============================================================
-- ESQUEMA
-- ============================================================

create table public.rutina_libre (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid(),
  nombre text,
  objetivo text,
  notas text,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

-- Una sola rutina activa por usuario.
create unique index rutina_libre_usuario_activa_uq
  on public.rutina_libre (usuario_id) where activa;

create index rutina_libre_usuario_idx on public.rutina_libre (usuario_id);

create table public.rutina_libre_dia (
  id uuid primary key default gen_random_uuid(),
  rutina_libre_id uuid not null references public.rutina_libre(id) on delete cascade,
  dia_semana int not null,
  foco text
);

create index rutina_libre_dia_rutina_idx on public.rutina_libre_dia (rutina_libre_id);

create table public.rutina_libre_ejercicio (
  id uuid primary key default gen_random_uuid(),
  rutina_libre_dia_id uuid not null references public.rutina_libre_dia(id) on delete cascade,
  catalogo_id uuid references public.ejercicio_catalogo(id),
  nombre text not null,
  series int,
  reps text,
  descanso text,
  carga text,
  orden int not null default 0,
  notas text
);

create index rutina_libre_ejercicio_dia_idx on public.rutina_libre_ejercicio (rutina_libre_dia_id);

-- ============================================================
-- RLS: cada usuario solo ve/edita lo suyo.
-- ============================================================

alter table public.rutina_libre enable row level security;
alter table public.rutina_libre_dia enable row level security;
alter table public.rutina_libre_ejercicio enable row level security;

create policy rutina_libre_propia on public.rutina_libre
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());

create policy rutina_libre_dia_propia on public.rutina_libre_dia
  for all to authenticated
  using (exists (
    select 1 from public.rutina_libre rl
    where rl.id = rutina_libre_dia.rutina_libre_id and rl.usuario_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.rutina_libre rl
    where rl.id = rutina_libre_dia.rutina_libre_id and rl.usuario_id = auth.uid()
  ));

create policy rutina_libre_ejercicio_propia on public.rutina_libre_ejercicio
  for all to authenticated
  using (exists (
    select 1 from public.rutina_libre_dia d
    join public.rutina_libre rl on rl.id = d.rutina_libre_id
    where d.id = rutina_libre_ejercicio.rutina_libre_dia_id and rl.usuario_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.rutina_libre_dia d
    join public.rutina_libre rl on rl.id = d.rutina_libre_id
    where d.id = rutina_libre_ejercicio.rutina_libre_dia_id and rl.usuario_id = auth.uid()
  ));

grant select, insert, update, delete on public.rutina_libre to authenticated;
grant select, insert, update, delete on public.rutina_libre_dia to authenticated;
grant select, insert, update, delete on public.rutina_libre_ejercicio to authenticated;

-- ============================================================
-- Helper interno: arma el jsonb de una rutina_libre con el MISMO shape
-- que mi_rutina_detalle (rutina_id, nombre, objetivo, notas, dias[]).
-- ============================================================

create or replace function public._rutina_libre_detalle(p_rutina_libre_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with r as (
    select rl.* from public.rutina_libre rl where rl.id = p_rutina_libre_id
  )
  select case when not exists (select 1 from r) then null else
    jsonb_build_object(
      'rutina_id', (select id from r),
      'nombre', (select nombre from r),
      'objetivo', (select objetivo from r),
      'notas', (select notas from r),
      'dias', coalesce((
        select jsonb_agg(dia order by dia->>'dia_semana')
        from (
          select jsonb_build_object(
            'id', d.id,
            'dia_semana', d.dia_semana,
            'foco', d.foco,
            'ejercicios', coalesce((
              select jsonb_agg(ej order by (ej->>'orden')::int)
              from (
                select jsonb_build_object(
                  'id', re.id,
                  'nombre', re.nombre,
                  'series', re.series,
                  'reps', re.reps,
                  'descanso', re.descanso,
                  'carga', re.carga,
                  'orden', re.orden,
                  'notas', re.notas,
                  'video_url', case when c.gif_url is not null and c.gif_url not like '%.gif' then c.gif_url end,
                  'gif_url', case when c.gif_url like '%.gif' then c.gif_url end,
                  'foto_url', c.foto_url,
                  'descripcion', coalesce(c.instrucciones->>'es', c.instrucciones->>'en'),
                  'catalogo_id', c.id,
                  'target', c.target,
                  'body_part', c.body_part,
                  'grupo_muscular', c.grupo_muscular,
                  'secondary', c.secondary,
                  'equipment', c.equipment
                ) as ej
                from public.rutina_libre_ejercicio re
                left join public.ejercicio_catalogo c on c.id = re.catalogo_id
                where re.rutina_libre_dia_id = d.id
              ) x
            ), '[]'::jsonb)
          ) as dia
          from public.rutina_libre_dia d where d.rutina_libre_id = (select id from r)
        ) y
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public._rutina_libre_detalle(uuid) from public;
grant execute on function public._rutina_libre_detalle(uuid) to authenticated, service_role;

-- ============================================================
-- generar_rutina_libre: genera y GUARDA la rutina activa del usuario.
-- ============================================================

create or replace function public.generar_rutina_libre(
  p_objetivo text,
  p_nivel text,
  p_dias_semana int,
  p_equipo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usuario uuid;
  v_rutina uuid;
  v_dia uuid;
  v_series int; v_reps text; v_descanso text;
  v_nombre text;
  v_es_split boolean;
  v_dia_num int;
  v_i int;
  v_foco text;
  v_targets text[];
  v_target text;
  v_j int;
  v_num_targets int;
  v_por_target int;
  v_usados_nombre text[];
  v_usados_id uuid[];
  v_orden int;
  v_equipo_filtro text[];
  rec record;
  rec_ej record;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  if p_dias_semana is null or p_dias_semana < 3 or p_dias_semana > 6 then
    raise exception 'dias_semana debe estar entre 3 y 6';
  end if;

  if not exists (select 1 from public.objetivo_entrenamiento where codigo = p_objetivo) then
    raise exception 'objetivo inválido';
  end if;

  if p_nivel not in ('principiante','intermedio','avanzado') then
    raise exception 'nivel inválido';
  end if;

  -- Mapeo de equipo -> filtro de equipment del catálogo.
  case p_equipo
    when 'peso_corporal' then v_equipo_filtro := array['body weight'];
    when 'mancuernas'    then v_equipo_filtro := array['body weight','dumbbell'];
    when 'gym_completo'  then v_equipo_filtro := null; -- sin filtro: todo
    else raise exception 'equipo inválido';
  end case;

  -- Series/reps/descanso base por objetivo (mismos valores del generador
  -- v2 del panel), luego ajustados por nivel.
  case p_objetivo
    when 'ganar_masa' then v_series:=4; v_reps:='8-12'; v_descanso:='90s';
    when 'fuerza'     then v_series:=5; v_reps:='3-5';  v_descanso:='2-3 min';
    when 'resistencia'then v_series:=3; v_reps:='15-20';v_descanso:='30s';
    when 'bajar_peso' then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    when 'tonificar'  then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    else v_series:=3; v_reps:='10-12'; v_descanso:='60s';
  end case;

  -- Ajuste por nivel: principiante = menos volumen (una serie menos, min 2)
  -- y reps algo más altas para priorizar técnica; avanzado = una serie más;
  -- intermedio = sin cambios (son los valores base por objetivo).
  if p_nivel = 'principiante' then
    v_series := greatest(2, v_series - 1);
    case v_reps
      when '3-5'   then v_reps := '6-8';
      when '8-12'  then v_reps := '10-14';
      when '12-15' then v_reps := '14-18';
      when '15-20' then v_reps := '18-22';
      else v_reps := '12-15';
    end case;
  elsif p_nivel = 'avanzado' then
    v_series := v_series + 1;
  end if;

  v_es_split := p_objetivo in ('ganar_masa', 'fuerza');

  v_nombre := 'Rutina ' || initcap(replace(p_objetivo,'_',' ')) || ' (' || p_dias_semana || ' días)';

  -- Reemplaza la rutina activa anterior del usuario (cascada borra días y
  -- ejercicios) y crea una nueva.
  delete from public.rutina_libre where usuario_id = v_usuario and activa;

  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa)
  values (v_usuario, v_nombre, p_objetivo, true)
  returning id into v_rutina;

  create temporary table if not exists tmp_dias_def_libre (
    orden int,
    foco text,
    targets text[]
  ) on commit drop;
  delete from tmp_dias_def_libre;

  if v_es_split then
    if p_dias_semana >= 6 then
      insert into tmp_dias_def_libre (orden, foco, targets) values
        (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (5, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (6, 'Pierna',                        array['glutes','quads','hamstrings','calves']);
    elsif p_dias_semana = 5 then
      insert into tmp_dias_def_libre (orden, foco, targets) values
        (1, 'Pecho',                         array['pectorals','serratus anterior']),
        (2, 'Espalda',                       array['lats','upper back','traps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Hombro',                        array['delts']),
        (5, 'Brazo',                         array['biceps','triceps','forearms']);
    elsif p_dias_semana = 4 then
      insert into tmp_dias_def_libre (orden, foco, targets) values
        (1, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']),
        (2, 'Tirón (espalda/bíceps)',        array['lats','upper back','biceps']),
        (3, 'Pierna',                        array['glutes','quads','hamstrings','calves']),
        (4, 'Hombro + Brazo',                array['delts','biceps','triceps']);
    else
      for v_i in 1..greatest(p_dias_semana,1) loop
        v_j := 1 + ((v_i - 1) % 3);
        if v_j = 1 then
          insert into tmp_dias_def_libre (orden, foco, targets)
          values (v_i, 'Empuje (pecho/hombro/tríceps)', array['pectorals','delts','triceps']);
        elsif v_j = 2 then
          insert into tmp_dias_def_libre (orden, foco, targets)
          values (v_i, 'Tirón (espalda/bíceps)', array['lats','upper back','biceps']);
        else
          insert into tmp_dias_def_libre (orden, foco, targets)
          values (v_i, 'Pierna', array['glutes','quads','hamstrings','calves']);
        end if;
      end loop;
    end if;
  else
    for v_i in 1..greatest(p_dias_semana,1) loop
      v_j := 1 + ((v_i - 1) % 3);
      if v_j = 1 then
        insert into tmp_dias_def_libre (orden, foco, targets)
        values (v_i, 'Full body A', array['pectorals','lats','quads','glutes','abs']);
      elsif v_j = 2 then
        insert into tmp_dias_def_libre (orden, foco, targets)
        values (v_i, 'Full body B', array['upper back','delts','hamstrings','glutes','abs']);
      else
        insert into tmp_dias_def_libre (orden, foco, targets)
        values (v_i, 'Full body C', array['pectorals','biceps','triceps','quads','abs']);
      end if;
    end loop;
  end if;

  v_dia_num := 0;

  for rec in select orden, foco, targets from tmp_dias_def_libre order by orden loop
    v_foco := rec.foco;
    v_targets := rec.targets;
    v_num_targets := array_length(v_targets, 1);

    v_por_target := greatest(1, (6 / greatest(v_num_targets,1)));

    v_usados_nombre := array[]::text[];
    v_usados_id := array[]::uuid[];

    for v_j in 1..v_num_targets loop
      v_target := v_targets[v_j];

      for rec_ej in
        select c.id, coalesce(c.nombre_es, c.nombre) as nombre
        from public.ejercicio_catalogo c
        where c.activo and c.target = v_target
          and (v_equipo_filtro is null or c.equipment = any (v_equipo_filtro))
          and coalesce(c.nombre_es, c.nombre) <> all (v_usados_nombre)
        order by random()
        limit v_por_target
      loop
        v_usados_nombre := v_usados_nombre || rec_ej.nombre;
        v_usados_id := v_usados_id || rec_ej.id;
      end loop;
    end loop;

    if array_length(v_usados_nombre, 1) is null or array_length(v_usados_nombre, 1) = 0 then
      continue;
    end if;

    v_dia_num := v_dia_num + 1;

    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
    values (v_rutina, v_dia_num, v_foco)
    returning id into v_dia;

    v_orden := 0;
    for v_j in 1..array_length(v_usados_nombre,1) loop
      v_orden := v_orden + 1;
      insert into public.rutina_libre_ejercicio
        (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
      values (v_dia, v_usados_id[v_j], v_usados_nombre[v_j], v_series, v_reps, v_descanso, v_orden);
    end loop;
  end loop;

  drop table if exists tmp_dias_def_libre;

  return public._rutina_libre_detalle(v_rutina);
end;
$function$;

revoke all on function public.generar_rutina_libre(text, text, int, text) from public;
grant execute on function public.generar_rutina_libre(text, text, int, text) to authenticated;

-- ============================================================
-- mi_rutina_libre: devuelve la rutina libre activa del usuario actual.
-- ============================================================

create or replace function public.mi_rutina_libre()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public._rutina_libre_detalle(id) from public.rutina_libre
     where usuario_id = auth.uid() and activa limit 1),
    jsonb_build_object('rutina_id', null)
  );
$$;
revoke all on function public.mi_rutina_libre() from public;
grant execute on function public.mi_rutina_libre() to authenticated, service_role;
