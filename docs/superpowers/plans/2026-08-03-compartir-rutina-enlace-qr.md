# Compartir una rutina por enlace y QR — Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development
> (recomendado) o superpowers:executing-plans para ejecutar este plan tarea a
> tarea. Los pasos usan checkbox (`- [ ]`) para llevar el control.

**Objetivo:** que alguien pueda pasarle su rutina a otra persona por enlace o
QR, sin publicarla a toda la comunidad — y que quien la reciba sin la app vea la
rutina en una página web con botón de descarga.

**Arquitectura:** una tabla `rutina_compartida` guarda una COPIA CONGELADA de la
rutina en JSON, identificada por un token aleatorio de 8 caracteres. La página
pública lee esa única tabla por una RPC accesible sin sesión (`anon`), así no
toca la RLS de las tablas de rutinas. El QR es el mismo enlace en código.

**Stack:** Supabase/Postgres (migraciones por psql), app KMP/Compose
(`controlgym-app`), panel React/Vite (`ControlGym`).

**Spec:** `docs/superpowers/specs/2026-08-03-compartir-rutina-enlace-qr-design.md`

## Global Constraints

Aplican a TODAS las tareas:

- **Migraciones:** verificar SIEMPRE en `begin; … rollback;` contra prod ANTES de
  aplicar, con **varios casos, no uno**. Solo el controlador aplica a prod, nunca
  un subagente.
- **Aplicar:** `psql "$DBURL" -q -v ON_ERROR_STOP=1 -f <archivo>.sql`. Sin
  `ON_ERROR_STOP=1` psql sigue tras un error y deja la BD a medias.
- **Conexión:** `DATABASE_URL` de `vercel env pull`, sustituyendo
  `sslmode=no-verify` por `sslmode=require` (psql no acepta `no-verify`).
- **RPC:** `security definer set search_path = public`, `revoke all from public`
  + `grant execute to authenticated` (y a `anon` SOLO donde el spec lo pide).
  Ojo: `revoke from public` NO protege nada en este repo.
- **Cambiar la firma de una función = `drop function` de la vieja EN LA MISMA
  migración** (una sobrecarga rompe PostgREST con "function is not unique").
- **Nunca `DELETE`/`UPDATE` sin `WHERE`** (PostgREST los rechaza con `safeupdate`).
- **El shape del JSON debe coincidir EXACTO con los `@SerialName` de Kotlin.** Un
  desajuste compila, no lanza error y la pantalla queda vacía.
- **La lógica probable va en funciones puras**, no dentro de componentes de UI.
- **App:** compilar Android **e** iOS (`:composeApp:compileDebugKotlinAndroid` y
  `:composeApp:compileKotlinIosArm64`). No correr gradle si el owner está
  compilando en Android Studio.
- **Panel:** `npm test` y `npm run build` limpios antes de commitear.
- **URL pública:** `https://fitcorecenter.com/r/<token>`. **Deep link:**
  `fitcore://rutina?token=<token>`.

---

## Estructura de archivos

**Tarea 1** (BD + su test):
- Crear: `supabase/migrations/20260804100000_compartir_rutina.sql`
- Crear: `supabase/tests/compartir_rutina.test.sql` ← primer test de SQL del repo

**Tarea 2** (panel — lógica pura + tests):
- Crear: `src/lib/compartir.js`
- Crear: `tests/compartir-rutina.test.js`

**Tarea 3** (panel — página pública):
- Crear: `src/pages/RutinaCompartida.jsx`
- Modificar: `src/main.jsx` (enrutar `/r/<token>`)

**Tarea 4** (app — modelo + test + repositorio):
- Modificar: `composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaLibreRepositorio.kt`
- Crear: `composeApp/src/commonTest/kotlin/pe/fitcore/app/data/modelos/CompartirRutinaTest.kt`

**Tarea 5** (app — UI de compartir con QR):
- Crear: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/DialogoCompartirRutina.kt`
- Modificar: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt`
- Modificar: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/RutinaLibreViewModel.kt`

**Tarea 6** (app — recibir el deep link):
- Modificar: `composeApp/src/androidMain/AndroidManifest.xml`
- Modificar: `composeApp/src/androidMain/kotlin/pe/fitcore/app/MainActivity.kt`
- Modificar: `composeApp/src/commonMain/kotlin/pe/fitcore/app/core/NavegacionPush.kt`

---

### Task 1: Backend — tabla, RPCs y el primer test de SQL del repo

**Files:**
- Create: `supabase/migrations/20260804100000_compartir_rutina.sql`
- Create: `supabase/tests/compartir_rutina.test.sql`

**Interfaces:**
- Consumes: `rutina_libre`, `rutina_libre_dia`, `rutina_libre_ejercicio`, `usuario` (ya existen)
- Produces:
  - `compartir_mi_rutina(p_rutina_libre uuid) → jsonb {ok, token, url}`
  - `ver_rutina_compartida(p_token text) → jsonb {nombre, autor, dias, contenido}`
  - `revocar_rutina_compartida(p_token text) → jsonb {ok}`

- [ ] **Paso 1: escribir la migración**

Crear `supabase/migrations/20260804100000_compartir_rutina.sql`:

```sql
-- Compartir una rutina propia por enlace/QR sin publicarla a la comunidad.
--
-- El contenido se guarda CONGELADO en jsonb: si el autor edita su rutina, quien
-- ya abrió el enlace no ve cambiar el plan bajo sus pies. Además, así la página
-- pública lee UNA tabla y no cinco con permisos de invitado.
--
-- El token es aleatorio y NO el id de la rutina: con el id, cualquiera podría
-- probar identificadores para leer rutinas ajenas.
create table if not exists public.rutina_compartida (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  -- set null: si el autor borra su rutina, el enlace ya compartido sigue
  -- funcionando (el contenido está congelado aquí, no allá).
  rutina_libre_id uuid references public.rutina_libre(id) on delete set null,
  nombre text not null,
  contenido jsonb not null,
  activo boolean not null default true,
  aperturas int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists rutina_compartida_usuario_idx
  on public.rutina_compartida(usuario_id);

alter table public.rutina_compartida enable row level security;

-- El autor ve las suyas (para poder revocarlas). NADIE más lee esta tabla
-- directamente: la página pública entra por la RPC `security definer`, así un
-- invitado no puede enumerar tokens ni listar lo que comparten otros.
drop policy if exists rutina_compartida_propia on public.rutina_compartida;
create policy rutina_compartida_propia on public.rutina_compartida
  for select to authenticated
  using (usuario_id = (select auth.uid()));

-- Token corto y legible: sin caracteres ambiguos (0/O, 1/l) porque la gente los
-- dicta y los teclea. 8 caracteres de este alfabeto ≈ 2.8 billones de valores.
create or replace function public.generar_token_compartir()
returns text
language sql
volatile
as $$
  select string_agg(
    substr('23456789abcdefghijkmnpqrstuvwxyz', (get_byte(gen_random_bytes(1), 0) % 32) + 1, 1),
    ''
  )
  from generate_series(1, 8);
$$;

-- Comparte la rutina y devuelve el enlace.
create or replace function public.compartir_mi_rutina(p_rutina_libre uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rl record;
  v_token text;
  v_contenido jsonb;
  v_existente record;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  select * into v_rl from public.rutina_libre
   where id = p_rutina_libre and usuario_id = v_uid;
  if not found then raise exception 'Esa rutina no es tuya'; end if;

  -- IDEMPOTENTE: si ya se compartió y sigue activa, se devuelve el MISMO
  -- enlace. Sin esto, cada toque del botón generaría un token nuevo y el que
  -- la persona ya mandó por WhatsApp quedaría huérfano.
  select * into v_existente from public.rutina_compartida
   where rutina_libre_id = p_rutina_libre and usuario_id = v_uid and activo
   limit 1;
  if found then
    return jsonb_build_object(
      'ok', true, 'token', v_existente.token,
      'url', 'https://fitcorecenter.com/r/' || v_existente.token
    );
  end if;

  if not exists (
    select 1 from public.rutina_libre_dia d
    join public.rutina_libre_ejercicio e on e.rutina_libre_dia_id = d.id
    where d.rutina_libre_id = p_rutina_libre
  ) then
    raise exception 'Tu rutina no tiene ejercicios todavía';
  end if;

  -- Copia congelada: días con su foco y sus ejercicios.
  select coalesce(jsonb_agg(dd order by dd.dia_semana), '[]'::jsonb)
    into v_contenido
  from (
    select d.dia_semana, d.foco,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'nombre', e.nombre, 'series', e.series,
               'reps', e.reps, 'descanso', e.descanso
             ) order by e.orden)
             from public.rutina_libre_ejercicio e
             where e.rutina_libre_dia_id = d.id
           ), '[]'::jsonb) as ejercicios
    from public.rutina_libre_dia d
    where d.rutina_libre_id = p_rutina_libre
  ) dd;

  -- Reintento por si el token choca (improbable, pero el unique lo haría fallar).
  for i in 1..5 loop
    v_token := public.generar_token_compartir();
    exit when not exists (select 1 from public.rutina_compartida where token = v_token);
  end loop;

  insert into public.rutina_compartida
    (token, usuario_id, rutina_libre_id, nombre, contenido)
  values (
    v_token, v_uid, p_rutina_libre,
    coalesce(nullif(trim(v_rl.nombre), ''), 'Rutina de FitCore'),
    v_contenido
  );

  return jsonb_build_object(
    'ok', true, 'token', v_token,
    'url', 'https://fitcorecenter.com/r/' || v_token
  );
end;
$function$;

revoke all on function public.compartir_mi_rutina(uuid) from public;
grant execute on function public.compartir_mi_rutina(uuid) to authenticated;

-- Lee una rutina compartida. SIN SESIÓN: es lo que hace funcionar la página web
-- para quien todavía no tiene la app (que es el caso que se quiere captar).
create or replace function public.ver_rutina_compartida(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rc record; v_autor text;
begin
  select * into v_rc from public.rutina_compartida
   where token = p_token and activo;
  if not found then
    raise exception 'Este enlace ya no está disponible';
  end if;

  select coalesce(u.nombre_publico, split_part(u.nombre, ' ', 1))
    into v_autor
  from public.usuario u where u.id = v_rc.usuario_id;

  update public.rutina_compartida
     set aperturas = aperturas + 1
   where id = v_rc.id;

  return jsonb_build_object(
    'nombre', v_rc.nombre,
    'autor', coalesce(v_autor, 'un usuario de FitCore'),
    'dias', jsonb_array_length(v_rc.contenido),
    'contenido', v_rc.contenido
  );
end;
$function$;

revoke all on function public.ver_rutina_compartida(text) from public;
grant execute on function public.ver_rutina_compartida(text) to authenticated;
-- El grant a anon es DELIBERADO y es el núcleo de la feature: sin él la página
-- pública no puede leer nada y el enlace solo sirve a quien ya tiene cuenta.
grant execute on function public.ver_rutina_compartida(text) to anon;

-- Apaga un enlace sin borrar la rutina.
create or replace function public.revocar_rutina_compartida(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  update public.rutina_compartida
     set activo = false
   where token = p_token and usuario_id = v_uid and activo;
  if not found then raise exception 'Ese enlace no es tuyo o ya estaba revocado'; end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.revocar_rutina_compartida(text) from public;
grant execute on function public.revocar_rutina_compartida(text) to authenticated;
```

- [ ] **Paso 2: escribir el test de SQL (el primero del repo)**

Crear `supabase/tests/compartir_rutina.test.sql`. Corre entero dentro de una
transacción con `rollback`, así que se puede lanzar contra producción sin tocar
datos. Cada caso usa `assert`, que aborta ruidosamente si falla:

```sql
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
  select set_config('request.jwt.claims',
    json_build_object('sub','bbbbbbbb-0000-4000-8000-000000000002','role','authenticated')::text, true);
  perform public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003');
  raise exception 'CASO 6 FALLA: Beto compartió la rutina de Ana';
exception
  when sqlstate 'P0001' and sqlerrm like '%no es tuya%' then
    raise notice 'CASO 6 OK: no se puede compartir una rutina ajena';
end $$;

-- CASO 7: token inexistente falla con mensaje claro
do $$ begin
  perform public.ver_rutina_compartida('noexiste');
  raise exception 'CASO 7 FALLA: un token inventado devolvió datos';
exception
  when sqlstate 'P0001' and sqlerrm like '%no está disponible%' then
    raise notice 'CASO 7 OK: token inexistente rechazado';
end $$;

-- CASO 8: un enlace REVOCADO deja de funcionar
do $$
declare t text;
begin
  select set_config('request.jwt.claims',
    json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','role','authenticated')::text, true);
  t := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  perform public.revocar_rutina_compartida(t);
  begin
    perform public.ver_rutina_compartida(t);
    raise exception 'CASO 8 FALLA: un enlace revocado sigue abriendo';
  exception
    when sqlstate 'P0001' and sqlerrm like '%no está disponible%' then
      raise notice 'CASO 8 OK: enlace revocado bloqueado';
  end;
end $$;

-- CASO 9: revocar un enlace AJENO debe fallar
do $$
declare t text;
begin
  select set_config('request.jwt.claims',
    json_build_object('sub','aaaaaaaa-0000-4000-8000-000000000001','role','authenticated')::text, true);
  t := public.compartir_mi_rutina('cccccccc-0000-4000-8000-000000000003')->>'token';
  select set_config('request.jwt.claims',
    json_build_object('sub','bbbbbbbb-0000-4000-8000-000000000002','role','authenticated')::text, true);
  begin
    perform public.revocar_rutina_compartida(t);
    raise exception 'CASO 9 FALLA: Beto revocó el enlace de Ana';
  exception
    when sqlstate 'P0001' and sqlerrm like '%no es tuyo%' then
      raise notice 'CASO 9 OK: no se puede revocar un enlace ajeno';
  end;
end $$;

-- CASO 10: un usuario NO puede leer por SELECT directo lo compartido por otro
do $$
declare n int;
begin
  select set_config('request.jwt.claims',
    json_build_object('sub','bbbbbbbb-0000-4000-8000-000000000002','role','authenticated')::text, true);
  select count(*) into n from public.rutina_compartida
   where usuario_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  assert n = 0,
    'CASO 10 FALLA: Beto ve ' || n || ' enlaces de Ana por SELECT directo (RLS rota)';
  raise notice 'CASO 10 OK: la RLS aísla; la RPC es la única puerta';
end $$;

rollback;
```

- [ ] **Paso 3: correr el test — debe FALLAR (la migración aún no se aplicó)**

```bash
ENVF=".../scratchpad/.env.prod"
DBURL=$(grep -E "^DATABASE_URL=" "$ENVF" | head -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//' \
        | sed 's/sslmode=no-verify/sslmode=require/')
psql "$DBURL" -f supabase/tests/compartir_rutina.test.sql
```

Esperado: FALLA con `function public.compartir_mi_rutina(uuid) does not exist`.
Esto confirma que el test prueba algo real y no pasa por casualidad.

- [ ] **Paso 4: verificar la migración en rollback y correr el test dentro**

```bash
psql "$DBURL" -q <<SQL
begin;
\i 'supabase/migrations/20260804100000_compartir_rutina.sql'
\i 'supabase/tests/compartir_rutina.test.sql'
SQL
```

Nota: el test trae su propio `begin`/`rollback`; al ejecutarlo así el `rollback`
interno cierra la transacción, que es justo lo que se quiere (no persiste nada).

Esperado: los 10 casos imprimen `CASO N OK`.

- [ ] **Paso 5: aplicar a prod (CHECKPOINT — confirmar con el owner antes)**

```bash
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f 'supabase/migrations/20260804100000_compartir_rutina.sql' \
  && echo "APLICADA OK"
```

- [ ] **Paso 6: correr el test contra prod ya aplicada**

```bash
psql "$DBURL" -f supabase/tests/compartir_rutina.test.sql
```

Esperado: los 10 casos `OK`. Como el test hace `rollback`, prod queda intacta.

- [ ] **Paso 7: verificar firmas y permisos**

```bash
psql "$DBURL" -c "select p.oid::regprocedure as firma,
  has_function_privilege('authenticated', p.oid,'execute') as auth,
  has_function_privilege('anon', p.oid,'execute') as anon
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('compartir_mi_rutina','ver_rutina_compartida','revocar_rutina_compartida')
order by 1;"
```

Esperado: una firma por nombre; `auth = t` en las tres; **`anon = t` SOLO en
`ver_rutina_compartida`** (si `anon` sale `t` en `compartir_mi_rutina`, cualquiera
sin cuenta podría crear enlaces: eso sería un fallo grave).

- [ ] **Paso 8: commit**

```bash
git add supabase/migrations/20260804100000_compartir_rutina.sql supabase/tests/compartir_rutina.test.sql
git commit -m "feat(compartir): tabla, RPCs y test SQL de rutina compartida"
```

### Task 2: Panel — lógica pura del enlace, con tests

**Files:**
- Create: `src/lib/compartir.js`
- Create: `tests/compartir-rutina.test.js`

**Interfaces:**
- Consumes: nada (funciones puras)
- Produces: `urlCompartir(token)`, `tokenDesdeRuta(pathname)`, `diasOrdenados(contenido)`

- [ ] **Paso 1: escribir el test que falla**

Crear `tests/compartir-rutina.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { urlCompartir, tokenDesdeRuta, diasOrdenados } from '../src/lib/compartir.js'

describe('urlCompartir', () => {
  it('arma la url pública con el token', () => {
    expect(urlCompartir('a7k2m9x3')).toBe('https://fitcorecenter.com/r/a7k2m9x3')
  })
})

describe('tokenDesdeRuta', () => {
  it('extrae el token de /r/<token>', () => {
    expect(tokenDesdeRuta('/r/a7k2m9x3')).toBe('a7k2m9x3')
  })

  it('devuelve null si la ruta no es de compartir', () => {
    expect(tokenDesdeRuta('/planes')).toBeNull()
  })

  // Sin esto la página llamaría a la RPC con una cadena vacía y mostraría un
  // error feo en vez de un "enlace no válido".
  it('devuelve null si /r/ viene sin token', () => {
    expect(tokenDesdeRuta('/r/')).toBeNull()
    expect(tokenDesdeRuta('/r')).toBeNull()
  })

  it('ignora una barra final', () => {
    expect(tokenDesdeRuta('/r/a7k2m9x3/')).toBe('a7k2m9x3')
  })
})

describe('diasOrdenados', () => {
  const contenido = [
    { dia_semana: 2, foco: 'Espalda', ejercicios: [{ nombre: 'remo' }] },
    { dia_semana: 1, foco: 'Pecho', ejercicios: [{ nombre: 'press' }] },
  ]

  it('ordena los días por dia_semana', () => {
    expect(diasOrdenados(contenido).map((d) => d.foco)).toEqual(['Pecho', 'Espalda'])
  })

  it('una rutina sin días devuelve lista vacía en vez de reventar', () => {
    expect(diasOrdenados(null)).toEqual([])
    expect(diasOrdenados([])).toEqual([])
  })

  it('un día sin ejercicios no rompe', () => {
    const conVacio = [{ dia_semana: 1, foco: 'Descanso', ejercicios: [] }]
    expect(diasOrdenados(conVacio)[0].ejercicios).toEqual([])
  })
})
```

- [ ] **Paso 2: correr el test — debe fallar**

```bash
cd "d:/Personal Proyects/ControlGym"
npx vitest run tests/compartir-rutina.test.js
```

Esperado: FALLA con `Failed to resolve import "../src/lib/compartir.js"`.

- [ ] **Paso 3: implementar**

Crear `src/lib/compartir.js`:

```js
// Lógica del enlace de rutina compartida. Funciones PURAS a propósito: la
// página solo llama y pinta, así esto se prueba sin montar componentes.

/** Dominio público de FitCore (el mismo que usa el enlace que se comparte). */
const BASE = 'https://fitcorecenter.com'

/** URL pública que se comparte (y que se convierte en QR). */
export function urlCompartir(token) {
  return `${BASE}/r/${token}`
}

/**
 * Token de una ruta `/r/<token>`, o null si la ruta no es de compartir.
 * Devolver null en vez de cadena vacía es deliberado: así la página distingue
 * "esta ruta no es mía" de "enlace inválido" sin llamar a la RPC con basura.
 */
export function tokenDesdeRuta(pathname) {
  const m = /^\/r\/([^/]+)\/?$/.exec(pathname || '')
  return m ? m[1] : null
}

/**
 * Días de la rutina ordenados para pintar. Defensivo con null y con días sin
 * ejercicios: el contenido viene de un jsonb congelado que puede ser de una
 * versión anterior del formato.
 */
export function diasOrdenados(contenido) {
  if (!Array.isArray(contenido)) return []
  return [...contenido].sort((a, b) => (a.dia_semana ?? 0) - (b.dia_semana ?? 0))
}
```

- [ ] **Paso 4: correr el test — debe pasar**

```bash
npx vitest run tests/compartir-rutina.test.js
```

Esperado: todos los tests en verde.

- [ ] **Paso 5: correr la suite entera y el build**

```bash
npm test
npm run build
```

Esperado: los 83 tests previos + los nuevos, todos pasando, y build limpio.

- [ ] **Paso 6: commit**

```bash
git add src/lib/compartir.js tests/compartir-rutina.test.js
git commit -m "feat(compartir): lógica pura del enlace + tests"
```

### Task 3: Panel — página pública `/r/<token>`

**Files:**
- Create: `src/pages/RutinaCompartida.jsx`
- Modify: `src/main.jsx`

**Interfaces:**
- Consumes: `urlCompartir`, `tokenDesdeRuta`, `diasOrdenados` (Task 2);
  `ver_rutina_compartida(p_token)` (Task 1)
- Produces: la ruta `/r/<token>` renderizada sin sesión

- [ ] **Paso 1: crear la página**

Crear `src/pages/RutinaCompartida.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { tokenDesdeRuta, diasOrdenados } from '../lib/compartir.js'

// Los mismos enlaces de tienda que usa el landing (PlataformaLanding.jsx).
const PLAY = 'https://play.google.com/store/apps/details?id=pe.fitcore.app'
const APPSTORE = 'https://apps.apple.com/pe/app/fitcore-gym/id6788892159'

/**
 * Página pública de una rutina compartida (`/r/<token>`). Se ve SIN sesión: es
 * el caso que la feature quiere captar — alguien recibe el enlace por WhatsApp,
 * no tiene la app, y aquí ve qué le compartieron y de dónde bajarla.
 */
export default function RutinaCompartida() {
  const [estado, setEstado] = useState({ cargando: true, error: null, datos: null })

  useEffect(() => {
    const token = tokenDesdeRuta(window.location.pathname)
    if (!token) {
      setEstado({ cargando: false, error: 'Este enlace no es válido.', datos: null })
      return
    }
    supabase.rpc('ver_rutina_compartida', { p_token: token }).then(({ data, error }) => {
      if (error) {
        setEstado({ cargando: false, error: 'Este enlace ya no está disponible.', datos: null })
      } else {
        setEstado({ cargando: false, error: null, datos: data })
      }
    })
  }, [])

  if (estado.cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F1420] text-white">
        <p className="text-[14px] font-semibold opacity-70">Cargando rutina…</p>
      </div>
    )
  }

  if (estado.error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0F1420] px-6 text-center text-white">
        <div className="text-[42px]">🔗</div>
        <h1 className="text-[20px] font-extrabold">{estado.error}</h1>
        <p className="max-w-[340px] text-[13.5px] font-semibold opacity-70">
          Puede que quien te lo compartió lo haya desactivado.
        </p>
        <a href="https://fitcorecenter.com"
          className="mt-2 rounded-xl bg-[#FF6B35] px-5 py-3 text-[14px] font-extrabold text-white">
          Conocer FitCore
        </a>
      </div>
    )
  }

  const { nombre, autor, contenido } = estado.datos
  const dias = diasOrdenados(contenido)

  return (
    <div className="min-h-screen bg-[#0F1420] px-5 py-8 text-white">
      <div className="mx-auto max-w-[560px]">
        <p className="text-[12px] font-bold uppercase tracking-wide opacity-60">
          Rutina compartida por {autor}
        </p>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.5px]">{nombre}</h1>
        <p className="mt-1 text-[13px] font-semibold opacity-70">
          {dias.length} {dias.length === 1 ? 'día' : 'días'} de entrenamiento
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {dias.map((d) => (
            <div key={d.dia_semana}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#FF6B35]">
                Día {d.dia_semana}
              </p>
              <p className="mt-0.5 text-[15px] font-extrabold">{d.foco || 'Entrenamiento'}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {(d.ejercicios || []).map((e, i) => (
                  <li key={i} className="text-[13.5px] font-semibold opacity-85">
                    {e.nombre}
                    {e.series && e.reps && (
                      <span className="opacity-60"> · {e.series} series · {e.reps} reps</span>
                    )}
                  </li>
                ))}
                {(d.ejercicios || []).length === 0 && (
                  <li className="text-[13px] font-semibold opacity-50">Descanso</li>
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-[#FF6B35]/30 bg-[#FF6B35]/10 p-5 text-center">
          <p className="text-[15px] font-extrabold">Entrena con esta rutina</p>
          <p className="mx-auto mt-1 max-w-[320px] text-[13px] font-semibold opacity-75">
            Descarga FitCore gratis, guarda esta rutina y lleva tu progreso.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <a href={PLAY} target="_blank" rel="noopener noreferrer"
              className="rounded-xl bg-black px-4 py-2.5 text-[13px] font-extrabold">
              Google Play
            </a>
            <a href={APPSTORE} target="_blank" rel="noopener noreferrer"
              className="rounded-xl bg-black px-4 py-2.5 text-[13px] font-extrabold">
              App Store
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-[11.5px] font-semibold opacity-45">
          Rutina creada por un usuario de FitCore, no revisada por un profesional.
          Consulta a tu médico antes de empezar.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Paso 2: enrutarla en main.jsx**

En `src/main.jsx`, junto a las otras rutas públicas (`esDemo`, `esPlanes`),
añadir el import y la condición:

```js
const RutinaCompartida = lazy(() => import('./pages/RutinaCompartida.jsx'))
```

```js
const tokenCompartido = tokenDesdeRuta(window.location.pathname)
```

con `import { tokenDesdeRuta } from './lib/compartir.js'` arriba, y la rama
ANTES de las demás (una rutina compartida se ve en cualquier host):

```js
if (tokenCompartido) {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
        <RutinaCompartida />
      </Suspense>
    </React.StrictMode>,
  )
} else if (isPlataformaHome()) {
```

- [ ] **Paso 3: tests y build**

```bash
npm test
npm run build
```

Esperado: todos los tests pasando y build limpio.

- [ ] **Paso 4: comprobar en el navegador**

```bash
npm run preview -- --port 4180
```

Abrir `http://localhost:4180/r/<token>` con un token real (creado en el Paso 6 de
la Task 1, o generado a mano por psql). Debe verse la rutina **sin iniciar
sesión**. Con `/r/inventado` debe verse el mensaje de enlace no disponible.

- [ ] **Paso 5: commit**

```bash
git add src/pages/RutinaCompartida.jsx src/main.jsx
git commit -m "feat(compartir): página pública /r/<token>"
```

### Task 4: App — modelo, test de deserialización y repositorio

**Files:**
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaLibreRepositorio.kt`
- Create: `composeApp/src/commonTest/kotlin/pe/fitcore/app/data/modelos/CompartirRutinaTest.kt`

**Interfaces:**
- Consumes: `compartir_mi_rutina`, `ver_rutina_compartida` (Task 1)
- Produces: `EnlaceCompartido`, `RutinaCompartidaVista`, `DiaCompartido`,
  `EjercicioCompartido`, `tokenDeDeepLink(url)`, y en el repositorio
  `compartir(rutinaId)` / `verCompartida(token)`

- [ ] **Paso 1: escribir el test que falla**

Crear `composeApp/src/commonTest/kotlin/pe/fitcore/app/data/modelos/CompartirRutinaTest.kt`:

```kotlin
package pe.fitcore.app.data.modelos

import kotlinx.serialization.json.Json
import pe.fitcore.app.data.repositorio.EnlaceCompartido
import pe.fitcore.app.data.repositorio.RutinaCompartidaVista
import pe.fitcore.app.data.repositorio.tokenDeDeepLink
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Estos tests existen por una razón concreta: en este proyecto un `@SerialName`
 * que no cuadra con el JSON del backend COMPILA, no lanza error y deja la
 * pantalla vacía sin ninguna pista. Ya pasó tres veces. Aquí se pega el JSON
 * REAL de las RPC y se comprueba que el modelo lo entiende.
 */
class CompartirRutinaTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun deserializaLaRespuestaDeCompartir() {
        // JSON real de `compartir_mi_rutina`.
        val crudo = """{"ok":true,"token":"a7k2m9x3","url":"https://fitcorecenter.com/r/a7k2m9x3"}"""
        val r = json.decodeFromString<EnlaceCompartido>(crudo)
        assertEquals("a7k2m9x3", r.token)
        assertEquals("https://fitcorecenter.com/r/a7k2m9x3", r.url)
    }

    @Test
    fun deserializaLaRutinaCompartida() {
        // JSON real de `ver_rutina_compartida`.
        val crudo = """
        {"nombre":"Rutina de Ana","autor":"Ana","dias":2,
         "contenido":[
           {"dia_semana":1,"foco":"Pecho","ejercicios":[
             {"nombre":"press banca","series":4,"reps":"8-12","descanso":"90s"}]},
           {"dia_semana":2,"foco":"Espalda","ejercicios":[]}
         ]}
        """.trimIndent()
        val r = json.decodeFromString<RutinaCompartidaVista>(crudo)
        assertEquals("Rutina de Ana", r.nombre)
        assertEquals("Ana", r.autor)
        assertEquals(2, r.contenido.size)
        assertEquals(1, r.contenido[0].diaSemana)
        assertEquals("press banca", r.contenido[0].ejercicios[0].nombre)
        assertEquals(4, r.contenido[0].ejercicios[0].series)
        // Un día sin ejercicios NO debe romper la deserialización.
        assertTrue(r.contenido[1].ejercicios.isEmpty())
    }

    @Test
    fun camposAusentesNoRompen() {
        // El contenido es jsonb congelado: puede venir de una versión anterior
        // del formato, sin algunos campos.
        val crudo = """{"nombre":"X","autor":"Y","dias":1,
          "contenido":[{"dia_semana":1,"ejercicios":[{"nombre":"sentadilla"}]}]}"""
        val r = json.decodeFromString<RutinaCompartidaVista>(crudo)
        assertNull(r.contenido[0].foco)
        assertNull(r.contenido[0].ejercicios[0].series)
    }

    @Test
    fun extraeElTokenDelDeepLink() {
        assertEquals("a7k2m9x3", tokenDeDeepLink("fitcore://rutina?token=a7k2m9x3"))
    }

    @Test
    fun deepLinkSinTokenODeOtroHostDevuelveNull() {
        assertNull(tokenDeDeepLink("fitcore://rutina"))
        assertNull(tokenDeDeepLink("fitcore://pago?ok=1"))
        assertNull(tokenDeDeepLink(""))
    }
}
```

- [ ] **Paso 2: correr el test — debe fallar**

```bash
cd "d:/Personal Proyects/controlgym-app"
./gradlew :composeApp:allTests --tests "*CompartirRutinaTest*" --console=plain
```

Esperado: FALLA al compilar, `Unresolved reference 'EnlaceCompartido'`.

- [ ] **Paso 3: implementar modelos y repositorio**

En `RutinaLibreRepositorio.kt`, añadir los modelos (arriba, junto a
`MiRutinaCard`):

```kotlin
/** Respuesta de `compartir_mi_rutina`: el enlace que se comparte. */
@Serializable
data class EnlaceCompartido(
    val ok: Boolean = false,
    val token: String,
    val url: String,
)

/** Un ejercicio dentro de una rutina compartida (contenido congelado). */
@Serializable
data class EjercicioCompartido(
    val nombre: String,
    val series: Int? = null,
    val reps: String? = null,
    val descanso: String? = null,
)

/** Un día de una rutina compartida. */
@Serializable
data class DiaCompartido(
    @SerialName("dia_semana") val diaSemana: Int = 0,
    val foco: String? = null,
    val ejercicios: List<EjercicioCompartido> = emptyList(),
)

/** Respuesta de `ver_rutina_compartida`: la rutina que alguien te pasó. */
@Serializable
data class RutinaCompartidaVista(
    val nombre: String,
    val autor: String,
    val dias: Int = 0,
    val contenido: List<DiaCompartido> = emptyList(),
)

/**
 * Token de un deep link `fitcore://rutina?token=…`, o null si no lo es.
 * Función pura y fuera de MainActivity a propósito: así se prueba sin Android.
 */
fun tokenDeDeepLink(url: String): String? {
    if (!url.startsWith("fitcore://rutina")) return null
    val q = url.substringAfter('?', "")
    return q.split('&')
        .firstOrNull { it.startsWith("token=") }
        ?.removePrefix("token=")
        ?.takeIf { it.isNotBlank() }
}
```

Y al interface `RutinaLibreRepositorio` + su implementación:

```kotlin
    /** Comparte la rutina y devuelve el enlace (idempotente en el backend). */
    suspend fun compartir(rutinaId: String): Resultado<EnlaceCompartido>
    /** Lee una rutina que alguien compartió, por su token. */
    suspend fun verCompartida(token: String): Resultado<RutinaCompartidaVista>
```

```kotlin
    override suspend fun compartir(rutinaId: String): Resultado<EnlaceCompartido> =
        resultadoDe("No se pudo crear el enlace.") {
            cliente.postgrest.rpc(
                "compartir_mi_rutina",
                buildJsonObject { put("p_rutina_libre", rutinaId) },
            ).decodeAs<EnlaceCompartido>()
        }

    override suspend fun verCompartida(token: String): Resultado<RutinaCompartidaVista> =
        resultadoDe("Este enlace ya no está disponible.") {
            cliente.postgrest.rpc(
                "ver_rutina_compartida",
                buildJsonObject { put("p_token", token) },
            ).decodeAs<RutinaCompartidaVista>()
        }
```

- [ ] **Paso 4: correr el test — debe pasar**

```bash
./gradlew :composeApp:allTests --tests "*CompartirRutinaTest*" --console=plain
```

Esperado: 5 tests en verde.

- [ ] **Paso 5: compilar los dos targets**

```bash
./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
```

Esperado: sin líneas `e:`.

- [ ] **Paso 6: commit**

```bash
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaLibreRepositorio.kt \
        composeApp/src/commonTest/kotlin/pe/fitcore/app/data/modelos/CompartirRutinaTest.kt
git commit -m "feat(compartir): modelos, deep link y repositorio + tests"
```

### Task 5: App — diálogo de compartir con QR

**Files:**
- Create: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/DialogoCompartirRutina.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/RutinaLibreViewModel.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt`

**Interfaces:**
- Consumes: `EnlaceCompartido`, `repo.compartir(rutinaId)` (Task 4)
- Produces: botón "Compartir con un amigo" + diálogo con enlace y QR

- [ ] **Paso 1: estado y método en el ViewModel**

En `RutinaLibreViewModel.kt`, añadir al `EstadoRutinaLibre`:

```kotlin
    /** Enlace de la rutina compartida, para el diálogo del QR. null = cerrado. */
    val enlaceCompartido: EnlaceCompartido? = null,
    val compartiendo: Boolean = false,
```

y los métodos:

```kotlin
    /**
     * Crea (o recupera) el enlace para compartir la rutina en curso. El backend
     * es idempotente: si ya se compartió, devuelve el MISMO enlace, así el que
     * la persona ya mandó por WhatsApp sigue sirviendo.
     */
    fun compartirRutina() {
        val id = _estado.value.rutina?.id ?: return
        if (_estado.value.compartiendo) return
        _estado.value = _estado.value.copy(compartiendo = true, error = null)
        viewModelScope.launch {
            when (val r = repo.compartir(id)) {
                is Resultado.Exito -> _estado.value = _estado.value.copy(
                    compartiendo = false, enlaceCompartido = r.dato,
                )
                is Resultado.Fallo -> _estado.value = _estado.value.copy(
                    compartiendo = false, error = r.mensaje,
                )
            }
        }
    }

    /** Cierra el diálogo del enlace. */
    fun cerrarCompartir() { _estado.value = _estado.value.copy(enlaceCompartido = null) }
```

- [ ] **Paso 2: crear el diálogo con el QR**

Crear `DialogoCompartirRutina.kt`:

```kotlin
package pe.fitcore.app.ui.libre

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.alexzhirkevich.qrose.rememberQrCodePainter
import pe.fitcore.app.ui.theme.ColoresFitCore

/**
 * Enlace + QR para pasarle la rutina a alguien. El QR es el MISMO enlace en
 * código: sirve para quien tienes delante, sin tener que dictarle nada.
 *
 * Usa `qrose`, la librería que ya pinta el QR del carnet del socio.
 */
@Composable
fun DialogoCompartirRutina(
    url: String,
    onCerrar: () -> Unit,
) {
    val portapapeles = LocalClipboardManager.current

    AlertDialog(
        onDismissRequest = onCerrar,
        containerColor = ColoresFitCore.Tarjeta,
        title = { Text("Compartir tu rutina", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "Quien escanee el código o abra el enlace podrá ver esta rutina " +
                        "y usarla en su app.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = ColoresFitCore.Atenuado,
                    textAlign = TextAlign.Center,
                )
                // Fondo blanco fijo: un QR sobre fondo oscuro no lo lee ningún
                // escáner, y el diálogo puede estar en tema oscuro.
                Image(
                    painter = rememberQrCodePainter(url),
                    contentDescription = "Código QR de la rutina",
                    modifier = Modifier
                        .size(190.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(ColoresFitCore.Blanco)
                        .padding(10.dp),
                )
                Text(
                    url,
                    style = MaterialTheme.typography.bodySmall,
                    color = ColoresFitCore.Primario,
                    textAlign = TextAlign.Center,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { portapapeles.setText(AnnotatedString(url)) }) {
                Text("Copiar enlace")
            }
        },
        dismissButton = { TextButton(onClick = onCerrar) { Text("Cerrar") } },
    )
}
```

- [ ] **Paso 3: botón y diálogo en la pantalla**

En `PantallaRutinaLibre.kt`, en el bloque "ESTA RUTINA" (junto a "Compartir con
la comunidad"):

```kotlin
                OutlinedButton(
                    onClick = { vm.compartirRutina() },
                    enabled = !estado.compartiendo,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (estado.compartiendo) "Creando enlace…" else "Compartir con un amigo") }
```

y, junto a los otros diálogos de la pantalla:

```kotlin
    estado.enlaceCompartido?.let { enlace ->
        DialogoCompartirRutina(url = enlace.url, onCerrar = { vm.cerrarCompartir() })
    }
```

- [ ] **Paso 4: compilar los dos targets**

```bash
./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
```

Esperado: sin líneas `e:`.

- [ ] **Paso 5: commit**

```bash
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/
git commit -m "feat(compartir): diálogo con enlace y QR en la app"
```

### Task 6: App — recibir el deep link

**Files:**
- Modify: `composeApp/src/androidMain/AndroidManifest.xml`
- Modify: `composeApp/src/androidMain/kotlin/pe/fitcore/app/MainActivity.kt`
- Modify: `composeApp/src/commonMain/kotlin/pe/fitcore/app/core/NavegacionPush.kt`

**Interfaces:**
- Consumes: `tokenDeDeepLink(url)` (Task 4)
- Produces: `NavegacionPush.tokenRutinaCompartida`

- [ ] **Paso 1: declarar el esquema en el manifest**

En `composeApp/src/androidMain/AndroidManifest.xml`, junto a los intent-filter de
`login` y `pago` que ya existen:

```xml
            <!-- Rutina compartida por enlace/QR (fitcore://rutina?token=…) -->
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="fitcore" android:host="rutina" />
            </intent-filter>
```

Sin esto el enlace no abre nada **y el fallo es silencioso**: Android
simplemente ignora el intent.

- [ ] **Paso 2: bandera en NavegacionPush**

En `NavegacionPush.kt`, junto a las otras:

```kotlin
    /**
     * Token de una rutina que alguien compartió (`fitcore://rutina?token=…`).
     * Se consume una sola vez en la raíz, como el resto de destinos pendientes.
     */
    var tokenRutinaCompartida: String? = null
```

- [ ] **Paso 3: capturarlo en MainActivity**

En `capturarDeepLink` de `MainActivity.kt`, después del bloque de `pago`:

```kotlin
        // Rutina compartida por enlace o QR: se guarda el token y la raíz abre
        // la pantalla de "alguien te compartió esta rutina".
        if (data?.scheme == "fitcore" && data.host == "rutina") {
            NavegacionPush.tokenRutinaCompartida =
                pe.fitcore.app.data.repositorio.tokenDeDeepLink(data.toString())
        }
```

- [ ] **Paso 4: compilar y correr TODOS los tests de la app**

```bash
./gradlew :composeApp:compileDebugKotlinAndroid --console=plain -q
./gradlew :composeApp:compileKotlinIosArm64 --console=plain -q
./gradlew :composeApp:allTests --console=plain
```

Esperado: sin líneas `e:` y todos los tests en verde (los previos + los 5 nuevos).

- [ ] **Paso 5: probar el deep link en el emulador**

```bash
ADB="$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe"
"$ADB" shell am start -a android.intent.action.VIEW -d "fitcore://rutina?token=a7k2m9x3"
```

Esperado: la app se abre (con un token real, creado desde la app o por psql).

- [ ] **Paso 6: commit**

```bash
git add composeApp/src/androidMain/ composeApp/src/commonMain/kotlin/pe/fitcore/app/core/NavegacionPush.kt
git commit -m "feat(compartir): abrir la app desde el enlace/QR de una rutina"
```

---

## Publicación

**No se crean tags ni releases**: el owner publica desde Android Studio (decisión
del 03-ago). El trabajo termina en commit + push de los dos repos.

Orden: **la migración va ANTES que la app**. La app nueva llama RPCs que la
vieja no tiene; al revés rompe a quien todavía no actualizó.
