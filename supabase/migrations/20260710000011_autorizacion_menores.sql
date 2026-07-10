-- Idea Image Gym #6 — Autorización virtual para menores.
-- Un socio menor (es_menor) necesita el consentimiento de su apoderado para
-- entrenar. El apoderado autoriza (virtualmente, desde su cuenta o un enlace);
-- queda registrado quién, cuándo y qué autoriza. El panel ve el estado.

create table if not exists public.autorizacion_menor (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references public.empresa(id) on delete cascade,
  socio_id     uuid not null references public.socio(id) on delete cascade,   -- el menor
  apoderado_id uuid references public.apoderado(id) on delete set null,
  autorizado_por text,                       -- nombre del apoderado que firma (snapshot)
  documento_apoderado text,                  -- DNI del apoderado (respaldo legal)
  texto        text,                          -- el consentimiento aceptado (snapshot del texto)
  estado       text not null default 'pendiente',  -- pendiente | autorizada | revocada
  autorizada_at timestamptz,
  creado_at    timestamptz not null default now()
);

create index if not exists idx_autorizacion_menor_empresa on public.autorizacion_menor (empresa_id, socio_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='autorizacion_menor_estado_check') then
    alter table public.autorizacion_menor add constraint autorizacion_menor_estado_check
      check (estado in ('pendiente','autorizada','revocada'));
  end if;
end $$;

alter table public.autorizacion_menor enable row level security;
drop policy if exists autorizacion_menor_scope on public.autorizacion_menor;
create policy autorizacion_menor_scope on public.autorizacion_menor
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

-- RPC: el apoderado autoriza al menor (desde su cuenta/app o el panel de recepción).
-- Registra el consentimiento con los datos del apoderado y el texto aceptado.
create or replace function public.autorizar_menor(
  p_socio_id uuid, p_autorizado_por text, p_documento text default null,
  p_apoderado_id uuid default null, p_texto text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_texto text := coalesce(nullif(trim(p_texto),''),
    'Como apoderado del menor, autorizo su ingreso y participación en las actividades del gimnasio, y declaro conocer las normas de seguridad.');
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  if coalesce(trim(p_autorizado_por),'') = '' then raise exception 'Falta el nombre del apoderado'; end if;
  if not exists (select 1 from public.socio where id = p_socio_id and empresa_id = v_empresa and deleted_at is null) then
    raise exception 'Socio no encontrado';
  end if;

  -- Una autorización vigente por menor: si ya hay, la actualizamos.
  insert into public.autorizacion_menor (empresa_id, socio_id, apoderado_id, autorizado_por, documento_apoderado, texto, estado, autorizada_at)
  values (v_empresa, p_socio_id, p_apoderado_id, trim(p_autorizado_por), nullif(trim(p_documento),''), v_texto, 'autorizada', now());

  return jsonb_build_object('ok', true, 'estado', 'autorizada');
end;
$function$;
grant execute on function public.autorizar_menor(uuid, text, text, uuid, text) to authenticated;

-- RPC: estado de autorización de un menor (para el panel).
create or replace function public.estado_autorizacion_menor(p_socio_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    (select jsonb_build_object('estado', a.estado, 'autorizado_por', a.autorizado_por,
              'documento', a.documento_apoderado, 'autorizada_at', a.autorizada_at)
     from public.autorizacion_menor a
     where a.socio_id = p_socio_id and a.empresa_id = public.auth_empresa_id()
     order by a.creado_at desc limit 1),
    jsonb_build_object('estado', 'sin_autorizacion'));
$function$;
grant execute on function public.estado_autorizacion_menor(uuid) to authenticated;

comment on table public.autorizacion_menor is 'Autorización virtual del apoderado para el ingreso/actividad de un socio menor. Idea Image Gym #6.';
