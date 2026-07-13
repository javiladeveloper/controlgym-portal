-- Aviso de ofertas en la app del socio (pedido del owner): cuando la empresa
-- pone un producto en oferta, avisar a los socios. Recomendación aplicada: UN
-- push agrupado por sede ("🏷️ N productos en oferta"), no un popup ni 20
-- pushes. La app además muestra un badge en la tienda (contrato abajo).
--
-- Mecánica: un flag por producto marca "oferta recién anunciada"; un job diario
-- junta las ofertas nuevas por sede/empresa y encola UN push por socio con app.

alter table public.producto add column if not exists oferta_anunciada boolean not null default true;
-- 'true' de arranque = no re-anunciar lo ya existente. Solo lo que ENTRE a
-- oferta desde ahora dispara aviso.

-- Trigger: producto que PASA a estar en oferta (antes sin descuento efectivo,
-- ahora con descuento y visible en app) → marca oferta_anunciada=false para que
-- el job lo tome. Si sale de oferta, se rearma para el próximo anuncio.
create or replace function public.trg_producto_oferta() returns trigger
language plpgsql set search_path = public as $$
declare
  v_antes boolean := (coalesce(old.descuento_tipo,'') <> '' and coalesce(old.descuento_valor,0) > 0);
  v_ahora boolean := (coalesce(new.descuento_tipo,'') <> '' and coalesce(new.descuento_valor,0) > 0);
begin
  if new.visible_en_app and v_ahora and not v_antes then
    new.oferta_anunciada := false;             -- entró en oferta → por anunciar
  elsif not v_ahora then
    new.oferta_anunciada := true;              -- salió de oferta → rearmar
  end if;
  return new;
end $$;

drop trigger if exists trg_producto_oferta on public.producto;
create trigger trg_producto_oferta before update of descuento_tipo, descuento_valor, visible_en_app
  on public.producto for each row execute function public.trg_producto_oferta();

-- Job: por empresa con ofertas nuevas visibles, arma 1 push agrupado a cada
-- socio con app (usuario_id no nulo). Devuelve cuántos pushes encoló.
create or replace function public.avisar_ofertas_app()
returns int language plpgsql security definer set search_path = public as $$
declare
  r_emp record;
  v_n int;
  v_socio record;
  v_total int := 0;
begin
  for r_emp in
    select empresa_id, count(*) as n
    from public.producto
    where visible_en_app and not oferta_anunciada
      and coalesce(descuento_tipo,'') <> '' and coalesce(descuento_valor,0) > 0
      and deleted_at is null
    group by empresa_id
  loop
    v_n := r_emp.n;
    -- push agrupado a cada socio con app de esa empresa
    for v_socio in
      select s.usuario_id from public.socio s
      where s.empresa_id = r_emp.empresa_id and s.usuario_id is not null and s.deleted_at is null
    loop
      perform public.encolar_push(
        v_socio.usuario_id,
        case when v_n = 1 then '🏷️ ¡Producto en oferta!' else '🏷️ ' || v_n || ' productos en oferta' end,
        case when v_n = 1 then 'Uno de los productos de tu gym bajó de precio. Míralo en la tienda.'
             else 'Varios productos de tu gym están con descuento. Míralos en la tienda de la app.' end,
        jsonb_build_object('tipo', 'ofertas', 'n', v_n)
      );
      v_total := v_total + 1;
    end loop;
    -- marcar como anunciadas (no repetir mañana)
    update public.producto set oferta_anunciada = true
    where empresa_id = r_emp.empresa_id and visible_en_app and not oferta_anunciada;
  end loop;
  return v_total;
end $$;
revoke all on function public.avisar_ofertas_app() from public;

-- Cron diario 14:30 UTC = 09:30 Lima (media mañana, buena hora de apertura).
select cron.unschedule(jobid) from cron.job where jobname = 'fitcontrol-ofertas-app';
select cron.schedule('fitcontrol-ofertas-app', '30 14 * * *', 'select public.avisar_ofertas_app()');

-- Para el badge de la app: cuántos productos en oferta ve el socio en SU tienda.
-- (La app ya usa catalogo_app para la lista; esto es solo el contador del badge.)
create or replace function public.ofertas_activas_socio()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.socio s
  join public.producto p on p.empresa_id = s.empresa_id
  where s.usuario_id = auth.uid() and s.deleted_at is null
    and p.visible_en_app and p.deleted_at is null and coalesce(p.activo, true)
    and coalesce(p.descuento_tipo,'') <> '' and coalesce(p.descuento_valor,0) > 0;
$$;
revoke all on function public.ofertas_activas_socio() from public;
grant execute on function public.ofertas_activas_socio() to authenticated, service_role;
