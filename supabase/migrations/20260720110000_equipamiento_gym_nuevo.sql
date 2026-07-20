-- Equipamiento por defecto al crear un gimnasio.
--
-- PROBLEMA (auditoría del flujo de alta, 2026-07-20): el generador de rutinas
-- filtra los ejercicios por el equipo que la sede tiene cargado (equipo_de_sede).
-- Un gym recién creado tenía 0 máquinas, así que solo podía usar ejercicios de
-- peso corporal: **325 de 1.369 (24%)**, sin mancuernas (294), poleas (157) ni
-- barras (154). El dueño probaba "Generar plantilla" el primer día, veía rutinas
-- de flexiones y sentadillas sin peso, y concluía que la herramienta era floja —
-- cuando solo faltaba un dato que nadie le pidió.
--
-- SOLUCIÓN: sembrar el equipo típico al registrar (para que funcione sin que
-- nadie configure nada) + dejar que el onboarding lo ajuste.
-- Medido tras el cambio: de 325 a 1.241 ejercicios disponibles (24% → 91%).

-- Siembra el equipamiento típico de un gimnasio en una sede. Idempotente.
-- Si p_equipos es null siembra todo; si trae una lista, solo esos.
create or replace function public.sembrar_equipamiento_sede(
  p_sede_id uuid, p_equipos text[] default null)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_emp uuid;
  v_n int := 0;
  -- nombre visible → equipment del catálogo (ejercicio_catalogo.equipment)
  v_todo text[][] := array[
    ['Mancuernas',            'dumbbell'],
    ['Barra olímpica',        'barbell'],
    ['Barra Z',               'ez barbell'],
    ['Poleas / cables',       'cable'],
    ['Máquinas de placa',     'leverage machine'],
    ['Multipower (Smith)',    'smith machine'],
    ['Kettlebells',           'kettlebell'],
    ['Bandas elásticas',      'band'],
    ['Pelota de estabilidad', 'stability ball'],
    ['Banco / colchoneta',    'weighted']
  ];
  i int;
  v_nombre text;
  v_equip text;
begin
  select empresa_id into v_emp from public.sede where id = p_sede_id and deleted_at is null;
  if v_emp is null then raise exception 'sede no encontrada'; end if;

  for i in 1..array_length(v_todo, 1) loop
    v_nombre := v_todo[i][1];
    v_equip  := v_todo[i][2];

    continue when p_equipos is not null and not (v_equip = any(p_equipos));

    -- idempotente: no duplica si ya existe ese equipamiento activo en la sede
    if not exists (
      select 1 from public.maquina m
      where m.sede_id = p_sede_id and m.equipment = v_equip and m.deleted_at is null
    ) then
      insert into public.maquina (empresa_id, sede_id, nombre, zona, unidades, estado, equipment)
      values (v_emp, p_sede_id, v_nombre, 'Sala principal', 1, 'operativa', v_equip);
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end $$;

revoke all on function public.sembrar_equipamiento_sede(uuid, text[]) from public, authenticated;
grant execute on function public.sembrar_equipamiento_sede(uuid, text[]) to authenticated;

-- Ajusta el equipamiento desde el onboarding: agrega lo marcado, da de baja lo
-- destildado. Solo toca lo SEMBRADO por nosotros (zona 'Sala principal' y sin
-- serie): nunca borra inventario que el gym cargó a mano.
create or replace function public.ajustar_equipamiento_empresa(
  p_empresa_id uuid, p_equipos text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sede uuid;
  v_agregados int := 0;
  v_quitados int := 0;
begin
  if not exists (
    select 1 from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id
    where ue.usuario_id = auth.uid() and ue.empresa_id = p_empresa_id
      and r.codigo = 'admin' and ue.activo
  ) then
    raise exception 'Solo un administrador del negocio puede configurarlo';
  end if;

  select id into v_sede from public.sede
  where empresa_id = p_empresa_id and deleted_at is null
  order by created_at limit 1;
  if v_sede is null then raise exception 'sede no encontrada'; end if;

  update public.maquina
     set deleted_at = now()
   where sede_id = v_sede and deleted_at is null
     and equipment is not null
     and not (equipment = any(coalesce(p_equipos, array[]::text[])))
     and zona = 'Sala principal' and serie is null;
  get diagnostics v_quitados = row_count;

  select public.sembrar_equipamiento_sede(v_sede, p_equipos) into v_agregados;

  return jsonb_build_object('agregados', v_agregados, 'quitados', v_quitados);
end $$;

revoke all on function public.ajustar_equipamiento_empresa(uuid, text[]) from public, authenticated;
grant execute on function public.ajustar_equipamiento_empresa(uuid, text[]) to authenticated;

-- NOTA: registrar_empresa fue modificada para llamar a sembrar_equipamiento_sede
-- justo antes del return (solo para categorías con sala; personal_trainer no la
-- necesita). Ver 20260720111000_registrar_empresa_equipamiento.sql.
