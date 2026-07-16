-- ¿El usuario u (en la empresa e) tiene el permiso? Igual que auth_tiene_permiso
-- pero para un usuario dado (para usar dentro de triggers/reparto). NO mira admin
-- del JWT: mira el rol y los extras de ESE usuario.
create or replace function public.usuario_tiene_permiso(p_usuario uuid, p_empresa uuid, p_permiso text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- admin de la empresa tiene todo
    exists (select 1 from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
            where ue.usuario_id=p_usuario and ue.empresa_id=p_empresa and ue.activo and r.codigo='admin')
    -- rol base
    or exists (select 1 from public.usuario_empresa ue join public.rol r on r.id=ue.rol_id
            where ue.usuario_id=p_usuario and ue.empresa_id=p_empresa and ue.activo and (
              (r.codigo='recepcion' and p_permiso='caja') or
              (r.codigo='comunicador' and p_permiso='leads') or
              (r.codigo='entrenador' and p_permiso='rutinas') or
              (r.codigo='nutricionista' and p_permiso='rutinas')))
    -- extra
    or exists (select 1 from public.usuario_permiso up
            where up.usuario_id=p_usuario and up.empresa_id=p_empresa and up.permiso=p_permiso);
$$;
revoke all on function public.usuario_tiene_permiso(uuid,uuid,text) from public;
grant execute on function public.usuario_tiene_permiso(uuid,uuid,text) to authenticated, service_role;

-- Reparto de leads: ahora el universo de "atiende leads" es cualquier usuario_empresa
-- activo cuyo usuario tenga el permiso 'leads' (comunicador por rol base, o cualquier
-- otro rol con el permiso extra), no solo rol comunicador exacto.
CREATE OR REPLACE FUNCTION public.asignar_lead_automatico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_com uuid;
begin
  if new.asignado_a is not null then
    new.asignado_at := coalesce(new.asignado_at, now());
    return new;
  end if;

  -- ¿El que registra tiene permiso de leads en esta empresa? Es su prospecto.
  if auth.uid() is not null and exists (
    select 1 from public.usuario_empresa ue
    where ue.usuario_id = auth.uid() and ue.empresa_id = new.empresa_id
      and public.usuario_tiene_permiso(ue.usuario_id, ue.empresa_id, 'leads')
  ) then
    new.asignado_a := auth.uid();
    new.asignado_at := now();
    return new;
  end if;

  -- Canal del gym (web/app/admin sin responsable): reparto equitativo.
  select ue.usuario_id into v_com
  from public.usuario_empresa ue
  join public.usuario u on u.id = ue.usuario_id and coalesce(u.activo, true)
  where ue.empresa_id = new.empresa_id
    and public.usuario_tiene_permiso(ue.usuario_id, ue.empresa_id, 'leads')
  order by (
      select count(*) from public.lead l
      where l.empresa_id = new.empresa_id
        and l.asignado_a = ue.usuario_id
        and l.etapa not in ('inscrito','perdido')
    ) asc, u.nombre asc
  limit 1;

  if v_com is not null then
    new.asignado_a := v_com;
    new.asignado_at := now();
    perform public.encolar_push(v_com, 'Nuevo prospecto 🎯',
      coalesce(new.nombre, 'Alguien') || ' llegó por ' || coalesce(new.fuente, 'la web') || '. Contáctalo pronto.',
      jsonb_build_object('tipo', 'lead_asignado', 'lead_id', new.id));
  end if;

  return new;
end $function$
