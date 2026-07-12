-- Regla afinada con el owner: los prospectos que un COMUNICADOR consigue por
-- su cuenta (sus redes sociales) son SUYOS — al registrarlos en el panel se le
-- asignan a él. Los que llegan por los canales del gym (web pública vía
-- crear_lead_publico, app, o creados por admin/recepción sin responsable) se
-- reparten al comunicador activo con menos leads abiertos, como antes.
--
-- Cómo distingue: auth.uid() al momento del insert. Si quien inserta es
-- comunicador de esa empresa → se lo queda. La web pública corre como anon
-- (auth.uid() null) → reparto. Elegir responsable a mano siempre gana.

create or replace function public.asignar_lead_automatico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_com uuid;
begin
  if new.asignado_a is not null then
    return new;
  end if;

  -- ¿El que registra es comunicador de esta empresa? Es su prospecto.
  if auth.uid() is not null and exists (
    select 1 from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id and r.codigo = 'comunicador'
    where ue.usuario_id = auth.uid() and ue.empresa_id = new.empresa_id
  ) then
    new.asignado_a := auth.uid();
    return new;
  end if;

  -- Canal del gym (web/app/admin sin responsable): reparto equitativo.
  select ue.usuario_id into v_com
  from public.usuario_empresa ue
  join public.rol r on r.id = ue.rol_id and r.codigo = 'comunicador'
  join public.usuario u on u.id = ue.usuario_id and coalesce(u.activo, true)
  where ue.empresa_id = new.empresa_id
  order by (
      select count(*) from public.lead l
      where l.empresa_id = new.empresa_id
        and l.asignado_a = ue.usuario_id
        and l.etapa <> 'inscrito'
    ) asc, u.nombre asc
  limit 1;

  if v_com is not null then
    new.asignado_a := v_com;
    perform public.encolar_push(v_com, 'Nuevo prospecto 🎯',
      coalesce(new.nombre, 'Alguien') || ' llegó por ' || coalesce(new.fuente, 'la web') || '. Contáctalo pronto.',
      jsonb_build_object('tipo', 'lead_asignado', 'lead_id', new.id));
  end if;

  return new;
end $$;
