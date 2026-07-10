-- Idea Image Gym #5 — Buzón de sugerencias (en la página web pública del gym).
-- Un visitante/socio deja su sugerencia o duda; se guarda y (si el gym tiene
-- email configurado) se le avisa por correo. El panel puede verlas.

create table if not exists public.sugerencia (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  nombre     text,                         -- opcional (puede ser anónima)
  contacto   text,                         -- email/teléfono opcional para responder
  mensaje    text not null,
  leida      boolean not null default false,
  creado_at  timestamptz not null default now()
);

create index if not exists idx_sugerencia_empresa on public.sugerencia (empresa_id, creado_at desc);

-- RLS: el gym (admin/recepción) lee y gestiona SUS sugerencias.
alter table public.sugerencia enable row level security;
drop policy if exists sugerencia_scope on public.sugerencia;
create policy sugerencia_scope on public.sugerencia
  for all to authenticated
  using (empresa_id = public.auth_empresa_id())
  with check (empresa_id = public.auth_empresa_id());

-- RPC pública (para la web, sin login): registra la sugerencia por slug del gym
-- y avisa al correo del gym. SECURITY DEFINER porque el visitante no está logueado.
create or replace function public.enviar_sugerencia(
  p_slug text, p_mensaje text, p_nombre text default null, p_contacto text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
declare
  v_empresa uuid; v_gym text; v_correo text; v_key text; v_html text;
begin
  if coalesce(trim(p_mensaje), '') = '' then
    raise exception 'Escribe tu sugerencia';
  end if;
  select id, nombre, email_contacto into v_empresa, v_gym, v_correo
    from public.empresa where slug = p_slug and estado = 'activa' and deleted_at is null;
  if v_empresa is null then raise exception 'Gimnasio no encontrado'; end if;

  insert into public.sugerencia (empresa_id, nombre, contacto, mensaje)
  values (v_empresa, nullif(trim(p_nombre),''), nullif(trim(p_contacto),''), trim(p_mensaje));

  -- Avisar al correo del gym (si tiene email + hay API key).
  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  if v_key is not null and v_correo is not null and trim(v_correo) <> '' then
    v_html := '<div style="font-family:sans-serif;max-width:480px"><h2>💬 Nueva sugerencia</h2>' ||
      '<p style="color:#444;line-height:1.6"><b>' || coalesce(nullif(trim(p_nombre),''),'Anónimo') || '</b>' ||
      coalesce(' · ' || nullif(trim(p_contacto),''), '') || ' escribió:</p>' ||
      '<blockquote style="border-left:3px solid #FF6B35;padding-left:12px;color:#333">' ||
      replace(trim(p_mensaje), chr(10), '<br>') || '</blockquote>' ||
      '<p style="color:#aaa;font-size:11px;margin-top:18px">Desde tu página web · FitCore</p></div>';
    begin
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization','Bearer '||v_key,'Content-Type','application/json'),
        body := jsonb_build_object('from', v_gym || ' <avisos@fitcorecenter.com>',
          'to', jsonb_build_array(v_correo::text),
          'subject', '💬 Nueva sugerencia en tu página web', 'html', v_html));
    exception when others then null; end;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

-- La web pública la llama con la anon key (sin sesión).
grant execute on function public.enviar_sugerencia(text, text, text, text) to anon, authenticated;

comment on table public.sugerencia is 'Buzón de sugerencias del gym (desde su página web pública). Idea Image Gym #5.';
