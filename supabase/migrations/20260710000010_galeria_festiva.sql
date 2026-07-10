-- Idea Image Gym #7 — Galería de fotos festivas.
-- La Sra. María quiere que los socios suban fotos en días festivos (ej. día del
-- padre con sus papás). El socio sube desde la app → queda pendiente → el gym
-- modera → se muestra en la app. Ligada a un "evento" (texto libre: "Día del padre").

create table if not exists public.foto_social (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  socio_id   uuid references public.socio(id) on delete set null,
  autor      text,                         -- nombre del socio (snapshot)
  evento     text,                         -- "Día del padre", "Aniversario", etc.
  foto_url   text not null,
  estado     text not null default 'pendiente',  -- pendiente | aprobada | rechazada
  creado_at  timestamptz not null default now()
);

create index if not exists idx_foto_social_empresa on public.foto_social (empresa_id, estado, creado_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='foto_social_estado_check') then
    alter table public.foto_social add constraint foto_social_estado_check
      check (estado in ('pendiente','aprobada','rechazada'));
  end if;
end $$;

-- RLS: el gym (staff) gestiona/modera SUS fotos. El socio ve las aprobadas de su
-- empresa (via RPC). Los inserts del socio van por RPC (SECURITY DEFINER).
alter table public.foto_social enable row level security;
drop policy if exists foto_social_staff on public.foto_social;
create policy foto_social_staff on public.foto_social
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

-- RPC: el SOCIO sube una foto (queda pendiente de moderación).
create or replace function public.subir_foto_social(p_foto_url text, p_evento text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_socio record;
begin
  if coalesce(trim(p_foto_url),'') = '' then raise exception 'Falta la foto'; end if;
  select id, empresa_id, nombre into v_socio from public.socio
   where usuario_id = auth.uid() and deleted_at is null limit 1;
  if v_socio.id is null then raise exception 'No estás vinculado como socio'; end if;
  insert into public.foto_social (empresa_id, socio_id, autor, evento, foto_url)
  values (v_socio.empresa_id, v_socio.id, v_socio.nombre, nullif(trim(p_evento),''), p_foto_url);
  return jsonb_build_object('ok', true, 'estado', 'pendiente');
end;
$function$;
grant execute on function public.subir_foto_social(text, text) to authenticated;

-- RPC: galería aprobada para la app (fotos de la empresa del socio).
create or replace function public.galeria_social()
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'autor', f.autor, 'evento', f.evento, 'foto_url', f.foto_url, 'creado_at', f.creado_at
  ) order by f.creado_at desc), '[]'::jsonb)
  from public.foto_social f
  join public.socio s on s.empresa_id = f.empresa_id
  where s.usuario_id = auth.uid() and s.deleted_at is null
    and f.estado = 'aprobada';
$function$;
grant execute on function public.galeria_social() to authenticated;

-- RPC: el gym modera (aprueba/rechaza) una foto.
create or replace function public.moderar_foto_social(p_foto_id uuid, p_aprobar boolean)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not (public.auth_is_admin() or public.auth_rol() in ('admin','recepcion')) then
    raise exception 'No autorizado';
  end if;
  update public.foto_social set estado = case when p_aprobar then 'aprobada' else 'rechazada' end
   where id = p_foto_id and empresa_id = v_empresa;
  if not found then raise exception 'Foto no encontrada'; end if;
  return jsonb_build_object('ok', true);
end;
$function$;
grant execute on function public.moderar_foto_social(uuid, boolean) to authenticated;

comment on table public.foto_social is 'Galería de fotos festivas del gym (socios suben, gym modera, se ven en la app). Idea Image Gym #7.';
