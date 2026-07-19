-- Mundo B (rutina libre): registrar también la carga usada, para que el motor
-- de progresión (analizarProgresion) funcione igual que en la rutina asignada.
alter table public.registro_entreno_libre
  add column if not exists carga_usada numeric;

-- Extiende marcar_entreno_libre con p_carga_usada al final. Conserva la lógica
-- original (validación de pertenencia, coalesce del completado, upsert por
-- usuario+ejercicio+fecha) y suma carga_usada al insert y al on conflict.
create or replace function public.marcar_entreno_libre(
  p_ejercicio_id uuid,
  p_fecha date,
  p_completado boolean,
  p_carga_usada numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_usuario uuid;
  v_completado boolean;
begin
  v_usuario := auth.uid();
  if v_usuario is null then
    raise exception 'usuario no autenticado';
  end if;

  if p_ejercicio_id is null then
    raise exception 'falta el ejercicio';
  end if;

  if p_fecha is null then
    raise exception 'falta la fecha';
  end if;

  if not exists (
    select 1
    from public.rutina_libre_ejercicio re
    join public.rutina_libre_dia d on d.id = re.rutina_libre_dia_id
    join public.rutina_libre rl on rl.id = d.rutina_libre_id
    where re.id = p_ejercicio_id and rl.usuario_id = v_usuario
  ) then
    raise exception 'el ejercicio no pertenece a tu rutina libre';
  end if;

  insert into public.registro_entreno_libre
    (usuario_id, rutina_libre_ejercicio_id, fecha, completado, carga_usada)
  values (v_usuario, p_ejercicio_id, p_fecha, coalesce(p_completado, true), p_carga_usada)
  on conflict (usuario_id, rutina_libre_ejercicio_id, fecha)
  do update set completado = excluded.completado, carga_usada = excluded.carga_usada
  returning completado into v_completado;

  return jsonb_build_object('ok', true, 'completado', v_completado);
end;
$function$;

-- Se elimina la versión vieja de 3 argumentos: si quedara, un call de 3 args
-- resolvería a ella (match exacto gana al default) y NUNCA guardaría carga. Al
-- dropearla, los calls de 3 args de la app resuelven al 4-arg con carga null —
-- siguen funcionando igual, y cuando la app mande el 4º arg, se guarda la carga.
drop function if exists public.marcar_entreno_libre(uuid, date, boolean);

revoke all on function public.marcar_entreno_libre(uuid, date, boolean, numeric) from public, authenticated;
grant execute on function public.marcar_entreno_libre(uuid, date, boolean, numeric) to authenticated;
