-- La app necesita tokenizar el Yape del socio contra la cuenta MP del GYM que
-- va a cobrar (no contra la de FitCore): en un marketplace cada gym tiene su
-- propia public_key. MP ya la devuelve en el intercambio OAuth, pero la
-- estábamos descartando en api/mp/oauth-callback.js.
--
-- La public_key es PÚBLICA por diseño (va en el cliente); no es un secreto como
-- el access_token. Por eso puede exponerse a la app — pero solo la del gym que
-- corresponde, vía RPC, nunca la tabla entera (que sí guarda el access_token).
alter table public.empresa_mp add column if not exists public_key text;

comment on column public.empresa_mp.public_key is
  'Public Key de MP del gym (pública por diseño). La usa la app para tokenizar Yape contra la cuenta que cobra.';

-- Devuelve la public_key del gym de una sede, para que la app pueda tokenizar.
-- Sin datos sensibles: jamás el access_token. Si el gym no conectó MP o no
-- tenemos su public_key todavía, devuelve disponible:false y la app oculta el
-- pago con Yape en vez de fallar al cobrar.
create or replace function public.mp_public_key_de_sede(p_sede_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_emp uuid;
  v_pk text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;

  select empresa_id into v_emp from public.sede where id = p_sede_id;
  if v_emp is null then return jsonb_build_object('disponible', false); end if;

  select public_key into v_pk from public.empresa_mp where empresa_id = v_emp;

  return jsonb_build_object(
    'disponible', v_pk is not null,
    'public_key', v_pk
  );
end $$;

revoke all on function public.mp_public_key_de_sede(uuid) from public, authenticated;
grant execute on function public.mp_public_key_de_sede(uuid) to authenticated;
