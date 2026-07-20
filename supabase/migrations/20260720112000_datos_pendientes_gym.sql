-- Qué le falta al gym para que su página web pública se vea completa.
-- Alimenta el ChecklistActivacion del Dashboard.
--
-- POR QUÉ (auditoría del alta, 2026-07-20): el wizard de bienvenida pide
-- WhatsApp, dirección y horario, pero **es salteable**. Medido sobre los gyms
-- reales: 4 de 9 sin WhatsApp, 4 sin dirección, 5 sin horario, 5 sin logo. Su
-- landing queda sin datos de contacto y no se enteran — nadie se lo dice.
--
-- Es informativo, nunca bloquea: devuelve la lista de pendientes con el motivo
-- (en lenguaje del dueño, no técnico) y el tab de Configuración donde se arregla.
create or replace function public.datos_pendientes_gym()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_e record;
  v_logo text;
  v_faltan jsonb := '[]'::jsonb;
begin
  if v_emp is null then return jsonb_build_object('total', 0, 'faltan', v_faltan); end if;

  select telefono_contacto, direccion, horario_atencion, landing
    into v_e
  from public.empresa where id = v_emp;

  select logo_url into v_logo from public.empresa_tema where empresa_id = v_emp;

  if coalesce(trim(v_e.telefono_contacto), '') = '' then
    v_faltan := v_faltan || jsonb_build_object(
      'clave','whatsapp','que','WhatsApp de contacto',
      'porque','Tus socios y prospectos te escriben desde tu página web',
      'tab','negocio');
  end if;

  if coalesce(trim(v_e.direccion), '') = '' then
    v_faltan := v_faltan || jsonb_build_object(
      'clave','direccion','que','Dirección del local',
      'porque','Sin ella tu página no muestra dónde estás ni el mapa',
      'tab','negocio');
  end if;

  if coalesce(trim(v_e.horario_atencion), '') = '' then
    v_faltan := v_faltan || jsonb_build_object(
      'clave','horario','que','Horario de atención',
      'porque','Es lo primero que pregunta quien quiere inscribirse',
      'tab','negocio');
  end if;

  if v_logo is null then
    v_faltan := v_faltan || jsonb_build_object(
      'clave','logo','que','Logo del gimnasio',
      'porque','Aparece en tu página, en la app del socio y en sus recibos',
      'tab','marca');
  end if;

  return jsonb_build_object('total', jsonb_array_length(v_faltan), 'faltan', v_faltan);
end $$;

revoke all on function public.datos_pendientes_gym() from public, authenticated;
grant execute on function public.datos_pendientes_gym() to authenticated;
