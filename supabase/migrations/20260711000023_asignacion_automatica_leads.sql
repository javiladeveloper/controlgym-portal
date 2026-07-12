-- ¿A quién le llega un prospecto nuevo si hay 5 comunicadores? (pregunta del
-- owner). Antes: a NADIE — los leads de la web (crear_lead_publico) entraban
-- sin responsable y alguien tenía que repartirlos a mano.
--
-- Ahora: trigger BEFORE INSERT en lead. Si el lead llega sin asignar, se lo
-- queda el comunicador ACTIVO de esa empresa con MENOS leads abiertos (los
-- 'inscrito' ya no cuentan como carga) — reparto equitativo que se balancea
-- solo, con empate por nombre para ser determinista. El comunicador recibe un
-- push "Nuevo prospecto 🎯" al instante. Si el gym no tiene comunicadores, el
-- lead queda sin asignar como antes (el admin lo ve igual en el CRM).
-- Aplica a TODOS los canales (web pública, panel, app) sin tocar cada RPC.

create or replace function public.asignar_lead_automatico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_com uuid;
begin
  if new.asignado_a is not null then
    return new;
  end if;

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

drop trigger if exists trg_lead_asignacion_automatica on public.lead;
create trigger trg_lead_asignacion_automatica
  before insert on public.lead
  for each row execute function public.asignar_lead_automatico();
