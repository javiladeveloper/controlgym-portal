-- Task C3: reportar una rutina problematica y alias publico del autor.

create table if not exists public.rutina_reporte (
  id uuid primary key default gen_random_uuid(),
  rutina_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  motivo text not null,
  created_at timestamptz not null default now(),
  unique (rutina_id, usuario_id)
);

alter table public.rutina_reporte enable row level security;

drop policy if exists rutina_reporte_propio on public.rutina_reporte;
create policy rutina_reporte_propio on public.rutina_reporte
  for insert to authenticated
  with check (usuario_id = (select auth.uid()));

-- Reportar existe AUNQUE haya aprobacion previa: el owner puede aprobar algo
-- que luego resulte problematico, y hace falta una via para enterarse.
-- A los 3 reportes la rutina se retira sola y deja de verse hasta revisarla.
create or replace function public.reportar_rutina(p_rutina uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_total int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  if coalesce(trim(p_motivo),'') = '' then
    raise exception 'Cuéntanos qué está mal con esta rutina';
  end if;

  insert into public.rutina_reporte (rutina_id, usuario_id, motivo)
  values (p_rutina, v_uid, trim(p_motivo))
  on conflict (rutina_id, usuario_id) do nothing;

  select count(*) into v_total from public.rutina_reporte where rutina_id = p_rutina;
  if v_total >= 3 then
    update public.rutina_predisenada set estado = 'retirada'
     where id = p_rutina and estado = 'aprobada';
  end if;

  return jsonb_build_object('ok', true, 'reportes', v_total);
end;
$$;

revoke all on function public.reportar_rutina(uuid, text) from public;
grant execute on function public.reportar_rutina(uuid, text) to authenticated;

-- Alias publico. actualizar_mi_perfil ya existe con 7 parametros; anadir uno
-- con DEFAULT crearia una SOBRECARGA y PostgREST fallaria con "function is not
-- unique". Por eso se hace una RPC aparte, pequena y sin ambiguedad.
create or replace function public.actualizar_mi_nombre_publico(p_alias text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;
  update public.usuario
     set nombre_publico = nullif(trim(p_alias), ''), updated_at = now()
   where id = v_uid;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.actualizar_mi_nombre_publico(text) from public;
grant execute on function public.actualizar_mi_nombre_publico(text) to authenticated;

-- get_mi_perfil tiene que DEVOLVER el alias, no solo dejar que se guarde.
-- Sin esto el diálogo de editar perfil se abre siempre vacío en ese campo: la
-- persona escribe su alias, se guarda bien, y al reabrir parece que no se
-- guardó — así que lo vuelve a escribir. Un fallo silencioso de los que no dan
-- error pero hacen dudar del producto.
create or replace function public.get_mi_perfil()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_perfil jsonb; v_email text;
begin
  if v_uid is null then raise exception 'usuario no autenticado'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select jsonb_build_object(
    'id', u.id, 'nombre', u.nombre, 'email', coalesce(u.email, v_email),
    'telefono', u.telefono, 'documento', u.documento, 'objetivo_nota', u.objetivo_nota,
    'objetivo_id', u.objetivo_id,
    'objetivo_nombre', (select nombre from public.objetivo_entrenamiento o where o.id = u.objetivo_id),
    'foto_url', u.foto_url, 'foto_estado', u.foto_estado,
    'peso_kg', u.peso_kg, 'talla_m', u.talla_m, 'fecha_nacimiento', u.fecha_nacimiento,
    'nombre_publico', u.nombre_publico
  ) into v_perfil
  from public.usuario u where u.id = v_uid;
  if v_perfil is null then
    v_perfil := jsonb_build_object('id', v_uid, 'email', v_email,
      'nombre', null, 'telefono', null, 'documento', null, 'objetivo_nota', null,
      'objetivo_id', null, 'objetivo_nombre', null,
      'foto_url', null, 'foto_estado', null, 'peso_kg', null, 'talla_m', null,
      'fecha_nacimiento', null, 'nombre_publico', null);
  end if;
  return v_perfil;
end;
$function$;
