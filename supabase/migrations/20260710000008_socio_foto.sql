-- Idea Image Gym #2 — Foto del socio (para reconocimiento facial).
-- El socio sube su propia foto desde la app (con guía de estándares). Recepción
-- la valida antes de habilitarla para el molinete facial (Fase 2). Estado:
--   'sin_foto' (default) | 'pendiente' (subida, por validar) | 'aprobada' | 'rechazada'
alter table public.socio
  add column if not exists foto_url text,
  add column if not exists foto_estado text not null default 'sin_foto',
  add column if not exists foto_actualizada_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='socio_foto_estado_check') then
    alter table public.socio add constraint socio_foto_estado_check
      check (foto_estado in ('sin_foto','pendiente','aprobada','rechazada'));
  end if;
end $$;

comment on column public.socio.foto_url is 'Foto del socio (para carnet y reconocimiento facial). La sube el socio desde la app.';
comment on column public.socio.foto_estado is 'sin_foto | pendiente (por validar) | aprobada | rechazada. Recepción valida antes de usarla en el facial.';

-- RPC para que el SOCIO suba/actualice su foto desde la app (queda 'pendiente').
create or replace function public.subir_mi_foto(p_foto_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if coalesce(trim(p_foto_url),'') = '' then raise exception 'Falta la foto'; end if;
  -- La foto es del usuario: si es socio en varios gyms, se aplica a todas sus
  -- fichas (cada gym la validará). Por eso NO usamos returning into (multi-fila).
  update public.socio
     set foto_url = p_foto_url, foto_estado = 'pendiente', foto_actualizada_at = now()
   where usuario_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'No estás vinculado como socio'; end if;
  return jsonb_build_object('ok', true, 'estado', 'pendiente');
end;
$function$;
grant execute on function public.subir_mi_foto(text) to authenticated;

-- RPC para que recepción/admin apruebe o rechace la foto de un socio.
create or replace function public.validar_foto_socio(p_socio_id uuid, p_aprobar boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not (public.auth_is_admin() or public.auth_rol() in ('admin','recepcion')) then
    raise exception 'No autorizado';
  end if;
  update public.socio
     set foto_estado = case when p_aprobar then 'aprobada' else 'rechazada' end
   where id = p_socio_id and empresa_id = v_empresa and deleted_at is null;
  if not found then raise exception 'Socio no encontrado'; end if;
  return jsonb_build_object('ok', true, 'estado', case when p_aprobar then 'aprobada' else 'rechazada' end);
end;
$function$;
grant execute on function public.validar_foto_socio(uuid, boolean) to authenticated;
