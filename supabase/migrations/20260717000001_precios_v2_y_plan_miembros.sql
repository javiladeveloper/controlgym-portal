-- Precios v2: los planes de GYM suben y absorben la app (precio único), y nace
-- el plan 'miembros' (S/1 por socio vigente, cobrado a mes vencido).
--
--   estudio      49/79   → 99   (app incluida)
--   crecimiento  99/139  → 169  (app incluida)
--   pro          179/229 → 279  (app incluida)
--   miembros     —       → 0    (su monto sale del conteo, no de la lista)
--   trainer/academia/ninos: sin cambios (conservan sin-app/con-app)
--
-- La firma de precio_plan(plan, con_app) NO cambia: los planes de segmento
-- siguen usando con_app, solo los de gym lo ignoran.

create or replace function public.precio_plan(p_plan text, p_con_app boolean)
returns numeric
language sql
immutable
set search_path = public
as $function$
  select case p_plan
    -- Segmento: conservan la dualidad sin app / con app.
    when 'trainer' then case when p_con_app then 49 else 29 end
    when 'academia' then case when p_con_app then 69 else 49 end
    when 'ninos' then case when p_con_app then 109 else 69 end
    -- Gym: precio único, app incluida (ignoran p_con_app).
    when 'estudio' then 99
    when 'crecimiento' then 169
    when 'pro' then 279
    when 'cadena' then 279          -- alias legado de 'pro'
    -- Por miembro: sin cuota fija. El monto real vive en factura_sede.monto;
    -- 0 (y no null) para que el panel no pinte un monto vacío.
    when 'miembros' then 0
  end::numeric
$function$;

-- ── Constraints: aceptar 'miembros' (y 'pro', que faltaba) ──────────────────
-- El renombre 'cadena'→'pro' (20260706000039) actualizó precio_plan pero no el
-- check de empresa: hoy nadie puede poner una empresa en Pro. Se corrige aquí.
alter table public.empresa drop constraint if exists empresa_plan_slug_chk;
alter table public.empresa add constraint empresa_plan_slug_chk
  check (plan_slug in ('estudio','crecimiento','pro','cadena','academia','ninos','trainer','miembros'));

alter table public.suscripcion_plataforma drop constraint if exists suscripcion_plataforma_plan_slug_check;
alter table public.suscripcion_plataforma add constraint suscripcion_plataforma_plan_slug_check
  check (plan_slug in ('estudio','crecimiento','pro','cadena','academia','ninos','trainer','miembros'));

-- 'miembros' da el mismo set de módulos que Estudio (lo esencial).
create or replace function public.plan_rank(p_slug text)
returns int language sql immutable set search_path = public as $$
  select case p_slug
    when 'estudio' then 1
    when 'miembros' then 1
    when 'academia' then 1 when 'ninos' then 1 when 'trainer' then 1
    when 'crecimiento' then 2
    when 'pro' then 3 when 'cadena' then 3
    else 1 end
$$;

-- El plan 'miembros' no lleva tope de socios: cobra por cada uno, así que
-- limitarlos sería absurdo. Estudio conserva su límite de 100; el resto sigue
-- sin tope (null). Se redefine solo para dejar explícito que 'miembros' es
-- ilimitado y no dependa del `else null` por accidente.
create or replace function public.limite_socios_plan(p_plan text)
returns int language sql immutable set search_path = public as $$
  select case p_plan
    when 'estudio' then 100
    when 'miembros' then null   -- sin tope: se cobra por socio
    else null
  end::int
$$;

-- ── elegir_plan: aceptar los slugs nuevos ───────────────────────────────────
-- La versión vigente (20260703000050) valida contra una lista que no incluye
-- 'pro' ni 'miembros'. Además: los planes de gym ahora traen app incluida, y
-- 'miembros' nunca la tiene — el flag se deriva del plan, no del parámetro.
create or replace function public.elegir_plan(
  p_empresa_id uuid,
  p_plan text,
  p_con_app boolean default false
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_con_app boolean;
begin
  if p_plan not in ('estudio','crecimiento','pro','cadena','academia','ninos','trainer','miembros') then
    raise exception 'Plan inválido';
  end if;
  if not exists (
    select 1
    from public.usuario_empresa ue
    join public.rol r on r.id = ue.rol_id
    where ue.usuario_id = auth.uid()
      and ue.empresa_id = p_empresa_id
      and ue.activo = true
      and r.codigo = 'admin'
  ) then
    raise exception 'Solo un administrador del gimnasio puede cambiar el plan';
  end if;

  -- La app se deriva del plan: los de gym la incluyen, 'miembros' nunca la
  -- tiene, y los de segmento respetan lo que pidió el usuario.
  v_con_app := case
    when p_plan in ('estudio','crecimiento','pro','cadena') then true
    when p_plan = 'miembros' then false
    else coalesce(p_con_app, false)
  end;

  update public.empresa
  set plan_slug = p_plan, plan_con_app = v_con_app
  where id = p_empresa_id;

  update public.suscripcion_plataforma
  set plan_slug = p_plan,
      con_app = v_con_app,
      monto = public.precio_plan(p_plan, v_con_app)
  where empresa_id = p_empresa_id
    and estado <> 'activa';  -- con pago activo, el cambio se coordina con soporte
end;
$$;

-- ── Migración de los gyms existentes ────────────────────────────────────────
-- Los planes de gym ahora incluyen la app: quien estaba en con_app=false pasa a
-- true (ahora la recibe) y su monto sube al precio nuevo. Las filas con
-- monto_override=true no se tocan: ese flag existe para precios pactados a mano.
update public.empresa
   set plan_con_app = true
 where plan_slug in ('estudio','crecimiento','pro','cadena');

update public.suscripcion_plataforma
   set con_app = true,
       monto = public.precio_plan(plan_slug, true)
 where plan_slug in ('estudio','crecimiento','pro','cadena');

update public.suscripcion_sede ss
   set con_app = true,
       monto = public.precio_plan(ss.plan_slug, true)
 where ss.plan_slug in ('estudio','crecimiento','pro','cadena')
   and ss.monto_override = false;

-- Los de segmento no cambian de precio, pero su monto podría estar viejo.
update public.suscripcion_sede ss
   set monto = public.precio_plan(ss.plan_slug, ss.con_app)
 where ss.plan_slug in ('trainer','academia','ninos')
   and ss.monto_override = false;
