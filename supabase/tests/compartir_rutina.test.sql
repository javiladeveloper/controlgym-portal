-- Pruebas de "compartir rutina por enlace".
-- Uso:
--   psql "$DBURL" -f supabase/tests/compartir_rutina.test.sql
-- Todo va dentro de begin/rollback: NO modifica datos reales.
\set ON_ERROR_STOP on
begin;

-- Datos de prueba propios (no se depende de datos reales, que cambian).
--
-- OJO: `public.usuario.id` tiene FK a `auth.users`, así que NO se puede insertar
-- directamente ahí — hay que crear primero el usuario de auth. Un trigger crea
-- solo la fila de `public.usuario`, y después se le ajusta el nombre.
-- (Verificado contra prod: insertar en public.usuario a secas falla con
-- "violates foreign key constraint usuario_id_fkey".)
insert into auth.users (id, email, instance_id, aud, role)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'ana.test@fitcore.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.usuario set nombre = 'Ana Probadora'
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

insert into auth.users (id, email, instance_id, aud, role)
values ('bbbbbbbb-0000-4000-8000-000000000002', 'beto.test@fitcore.test',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.usuario set nombre = 'Beto Ajeno'
 where id = 'bbbbbbbb-0000-4000-8000-000000000002';

insert into public.rutina_libre (id, usuario_id, nombre, activa)
values ('cccccccc-0000-4000-8000-000000000003',
        'aaaaaaaa-0000-4000-8000-000000000001', 'Rutina de Ana', true);
insert into public.rutina_libre_dia (id, rutina_libre_id, dia_semana, foco)
values ('dddddddd-0000-4000-8000-000000000004',
        'cccccccc-0000-4000-8000-000000000003', 1, 'Pecho');
insert into public.rutina_libre_ejercicio
  (rutina_libre_dia_id, nombre, series, reps, descanso, orden)
values ('dddddddd-0000-4000-8000-000000000004', 'press banca', 4, '8-12', '90s', 1);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','role','authenticated')::text, true);

-- CASO 1: compartir devuelve token de 8 caracteres y url que lo contiene
do $$
declare r jsonb;
begin
  r := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003');
  assert length(r->>'token') = 8,
    'CASO 1 FALLA: el token no mide 8 caracteres, mide ' || length(r->>'token');
  assert r->>'url' like '%/r/' || (r->>'token'),
    'CASO 1 FALLA: la url no contiene el token: ' || (r->>'url');
  raise notice 'CASO 1 OK: token y url correctos';
end $$;

-- CASO 2: compartir DOS VECES devuelve el MISMO token (idempotencia)
do $$
declare t1 text; t2 text;
begin
  t1 := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  t2 := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  assert t1 = t2,
    'CASO 2 FALLA: cada llamada genera un token nuevo (' || t1 || ' vs ' || t2 ||
    '), el enlace ya compartido quedaría huérfano';
  raise notice 'CASO 2 OK: idempotente';
end $$;

-- CASO 3: el contenido congelado trae los días y ejercicios
do $$
declare r jsonb; t text;
begin
  t := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  r := public.ver_rutina_compartida(t);
  assert (r->>'dias')::int = 1, 'CASO 3 FALLA: esperaba 1 día, llegó ' || (r->>'dias');
  assert r->'contenido'->0->>'foco' = 'Pecho', 'CASO 3 FALLA: el foco no viaja';
  assert r->'contenido'->0->'ejercicios'->0->>'nombre' = 'press banca',
    'CASO 3 FALLA: los ejercicios no viajan';
  assert r->>'autor' = 'Ana', 'CASO 3 FALLA: autor esperado Ana, llegó ' || (r->>'autor');
  raise notice 'CASO 3 OK: contenido y autor correctos';
end $$;

-- CASO 4: cada apertura incrementa el contador
do $$
declare t text; antes int; despues int;
begin
  t := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  select aperturas into antes from public.rutina_compartida where token = t;
  perform public.ver_rutina_compartida(t);
  select aperturas into despues from public.rutina_compartida where token = t;
  assert despues = antes + 1,
    'CASO 4 FALLA: aperturas no subió (' || antes || ' -> ' || despues || ')';
  raise notice 'CASO 4 OK: cuenta aperturas';
end $$;

-- CASO 5: ver funciona SIN SESIÓN (rol anon) — el núcleo de la feature
do $$
declare t text; r jsonb;
begin
  t := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  set local role anon;
  r := public.ver_rutina_compartida(t);
  assert r->>'nombre' = 'Rutina de Ana',
    'CASO 5 FALLA: anon no pudo leer la rutina compartida';
  raise notice 'CASO 5 OK: la página pública puede leer sin sesión';
end $$;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','role','authenticated')::text, true);

-- CASO 6: compartir una rutina AJENA debe fallar
do $$ begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','bbbbbbbb-0000-4000-8000-000000000002','role','authenticated')::text, true);
  perform public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003');
  raise exception 'CASO 6 FALLA: Beto compartió la rutina de Ana';
exception
  when sqlstate 'P0001' then
    if sqlerrm not like '%no es tuya%' then raise; end if;
    raise notice 'CASO 6 OK: no se puede compartir una rutina ajena';
end $$;

-- CASO 7: token inexistente falla con mensaje claro
do $$ begin
  perform public.ver_rutina_compartida('noexiste');
  raise exception 'CASO 7 FALLA: un token inventado devolvió datos';
exception
  when sqlstate 'P0001' then
    if sqlerrm not like '%no está disponible%' then raise; end if;
    raise notice 'CASO 7 OK: token inexistente rechazado';
end $$;

-- CASO 8: un enlace REVOCADO deja de funcionar
do $$
declare t text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','role','authenticated')::text, true);
  t := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  perform public.revocar_rutina_compartida(t);
  begin
    perform public.ver_rutina_compartida(t);
    raise exception 'CASO 8 FALLA: un enlace revocado sigue abriendo';
  exception
    when sqlstate 'P0001' then
      if sqlerrm not like '%no está disponible%' then raise; end if;
      raise notice 'CASO 8 OK: enlace revocado bloqueado';
  end;
end $$;

-- CASO 9: revocar un enlace AJENO debe fallar
do $$
declare t text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','role','authenticated')::text, true);
  t := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  perform set_config('request.jwt.claims',
    json_build_object('sub','bbbbbbbb-0000-4000-8000-000000000002','role','authenticated')::text, true);
  begin
    perform public.revocar_rutina_compartida(t);
    raise exception 'CASO 9 FALLA: Beto revocó el enlace de Ana';
  exception
    when sqlstate 'P0001' then
      if sqlerrm not like '%no es tuyo%' then raise; end if;
      raise notice 'CASO 9 OK: no se puede revocar un enlace ajeno';
  end;
end $$;

-- CASO 10: un usuario NO puede leer por SELECT directo lo compartido por otro
do $$
declare n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','bbbbbbbb-0000-4000-8000-000000000002','role','authenticated')::text, true);
  select count(*) into n from public.rutina_compartida
   where usuario_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  assert n = 0,
    'CASO 10 FALLA: Beto ve ' || n || ' enlaces de Ana por SELECT directo (RLS rota)';
  raise notice 'CASO 10 OK: la RLS aísla; la RPC es la única puerta';
end $$;

rollback;
