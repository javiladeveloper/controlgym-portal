-- 045: Email automático al invitar personal al panel.
-- Antes la invitación solo quedaba en BD y el admin avisaba a mano.
-- Ahora el invitado recibe un correo con su rol y el link de acceso.

create or replace function public.notificar_invitacion()
returns trigger
language plpgsql security definer
set search_path = public, net
as $$
declare
  v_key text;
  v_gym text;
  v_rol text;
  v_invitador text;
  v_html text;
begin
  select valor into v_key from privado.secreto where clave = 'resend_api_key';
  if v_key is null then return new; end if;

  select nombre into v_gym from public.empresa where id = new.empresa_id;
  select nombre into v_rol from public.rol where id = new.rol_id;
  select nombre into v_invitador from public.usuario where id = new.invitado_por;

  v_html :=
    '<div style="font-family:sans-serif;max-width:480px">' ||
    '<h2 style="margin:0 0 8px">Te invitaron al equipo de ' || coalesce(v_gym, 'un gimnasio') || ' 🏋️</h2>' ||
    '<p style="color:#444;line-height:1.6">' ||
    coalesce('<b>' || v_invitador || '</b> te', 'Te') || ' dio acceso al panel de gestión con el rol de <b>' ||
    coalesce(v_rol, 'colaborador') || '</b>.</p>' ||
    '<p style="color:#444;line-height:1.6">Para entrar, inicia sesión con Google usando <b>este mismo correo</b> (' || new.email || '):</p>' ||
    '<p style="margin:22px 0"><a href="https://app.fitcorecenter.com/login" ' ||
    'style="background:#FF6B35;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Entrar al panel</a></p>' ||
    '<p style="color:#888;font-size:12px">Si no esperabas esta invitación puedes ignorar este correo. — FitControl</p>' ||
    '</div>';

  begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', 'FitControl <avisos@fitcorecenter.com>',
        'to', jsonb_build_array(new.email::text),
        'subject', 'Te invitaron al panel de ' || coalesce(v_gym, 'tu gimnasio') || ' en FitControl',
        'html', v_html
      )
    );
  exception when others then
    null; -- el email jamás bloquea la invitación
  end;

  return new;
end;
$$;

drop trigger if exists trg_notificar_invitacion on public.invitacion;
create trigger trg_notificar_invitacion
  after insert on public.invitacion
  for each row execute function public.notificar_invitacion();

-- Reinvitación (upsert que vuelve a dejarla pendiente) también notifica
drop trigger if exists trg_notificar_reinvitacion on public.invitacion;
create trigger trg_notificar_reinvitacion
  after update of estado on public.invitacion
  for each row
  when (old.estado = 'revocada' and new.estado = 'pendiente')
  execute function public.notificar_invitacion();
