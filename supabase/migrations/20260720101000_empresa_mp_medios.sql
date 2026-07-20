-- Medios de pago que MP tiene habilitados para la cuenta del gym.
--
-- Objetivo: que el dueño del gym NO tenga que configurar nada. Al conectar su
-- cuenta por OAuth (paso que ya hace igual) consultamos /v1/payment_methods y
-- guardamos qué medios acepta. Si Yape está, la app lo muestra sola; si no, lo
-- oculta y el panel le explica cómo activarlo — en vez de exigirle un paso
-- previo que muchos no harían.
alter table public.empresa_mp add column if not exists medios_pago jsonb;
alter table public.empresa_mp add column if not exists medios_actualizado_at timestamptz;

comment on column public.empresa_mp.medios_pago is
  'Ids de medios de pago habilitados en la cuenta MP del gym (["yape","visa",...]), leídos de /v1/payment_methods.';

-- Estado de cobros de la sede para la APP: qué puede ofrecerle al socio.
-- Devuelve la public_key (pública por diseño) y si Yape está disponible.
-- Jamás expone el access_token.
create or replace function public.mp_public_key_de_sede(p_sede_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_emp uuid;
  v_pk text;
  v_medios jsonb;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;

  select empresa_id into v_emp from public.sede where id = p_sede_id;
  if v_emp is null then return jsonb_build_object('disponible', false, 'yape', false); end if;

  select public_key, medios_pago into v_pk, v_medios
  from public.empresa_mp where empresa_id = v_emp;

  return jsonb_build_object(
    'disponible', v_pk is not null,
    'public_key', v_pk,
    -- si aún no sabemos los medios (null), asumimos que Yape SÍ está: la doc de
    -- MP no exige activarlo y es el medio #1 en Perú. Si resultara que no, el
    -- cobro falla con un error claro y el panel avisa. Preferimos eso a ocultar
    -- Yape a un gym que sí lo tiene.
    'yape', v_medios is null or (v_medios ? 'yape')
  );
end $$;

revoke all on function public.mp_public_key_de_sede(uuid) from public, authenticated;
grant execute on function public.mp_public_key_de_sede(uuid) to authenticated;
