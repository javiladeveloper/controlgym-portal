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
