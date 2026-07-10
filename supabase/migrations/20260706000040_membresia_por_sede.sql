-- Membresía por sede: algunos gyms con varias sedes atan la membresía del socio
-- a la sede donde se registró — solo entra ahí. Si quiere entrar a todas, paga un
-- plan MULTISEDE (extra). Cambiar de sede es gratis (recepción actualiza
-- socio.sede_id). La mayoría de gyms NO usa esto: el flag es opt-in por gym.

-- 1. Flag del gym: ¿restringe el acceso a la sede del socio? (default false =
--    comportamiento actual, cualquier socio entra a cualquier sede).
alter table public.empresa
  add column if not exists restringe_sede boolean not null default false;

comment on column public.empresa.restringe_sede is
  'true = el socio solo entra a la sede donde está registrado (salvo plan multisede). false (default) = entra a cualquier sede.';

-- 2. Helper: ¿este socio puede entrar a esta sede? Considera:
--    · el gym no restringe → sí (cualquier sede)
--    · la sede es la del socio → sí
--    · el socio tiene un plan MULTISEDE activo → sí (cualquier sede)
--    · si no → no
create or replace function public.socio_puede_entrar_sede(p_socio_id uuid, p_sede_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    -- gym no restringe por sede → siempre puede
    (not coalesce((select e.restringe_sede
                     from public.empresa e
                     join public.socio s on s.empresa_id = e.id
                    where s.id = p_socio_id), false))
    -- o es su propia sede
    or exists (select 1 from public.socio s where s.id = p_socio_id and s.sede_id = p_sede_id)
    -- o tiene un plan multisede activo (acceso a todas)
    or exists (
      select 1 from public.membresia m
      join public.plan p on p.id = m.plan_id
      where m.socio_id = p_socio_id and m.estado = 'activa'
        and current_date between m.fecha_inicio and m.fecha_fin
        and coalesce(p.multisede, false)
    );
$function$;

grant execute on function public.socio_puede_entrar_sede(uuid, uuid) to authenticated;

-- 3. checkin_manual: además de la membresía vigente, valida la sede.
create or replace function public.checkin_manual(p_socio_id uuid, p_sede_id uuid, p_direccion text default 'entrada'::text)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_empresa uuid;
  v_nombre text;
  v_ok boolean;
  v_sede_ok boolean;
  v_resultado text;
  v_motivo text;
begin
  select empresa_id, nombre into v_empresa, v_nombre from public.socio where id = p_socio_id;
  if v_empresa is null then raise exception 'Socio no encontrado'; end if;

  -- ¿Membresía activa vigente?
  select exists (
    select 1 from public.membresia m
    where m.socio_id = p_socio_id and m.estado = 'activa'
      and current_date between m.fecha_inicio and m.fecha_fin
  ) into v_ok;

  -- ¿Puede entrar a ESTA sede? (regla de membresía por sede)
  v_sede_ok := public.socio_puede_entrar_sede(p_socio_id, p_sede_id);

  -- Prioridad del motivo: primero membresía, luego sede.
  if not v_ok then
    v_resultado := 'denegado'; v_motivo := 'membresia_vencida';
  elsif not v_sede_ok then
    v_resultado := 'denegado'; v_motivo := 'otra_sede';
  else
    v_resultado := 'permitido'; v_motivo := null;
  end if;

  insert into public.checkin (empresa_id, sede_id, socio_id, direccion, metodo, resultado, motivo)
  values (v_empresa, p_sede_id, p_socio_id, p_direccion, 'manual', v_resultado, v_motivo);

  return jsonb_build_object('resultado', v_resultado, 'motivo', v_motivo, 'socio', v_nombre);
end;
$function$;

comment on function public.checkin_manual is
  'Check-in manual de recepción. Valida membresía vigente + acceso a la sede (membresía por sede / plan multisede). motivo=otra_sede si el socio no puede entrar a esa sede.';
