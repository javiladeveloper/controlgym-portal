-- 042: Libro de Reclamaciones virtual de la PLATAFORMA (Ley 29571 / INDECOPI).
-- Requisito de homologación de Culqi: debe ser nativo (sin formularios externos).
-- El visitante registra reclamo/queja, recibe un correlativo LR-AAAA-#### y
-- FitControl es notificado por email (Resend vía pg_net, patrón de 034).

create sequence if not exists public.reclamacion_seq;

create table if not exists public.reclamacion (
  id uuid primary key default gen_random_uuid(),
  correlativo text not null unique,
  tipo text not null check (tipo in ('reclamo', 'queja')),
  -- Identificación del consumidor
  nombre text not null,
  documento text not null,          -- DNI / CE
  direccion text,
  telefono text,
  email text not null,
  es_menor boolean not null default false,
  apoderado text,                   -- si es menor de edad
  -- Identificación del bien contratado
  bien text not null,               -- producto o servicio
  monto numeric(12,2),
  -- Detalle
  detalle text not null,
  pedido text not null,             -- pedido concreto del consumidor
  -- Gestión interna
  estado text not null default 'pendiente' check (estado in ('pendiente', 'respondido')),
  respuesta text,
  respondido_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.reclamacion enable row level security;
-- Solo el superadmin (dueño de la plataforma) lee/gestiona desde el panel
drop policy if exists reclamacion_superadmin on public.reclamacion;
create policy reclamacion_superadmin on public.reclamacion
  for all to authenticated
  using (public.es_superadmin()) with check (public.es_superadmin());

-- RPC pública: registra la hoja de reclamación y devuelve el correlativo
create or replace function public.crear_reclamacion(
  p_tipo text,
  p_nombre text,
  p_documento text,
  p_email text,
  p_bien text,
  p_detalle text,
  p_pedido text,
  p_direccion text default null,
  p_telefono text default null,
  p_monto numeric default null,
  p_es_menor boolean default false,
  p_apoderado text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_num int;
  v_corr text;
  v_key text;
  v_html text;
begin
  if p_tipo not in ('reclamo', 'queja') then
    raise exception 'Tipo inválido';
  end if;
  if coalesce(trim(p_nombre), '') = '' or coalesce(trim(p_documento), '') = ''
     or coalesce(trim(p_email), '') = '' or coalesce(trim(p_detalle), '') = ''
     or coalesce(trim(p_pedido), '') = '' or coalesce(trim(p_bien), '') = '' then
    raise exception 'Completa todos los campos obligatorios';
  end if;

  v_num := nextval('public.reclamacion_seq');
  v_corr := 'LR-' || to_char(now(), 'YYYY') || '-' || lpad(v_num::text, 4, '0');

  insert into public.reclamacion (
    correlativo, tipo, nombre, documento, direccion, telefono, email,
    es_menor, apoderado, bien, monto, detalle, pedido
  ) values (
    v_corr, p_tipo, trim(p_nombre), trim(p_documento), nullif(trim(coalesce(p_direccion,'')),''),
    nullif(trim(coalesce(p_telefono,'')),''), trim(p_email),
    coalesce(p_es_menor, false), nullif(trim(coalesce(p_apoderado,'')),''),
    trim(p_bien), p_monto, trim(p_detalle), trim(p_pedido)
  );

  -- Notificar a la plataforma (nunca bloquea el registro)
  begin
    select valor into v_key from privado.secreto where clave = 'resend_api_key';
    if v_key is not null then
      v_html :=
        '<div style="font-family:sans-serif;max-width:520px">' ||
        '<h2 style="margin:0 0 4px">📖 ' || initcap(p_tipo) || ' ' || v_corr || '</h2>' ||
        '<p style="color:#B00;margin:0 0 14px"><b>Plazo legal de respuesta: 15 días hábiles.</b></p>' ||
        '<table style="font-size:14px;line-height:1.9">' ||
        '<tr><td style="color:#888;padding-right:12px">Consumidor</td><td><b>' || p_nombre || '</b> (' || p_documento || ')</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Contacto</td><td>' || p_email || coalesce(' · ' || p_telefono, '') || '</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Servicio</td><td>' || p_bien || coalesce(' · S/ ' || p_monto::text, '') || '</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Detalle</td><td>' || p_detalle || '</td></tr>' ||
        '<tr><td style="color:#888;padding-right:12px">Pedido</td><td>' || p_pedido || '</td></tr>' ||
        '</table></div>';
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'FitControl <onboarding@resend.dev>',
          'to', jsonb_build_array('fitcorecenterpe@gmail.com'),
          'subject', '📖 Libro de Reclamaciones: ' || initcap(p_tipo) || ' ' || v_corr,
          'html', v_html
        )
      );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object('correlativo', v_corr);
end;
$$;

grant execute on function public.crear_reclamacion(text, text, text, text, text, text, text, text, text, numeric, boolean, text) to anon, authenticated;
