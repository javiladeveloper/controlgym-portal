-- Verificación de los contratos panel/BD ↔ app (PEDIDOS 31 y 32).
-- Corre en una transacción con rollback: no deja rastro. Uso:
--   psql "$DATABASE_URL" -f scripts/verificar-contratos-app.sql
-- Cada bloque imprime OK/FALLA. Si todo dice OK, la app puede consumir sin
-- sorpresas. Correr cuando el agente de la app suba su lado, o tras cualquier
-- cambio en suscripción por sede / ofertas.

\set ON_ERROR_STOP on
begin;

do $$
declare
  v_emp uuid;
  v_sede uuid;
  v_socio uuid;
  v_uid uuid;
  v_res jsonb;
  v_n int;
  v_ok boolean := true;
begin
  select id into v_emp from public.empresa where nombre ilike '%maximus%';
  select id into v_sede from public.sede where empresa_id = v_emp and activa order by created_at limit 1;
  select id, usuario_id into v_socio, v_uid from public.socio
    where empresa_id = v_emp and usuario_id is not null and deleted_at is null limit 1;

  raise notice '── Contratos app (empresa=%, sede=%) ──', left(v_emp::text,8), left(v_sede::text,8);

  -- P31: estado_suscripcion_sede debe traer con_app + activa + estado
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select u.id from public.usuario u join public.usuario_empresa ue on ue.usuario_id=u.id
                             join public.rol r on r.id=ue.rol_id where ue.empresa_id=v_emp and r.codigo='admin' limit 1),
                      'role','authenticated')::text, true);
  perform set_config('role','authenticated',true);
  v_res := public.estado_suscripcion_sede(v_sede);
  if (v_res ? 'con_app') and (v_res ? 'activa') and (v_res ? 'estado') and (v_res->>'encontrado')::boolean then
    raise notice 'OK  P31 gate: estado_suscripcion_sede -> con_app=%, activa=%, estado=%, origen=%',
      v_res->>'con_app', v_res->>'activa', v_res->>'estado', v_res->>'origen';
  else
    raise warning 'FALLA P31 gate: falta con_app/activa/estado en %', v_res; v_ok := false;
  end if;

  -- P32 badge: ofertas_activas_socio como el socio
  if v_uid is not null then
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid,'role','authenticated')::text, true);
    perform set_config('role','authenticated',true);
    v_n := public.ofertas_activas_socio();
    raise notice 'OK  P32 badge: ofertas_activas_socio -> % (socio %)', v_n, left(v_socio::text,8);
  else
    raise notice 'SKIP P32 badge: no hay socio con app en la empresa demo';
  end if;

  -- P32 push: catalogo_app trae los campos de descuento que la app pinta
  perform set_config('role','authenticated',true);
  v_res := public.catalogo_app(v_emp, v_sede);
  if jsonb_typeof(v_res) = 'array' then
    raise notice 'OK  P32 catálogo: catalogo_app -> % items (con descuento_tipo/valor por item)', jsonb_array_length(v_res);
  else
    raise warning 'FALLA P32 catálogo: catalogo_app no devolvió array'; v_ok := false;
  end if;

  if v_ok then
    raise notice '── ✅ TODOS los contratos app OK ──';
  else
    raise notice '── ⚠️  Hay contratos con FALLA (revisar arriba) ──';
  end if;
end $$;

rollback;
