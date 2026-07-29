# Rutinas prediseñadas de casa + biblioteca navegable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que el usuario sin gym entrene en casa con rutinas prediseñadas curadas (full body, pilates, prenatal, glúteos, core), cada ejercicio con alternativas curadas, y explorar el catálogo con una biblioteca navegable.

**Architecture:** 3 tablas globales nuevas en Supabase (`rutina_predisenada` + `_dia` + `_ejercicio` con `alternativas_ids uuid[]`), 3 RPCs (`listar`/`detalle`/`adoptar`), y la biblioteca reutiliza la RPC existente `buscar_ejercicios_catalogo`. La app KMP suma galería + detalle + biblioteca dentro de la pestaña "Mi rutina" ya existente, reusando el layout de rutina libre y el `DialogoSugerencia` de detalle. `adoptar` copia la prediseñada a `rutina_libre` para que el resto del flujo (registrar carga, "Mi rutina") funcione sin cambios.

**Tech Stack:** Supabase Postgres (migraciones vía psql con DATABASE_URL de Vercel, sslmode=require), Kotlin Multiplatform + Compose (repo controlgym-app, package pe.fitcore.app, supabase-kt jan-tennert 3.0.3).

## Global Constraints

- Migraciones: probar SIEMPRE en transacción `rollback` contra prod (proyecto zlmqdubrjzmagslcsqvb) antes de aplicar. DATABASE_URL viene de `vercel env pull`; reemplazar `sslmode=no-verify` por `sslmode=require` para psql.
- RPCs: `security definer set search_path = public`, y `revoke all ... from public` + `grant execute ... to authenticated` explícito (el default privilege da execute a authenticated; el revoke a public no basta — hay que grant explícito). Ver [[supabase-default-privileges-rpc]].
- Tablas nuevas: RLS activa; SELECT para `authenticated`; sin insert/update/delete a `authenticated` (curado por service_role).
- Nombres de tablas exactos: `rutina_predisenada`, `rutina_predisenada_dia`, `rutina_predisenada_ejercicio` (sin ñ en identificadores SQL — usar "predisenada").
- Catálogo global: `ejercicio_catalogo`, equipo casa = `equipment = 'body weight'` (325 ejercicios, todos con `nombre_es`).
- App: patrón ViewModel = `androidx.lifecycle.ViewModel` + `viewModelScope.launch` + `MutableStateFlow`/`asStateFlow()`, sin `onCleared`. Repos usan `ProveedorSupabase.cliente.postgrest.rpc(...)`.
- Verificación app: `gradlew compileCommonMainKotlinMetadata` limpio.
- NO crear tag/release hasta que el owner verifique en vivo. Aplicar migración a prod + commit/push sí.
- El shape de detalle debe ser IGUAL a `_rutina_libre_detalle` + campo `alternativas[]` por ejercicio, para reusar la pantalla de rutina.

---

### Task 1: Migración — 3 tablas + RLS

**Files:**
- Create: `supabase/migrations/20260729100000_rutinas_predisenadas.sql`

**Interfaces:**
- Produces: tablas `public.rutina_predisenada(id, slug, nombre, categoria, descripcion, nivel, dias_por_semana, equipo, disclaimer_salud, imagen, orden, activa, created_at)`, `public.rutina_predisenada_dia(id, predisenada_id, dia_semana, foco)`, `public.rutina_predisenada_ejercicio(id, predisenada_dia_id, catalogo_id, nombre, series, reps, descanso, orden, alternativas_ids uuid[])`.

- [ ] **Step 1: Escribir la migración de tablas + RLS**

```sql
-- Rutinas prediseñadas curadas para el usuario en casa (sin gym). Catálogo
-- GLOBAL (sin empresa_id), como ejercicio_catalogo: cualquiera las lee, solo
-- service_role las cura. El usuario las "adopta" copiándolas a su rutina_libre.

create table public.rutina_predisenada (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  nombre        text not null,
  categoria     text not null,
  descripcion   text,
  nivel         text not null default 'principiante'
                  check (nivel in ('principiante','intermedio','avanzado')),
  dias_por_semana int not null check (dias_por_semana between 1 and 6),
  equipo        text not null default 'peso_corporal'
                  check (equipo in ('peso_corporal','mancuernas','gym_completo')),
  disclaimer_salud text,
  imagen        text,
  orden         int not null default 0,
  activa        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index rutina_predisenada_cat_idx on public.rutina_predisenada (categoria, activa, orden);

create table public.rutina_predisenada_dia (
  id            uuid primary key default gen_random_uuid(),
  predisenada_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  dia_semana    int not null,
  foco          text
);
create index rutina_predisenada_dia_idx on public.rutina_predisenada_dia (predisenada_id);

create table public.rutina_predisenada_ejercicio (
  id            uuid primary key default gen_random_uuid(),
  predisenada_dia_id uuid not null references public.rutina_predisenada_dia(id) on delete cascade,
  catalogo_id   uuid not null references public.ejercicio_catalogo(id),
  nombre        text not null,
  series        int,
  reps          text,
  descanso      text,
  orden         int not null default 0,
  alternativas_ids uuid[] not null default '{}'
);
create index rutina_predisenada_ej_idx on public.rutina_predisenada_ejercicio (predisenada_dia_id);

-- RLS: lectura para cualquier authenticated (catálogo compartido); escritura
-- solo service_role (curado por SQL).
alter table public.rutina_predisenada enable row level security;
alter table public.rutina_predisenada_dia enable row level security;
alter table public.rutina_predisenada_ejercicio enable row level security;

create policy rutina_predisenada_lee on public.rutina_predisenada
  for select to authenticated using (activa);
create policy rutina_predisenada_dia_lee on public.rutina_predisenada_dia
  for select to authenticated using (true);
create policy rutina_predisenada_ej_lee on public.rutina_predisenada_ejercicio
  for select to authenticated using (true);

grant select on public.rutina_predisenada to authenticated;
grant select on public.rutina_predisenada_dia to authenticated;
grant select on public.rutina_predisenada_ejercicio to authenticated;
```

- [ ] **Step 2: Probar en rollback contra prod**

```bash
ENVF="<scratchpad>/.env.prod"  # el que ya existe en la sesión, o: vercel env pull
DBURL=$(grep -E "^DATABASE_URL=" "$ENVF" | head -1 | sed 's/^DATABASE_URL=//; s/^"//; s/"$//' | sed 's/sslmode=no-verify/sslmode=require/')
psql "$DBURL" -v ON_ERROR_STOP=1 <<SQL
begin;
\i 'supabase/migrations/20260729100000_rutinas_predisenadas.sql'
select 'tablas' as chk, count(*) from information_schema.tables
  where table_name in ('rutina_predisenada','rutina_predisenada_dia','rutina_predisenada_ejercicio');
rollback;
SQL
```
Expected: `chk=tablas count=3`, luego `ROLLBACK`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729100000_rutinas_predisenadas.sql
git commit -m "feat(predisenadas): tablas rutina_predisenada + RLS"
```

---

### Task 2: Migración — RPCs listar / detalle / adoptar

**Files:**
- Modify: `supabase/migrations/20260729100000_rutinas_predisenadas.sql` (append al final; van en la misma migración para que las tablas y sus RPCs viajen juntas)

**Interfaces:**
- Consumes: tablas de Task 1; `public._rutina_libre_detalle(uuid)` (existente, `20260715000020_rutina_libre.sql:110`); tablas `rutina_libre`, `rutina_libre_dia`, `rutina_libre_ejercicio`.
- Produces:
  - `listar_rutinas_predisenadas(p_categoria text default null, p_equipo text default null) returns jsonb`
  - `detalle_rutina_predisenada(p_id uuid) returns jsonb`
  - `adoptar_rutina_predisenada(p_id uuid) returns jsonb`

- [ ] **Step 1: Append las 3 RPCs a la migración**

```sql
-- ── listar: tarjetas de la galería ─────────────────────────────────────────
create or replace function public.listar_rutinas_predisenadas(
  p_categoria text default null, p_equipo text default null
) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t order by t.orden, t.nombre), '[]'::jsonb)
  from (
    select p.orden, jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'nombre', p.nombre, 'categoria', p.categoria,
      'descripcion', p.descripcion, 'nivel', p.nivel,
      'dias_por_semana', p.dias_por_semana, 'equipo', p.equipo,
      'disclaimer_salud', p.disclaimer_salud, 'imagen', p.imagen
    ) as t, p.orden
    from public.rutina_predisenada p
    where p.activa
      and (p_categoria is null or p.categoria = p_categoria)
      and (p_equipo is null or p.equipo = p_equipo)
  ) sub;
$$;
revoke all on function public.listar_rutinas_predisenadas(text,text) from public;
grant execute on function public.listar_rutinas_predisenadas(text,text) to authenticated, service_role;

-- ── detalle: mismo shape que _rutina_libre_detalle + alternativas[] ─────────
create or replace function public.detalle_rutina_predisenada(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with p as (select * from public.rutina_predisenada where id = p_id and activa)
  select case when not exists (select 1 from p) then null else
    jsonb_build_object(
      'id', (select id from p), 'nombre', (select nombre from p),
      'categoria', (select categoria from p), 'descripcion', (select descripcion from p),
      'nivel', (select nivel from p), 'dias_por_semana', (select dias_por_semana from p),
      'equipo', (select equipo from p), 'disclaimer_salud', (select disclaimer_salud from p),
      'dias', coalesce((
        select jsonb_agg(dia order by dia->>'dia_semana')
        from (
          select jsonb_build_object(
            'id', d.id, 'dia_semana', d.dia_semana, 'foco', d.foco,
            'ejercicios', coalesce((
              select jsonb_agg(ej order by (ej->>'orden')::int)
              from (
                select jsonb_build_object(
                  'id', re.id, 'nombre', re.nombre, 'series', re.series, 'reps', re.reps,
                  'descanso', re.descanso, 'orden', re.orden,
                  'video_url', case when c.gif_url is not null and c.gif_url not like '%.gif' then c.gif_url end,
                  'gif_url', case when c.gif_url like '%.gif' then c.gif_url end,
                  'foto_url', c.foto_url,
                  'descripcion', coalesce(c.instrucciones->>'es', c.instrucciones->>'en'),
                  'catalogo_id', c.id, 'target', c.target, 'body_part', c.body_part,
                  'grupo_muscular', c.grupo_muscular, 'secondary', c.secondary, 'equipment', c.equipment,
                  'alternativas', coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'catalogo_id', ac.id, 'nombre', coalesce(ac.nombre_es, ac.nombre),
                      'target', ac.target, 'equipment', ac.equipment,
                      'gif_url', case when ac.gif_url like '%.gif' then ac.gif_url end,
                      'foto_url', ac.foto_url))
                    from public.ejercicio_catalogo ac
                    where ac.id = any (re.alternativas_ids) and ac.activo
                  ), '[]'::jsonb)
                ) as ej
                from public.rutina_predisenada_ejercicio re
                left join public.ejercicio_catalogo c on c.id = re.catalogo_id
                where re.predisenada_dia_id = d.id
              ) x
            ), '[]'::jsonb)
          ) as dia
          from public.rutina_predisenada_dia d where d.predisenada_id = (select id from p)
        ) y
      ), '[]'::jsonb)
    )
  end;
$$;
revoke all on function public.detalle_rutina_predisenada(uuid) from public;
grant execute on function public.detalle_rutina_predisenada(uuid) to authenticated, service_role;

-- ── adoptar: copia la prediseñada a la rutina_libre activa del usuario ──────
create or replace function public.adoptar_rutina_predisenada(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid := auth.uid();
  v_rutina uuid;
  v_dia uuid;
  v_p record;
  r_dia record;
  r_ej record;
begin
  if v_usuario is null then raise exception 'usuario no autenticado'; end if;
  select * into v_p from public.rutina_predisenada where id = p_id and activa;
  if not found then raise exception 'rutina prediseñada no encontrada'; end if;

  delete from public.rutina_libre where usuario_id = v_usuario and activa;
  insert into public.rutina_libre (usuario_id, nombre, objetivo, activa)
    values (v_usuario, v_p.nombre, v_p.categoria, true)
    returning id into v_rutina;

  for r_dia in select * from public.rutina_predisenada_dia
               where predisenada_id = p_id order by dia_semana loop
    insert into public.rutina_libre_dia (rutina_libre_id, dia_semana, foco)
      values (v_rutina, r_dia.dia_semana, r_dia.foco) returning id into v_dia;
    for r_ej in select * from public.rutina_predisenada_ejercicio
                where predisenada_dia_id = r_dia.id order by orden loop
      insert into public.rutina_libre_ejercicio
        (rutina_libre_dia_id, catalogo_id, nombre, series, reps, descanso, orden)
        values (v_dia, r_ej.catalogo_id, r_ej.nombre, r_ej.series, r_ej.reps, r_ej.descanso, r_ej.orden);
    end loop;
  end loop;

  return public._rutina_libre_detalle(v_rutina);
end;
$$;
revoke all on function public.adoptar_rutina_predisenada(uuid) from public;
grant execute on function public.adoptar_rutina_predisenada(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Probar en rollback (crea 1 prediseñada mínima, prueba las 3 RPCs, rollback)**

```bash
DBURL=...  # como en Task 1
psql "$DBURL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i 'supabase/migrations/20260729100000_rutinas_predisenadas.sql'
-- semilla mínima de prueba con un catalogo_id real body weight
with c as (select id from public.ejercicio_catalogo where activo and equipment='body weight' and target='abs' limit 2)
, p as (insert into public.rutina_predisenada (slug,nombre,categoria,dias_por_semana)
        values ('test-x','Test','core_abdomen',1) returning id)
, d as (insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
        select id,1,'Core' from p returning id)
insert into public.rutina_predisenada_ejercicio (predisenada_dia_id,catalogo_id,nombre,series,reps,orden,alternativas_ids)
select d.id, (array(select id from c))[1], 'Ej1', 3, '12', 1, array[(array(select id from c))[2]] from d;
-- probar RPCs (como definer; auth.uid() será null en psql, adoptar fallará esperado)
select 'listar' as chk, jsonb_array_length(public.listar_rutinas_predisenadas(null,null));
select 'detalle_dias' as chk, jsonb_array_length((public.detalle_rutina_predisenada((select id from public.rutina_predisenada where slug='test-x')))->'dias');
select 'alternativas' as chk, jsonb_array_length((public.detalle_rutina_predisenada((select id from public.rutina_predisenada where slug='test-x')))->'dias'->0->'ejercicios'->0->'alternativas');
rollback;
SQL
```
Expected: `listar>=1`, `detalle_dias=1`, `alternativas=1`, luego `ROLLBACK`. (adoptar se prueba con sesión authenticated real en la fase de verificación final, porque necesita `auth.uid()`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729100000_rutinas_predisenadas.sql
git commit -m "feat(predisenadas): RPCs listar/detalle/adoptar"
```

---

### Task 3: Migración de seed — contenido curado

**Files:**
- Create: `supabase/migrations/20260729110000_seed_predisenadas.sql`

**Interfaces:**
- Consumes: tablas de Task 1; `ejercicio_catalogo` (elegir `catalogo_id` por `nombre_es`/`target` reales).

- [ ] **Step 1: Descubrir ejercicios reales para curar (query, no rollback)**

```bash
DBURL=...
# Listar nombres reales por músculo para elegir a mano los de cada rutina:
psql "$DBURL" -c "select target, coalesce(nombre_es,nombre) n, id from public.ejercicio_catalogo where activo and equipment='body weight' and target in ('abs','glutes','pectorals','quads','hamstrings','lats','triceps','biceps','delts') order by target, n;"
```
Con esa lista, curar a mano cada rutina. Elegir por SLUG estable, resolviendo el `catalogo_id` dentro del INSERT con subselect por `nombre_es` (no hardcodear UUIDs, que difieren si se recarga el catálogo).

- [ ] **Step 2: Escribir el seed usando un helper que resuelve por nombre**

Patrón por rutina (repetir para las 5). El helper `cat(nombre)` evita hardcodear UUIDs:

```sql
-- Seed de rutinas prediseñadas curadas. Resuelve catalogo_id por nombre_es real
-- (verificado en la BD) para no depender de UUIDs que cambian al recargar catálogo.
-- Idempotente: borra por slug antes de insertar.

create or replace function pg_temp.cat(p_nombre text) returns uuid language sql as $$
  select id from public.ejercicio_catalogo
  where activo and equipment='body weight' and coalesce(nombre_es,nombre) = p_nombre limit 1;
$$;

-- Ejemplo: FULL BODY EN CASA (3 días). Sustituir los nombres por los reales
-- hallados en Step 1; cada ejercicio con 2-3 alternativas del mismo músculo.
delete from public.rutina_predisenada where slug='full-body-casa';
with p as (
  insert into public.rutina_predisenada (slug,nombre,categoria,descripcion,nivel,dias_por_semana,equipo,orden)
  values ('full-body-casa','Full body en casa','full_body_casa',
          'Rutina de cuerpo completo con tu propio peso, sin equipo.','principiante',3,'peso_corporal',1)
  returning id
), d1 as (
  insert into public.rutina_predisenada_dia (predisenada_id,dia_semana,foco)
  select id,1,'Full body A' from p returning id
)
insert into public.rutina_predisenada_ejercicio
  (predisenada_dia_id,catalogo_id,nombre,series,reps,descanso,orden,alternativas_ids)
select d1.id, pg_temp.cat('<NOMBRE_REAL>'), '<NOMBRE_REAL>', 3, '10-12', '60s', 1,
       array_remove(array[pg_temp.cat('<ALT1>'), pg_temp.cat('<ALT2>')], null)
from d1;
-- ... repetir para cada ejercicio y cada día ...
```

Las 5 rutinas a crear (slugs): `full-body-casa`, `pilates-core`, `prenatal`, `gluteos-casa`, `core-abdomen`. La `prenatal` lleva:
```sql
-- disclaimer en la prediseñada prenatal:
update public.rutina_predisenada set disclaimer_salud =
  'Consulta con tu médico antes de comenzar cualquier rutina durante el embarazo. Detente si sientes molestias.'
where slug='prenatal';
```
Para prenatal, elegir ejercicios seguros (evitar por nombre: crunch/sit-up intensos, planchas boca abajo prolongadas, saltos). Si algún músculo no tiene ejercicio seguro en el catálogo, dejarlo fuera y anotarlo en el commit — no inventar.

- [ ] **Step 3: Probar en rollback que todo resuelve (0 catalogo_id null)**

```bash
DBURL=...
psql "$DBURL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i 'supabase/migrations/20260729110000_seed_predisenadas.sql'
select 'rutinas' chk, count(*) from public.rutina_predisenada where slug in
  ('full-body-casa','pilates-core','prenatal','gluteos-casa','core-abdomen');
select 'ej_sin_catalogo' chk, count(*) from public.rutina_predisenada_ejercicio where catalogo_id is null;
select 'prenatal_disclaimer' chk, (disclaimer_salud is not null) from public.rutina_predisenada where slug='prenatal';
rollback;
SQL
```
Expected: `rutinas=5`, `ej_sin_catalogo=0`, `prenatal_disclaimer=t`, luego `ROLLBACK`. Si `ej_sin_catalogo>0`, un nombre no existe → corregirlo.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729110000_seed_predisenadas.sql
git commit -m "feat(predisenadas): seed de 5 rutinas curadas (full body, pilates, prenatal, glúteos, core)"
```

---

### Task 4: App — modelos + repositorio

**Files:**
- Create: `controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/data/modelos/RutinaPredisenada.kt`
- Create: `controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaPredisenadaRepositorio.kt`

**Interfaces:**
- Consumes: `ProveedorSupabase.cliente`; RPCs `listar_rutinas_predisenadas`, `detalle_rutina_predisenada`, `adoptar_rutina_predisenada`; el modelo de detalle de rutina libre existente (para reusar la pantalla).
- Produces: `RutinaPredisenadaCard`, `RutinaPredisenadaRepositorio` con `listar(categoria:String?, equipo:String?)`, `detalle(id:String)`, `adoptar(id:String)`.

- [ ] **Step 1: Ver el modelo de detalle de rutina libre existente para reusar su shape**

```bash
# Localizar el data class del detalle de rutina libre (dias/ejercicios) para
# reutilizarlo o extenderlo con 'alternativas'.
grep -rn "class.*Rutina\|dia_semana\|EjercicioLibre\|RutinaLibreDetalle" \
  "d:/Personal Proyects/controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/data/modelos/"
```
Expected: encontrar el/los data class de rutina libre (p.ej. `RutinaLibre.kt`). Reusar `@Serializable` con `@SerialName` igual que ahí.

- [ ] **Step 2: Escribir los modelos** (ajustar campos al modelo de rutina libre real hallado en Step 1)

```kotlin
package pe.fitcore.app.data.modelos

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RutinaPredisenadaCard(
    val id: String,
    val slug: String,
    val nombre: String,
    val categoria: String,
    val descripcion: String? = null,
    val nivel: String,
    @SerialName("dias_por_semana") val diasPorSemana: Int,
    val equipo: String,
    @SerialName("disclaimer_salud") val disclaimerSalud: String? = null,
    val imagen: String? = null,
)

@Serializable
data class EjercicioAlternativa(
    @SerialName("catalogo_id") val catalogoId: String,
    val nombre: String,
    val target: String? = null,
    val equipment: String? = null,
    @SerialName("gif_url") val gifUrl: String? = null,
    @SerialName("foto_url") val fotoUrl: String? = null,
)
```
El detalle completo se deserializa con el modelo de rutina libre existente (extendido con `val alternativas: List<EjercicioAlternativa> = emptyList()` en el ejercicio si ese data class se comparte; si no, crear `RutinaPredisenadaDetalle` espejo). Documentar la decisión en el commit.

- [ ] **Step 3: Escribir el repositorio** (seguir el patrón de un repo existente, p.ej. `RutinaLibreRepositorio.kt`)

```kotlin
package pe.fitcore.app.data.repositorio

import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonNull
import pe.fitcore.app.core.Resultado
import pe.fitcore.app.data.modelos.RutinaPredisenadaCard
import pe.fitcore.app.data.supabase.ProveedorSupabase

interface RutinaPredisenadaRepositorio {
    suspend fun listar(categoria: String?, equipo: String?): Resultado<List<RutinaPredisenadaCard>>
    suspend fun detalle(id: String): Resultado<String>   // json crudo → parsear con el modelo de rutina libre
    suspend fun adoptar(id: String): Resultado<String>
}

class RutinaPredisenadaRepositorioSupabase(
    private val cliente: io.github.jan.supabase.SupabaseClient = ProveedorSupabase.cliente,
) : RutinaPredisenadaRepositorio {
    override suspend fun listar(categoria: String?, equipo: String?) = try {
        val r = cliente.postgrest.rpc("listar_rutinas_predisenadas", buildJsonObject {
            put("p_categoria", categoria ?: return@buildJsonObject.let { JsonNull })
            put("p_equipo", equipo)
        })
        Resultado.Exito(r.decodeList<RutinaPredisenadaCard>())
    } catch (e: Exception) { Resultado.Fallo(e.message ?: "Error al listar rutinas") }
    // detalle(id) y adoptar(id): rpc("detalle_rutina_predisenada"/"adoptar_rutina_predisenada",
    //   buildJsonObject { put("p_id", id) }) → devolver r.data (json crudo) como Resultado.Exito.
}
```
Ajustar el manejo de params null al patrón real de `rpc(...)` que usen los otros repos (ver `RutinaLibreRepositorio.kt`). Usar `Resultado` (sealed) como el resto.

- [ ] **Step 4: Compilar**

```bash
cd "d:/Personal Proyects/controlgym-app" && ./gradlew.bat compileCommonMainKotlinMetadata --console=plain
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
cd "d:/Personal Proyects/controlgym-app"
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/data/modelos/RutinaPredisenada.kt \
        composeApp/src/commonMain/kotlin/pe/fitcore/app/data/repositorio/RutinaPredisenadaRepositorio.kt
git commit -m "feat(predisenadas): modelos + repositorio de rutinas prediseñadas"
```

---

### Task 5: App — ViewModels (galería + biblioteca)

**Files:**
- Create: `controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PredisenadasViewModel.kt`
- Create: `controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/BibliotecaViewModel.kt`

**Interfaces:**
- Consumes: `RutinaPredisenadaRepositorio` (Task 4); para biblioteca, el repo/RPC existente `buscar_ejercicios_catalogo` (ver cómo lo llama `PlanesRepositorio.sugerenciasPorMusculo`).
- Produces: `PredisenadasViewModel` (estado con `cards`, `detalleJson`, `cargando`, `mensaje`; funciones `cargar(categoria?, equipo?)`, `abrirDetalle(id)`, `adoptar(id)`); `BibliotecaViewModel` (estado con `resultados`, `cargando`; función `buscar(texto?, bodyPart?, equipment?)`).

- [ ] **Step 1: Ver el patrón de un ViewModel de libre existente** (`RutinaLibreViewModel.kt`) para copiar estructura de estado/scope.

```bash
sed -n '1,60p' "d:/Personal Proyects/controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/RutinaLibreViewModel.kt"
```

- [ ] **Step 2: Escribir `PredisenadasViewModel`**

```kotlin
package pe.fitcore.app.ui.libre

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import pe.fitcore.app.core.Resultado
import pe.fitcore.app.data.modelos.RutinaPredisenadaCard
import pe.fitcore.app.data.repositorio.RutinaPredisenadaRepositorio
import pe.fitcore.app.data.repositorio.RutinaPredisenadaRepositorioSupabase

data class EstadoPredisenadas(
    val cargando: Boolean = true,
    val cards: List<RutinaPredisenadaCard> = emptyList(),
    val detalleJson: String? = null,
    val adoptada: Boolean = false,
    val mensaje: String? = null,
)

class PredisenadasViewModel(
    private val repo: RutinaPredisenadaRepositorio = RutinaPredisenadaRepositorioSupabase(),
) : ViewModel() {
    private val _estado = MutableStateFlow(EstadoPredisenadas())
    val estado: StateFlow<EstadoPredisenadas> = _estado.asStateFlow()

    init { cargar(null, null) }

    fun cargar(categoria: String?, equipo: String?) {
        _estado.value = _estado.value.copy(cargando = true, mensaje = null)
        viewModelScope.launch {
            when (val r = repo.listar(categoria, equipo)) {
                is Resultado.Exito -> _estado.value = _estado.value.copy(cargando = false, cards = r.dato)
                is Resultado.Fallo -> _estado.value = _estado.value.copy(cargando = false, mensaje = r.mensaje)
            }
        }
    }

    fun abrirDetalle(id: String) {
        viewModelScope.launch {
            when (val r = repo.detalle(id)) {
                is Resultado.Exito -> _estado.value = _estado.value.copy(detalleJson = r.dato)
                is Resultado.Fallo -> _estado.value = _estado.value.copy(mensaje = r.mensaje)
            }
        }
    }

    fun cerrarDetalle() { _estado.value = _estado.value.copy(detalleJson = null) }

    fun adoptar(id: String) {
        viewModelScope.launch {
            when (val r = repo.adoptar(id)) {
                is Resultado.Exito -> _estado.value = _estado.value.copy(adoptada = true, detalleJson = null,
                    mensaje = "¡Listo! Ya es tu rutina.")
                is Resultado.Fallo -> _estado.value = _estado.value.copy(mensaje = r.mensaje)
            }
        }
    }
}
```

- [ ] **Step 3: Escribir `BibliotecaViewModel`** (usa el mismo repo de catálogo que `sugerenciasPorMusculo`; pero por texto/bodyPart/equipment)

```kotlin
package pe.fitcore.app.ui.libre

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import pe.fitcore.app.core.Resultado
import pe.fitcore.app.data.modelos.EjercicioSugerido   // el modelo que ya devuelve buscar_ejercicios_catalogo
import pe.fitcore.app.data.repositorio.PlanesRepositorio
import pe.fitcore.app.data.repositorio.PlanesRepositorioSupabase

data class EstadoBiblioteca(
    val cargando: Boolean = false,
    val resultados: List<EjercicioSugerido> = emptyList(),
    val mensaje: String? = null,
)

class BibliotecaViewModel(
    private val planes: PlanesRepositorio = PlanesRepositorioSupabase(),
) : ViewModel() {
    private val _estado = MutableStateFlow(EstadoBiblioteca())
    val estado: StateFlow<EstadoBiblioteca> = _estado.asStateFlow()

    fun buscar(texto: String?, bodyPart: String?, equipment: String?) {
        _estado.value = _estado.value.copy(cargando = true, mensaje = null)
        viewModelScope.launch {
            when (val r = planes.buscarCatalogo(texto, bodyPart, equipment)) {  // añadir este método al repo si no existe
                is Resultado.Exito -> _estado.value = _estado.value.copy(cargando = false, resultados = r.dato)
                is Resultado.Fallo -> _estado.value = _estado.value.copy(cargando = false, mensaje = r.mensaje)
            }
        }
    }
}
```
Nota: si `PlanesRepositorio` no tiene un `buscarCatalogo(texto, bodyPart, equipment)` genérico (solo `sugerenciasPorMusculo` por target), añadirlo llamando la misma RPC `buscar_ejercicios_catalogo` con esos params. Reusar el modelo que ya deserializa esa RPC (verificar su nombre en Step 1 de Task 4).

- [ ] **Step 4: Compilar**

```bash
cd "d:/Personal Proyects/controlgym-app" && ./gradlew.bat compileCommonMainKotlinMetadata --console=plain
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
cd "d:/Personal Proyects/controlgym-app"
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PredisenadasViewModel.kt \
        composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/BibliotecaViewModel.kt
git commit -m "feat(predisenadas): ViewModels de galería y biblioteca"
```

---

### Task 6: App — Pantallas (galería + detalle + biblioteca) e integración en "Mi rutina"

**Files:**
- Create: `controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinasPredisenadas.kt`
- Create: `controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaBiblioteca.kt`
- Modify: `controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt` (agregar 2 botones de entrada arriba del wizard)

**Interfaces:**
- Consumes: `PredisenadasViewModel`, `BibliotecaViewModel` (Task 5); el `DialogoSugerencia` existente (`PantallaRutinaLibre.kt`) para el detalle de un ejercicio/alternativa; el layout de días/ejercicios de rutina libre.

- [ ] **Step 1: Ver la pantalla de rutina libre y su DialogoSugerencia/DialogoAlternativas para reusar**

```bash
grep -n "DialogoSugerencia\|DialogoAlternativas\|fun PantallaRutinaLibre\|LazyColumn\|dia.foco" \
  "d:/Personal Proyects/controlgym-app/composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt"
```

- [ ] **Step 2: Escribir `PantallaRutinasPredisenadas`** — grid de tarjetas + navegación a detalle. Detalle: reusa el layout de días/ejercicios; banner si `disclaimerSalud != null`; bloque "Alternativas" por ejercicio (toca → `DialogoSugerencia`); botón "Usar esta rutina" → `viewModel.adoptar(id)`. Estados: `cargando` → spinner; `cards` vacío → "Pronto habrá rutinas aquí"; `mensaje` → snackbar.

(El código completo de Compose se escribe siguiendo el estilo de `PantallaRutinaLibre.kt`: `Scaffold`/`LazyColumn`/`Card`. Reusar componentes de tarjeta de ejercicio y `DialogoSugerencia` ya existentes en ese archivo — no reimplementar el visor de GIF.)

- [ ] **Step 3: Escribir `PantallaBiblioteca`** — barra de búsqueda + chips de filtro (equipo: Peso corporal/Mancuernas/Todo; zona/bodyPart). Lista de resultados; cada uno abre `DialogoSugerencia`. Estados igual que arriba.

- [ ] **Step 4: Agregar entradas en `PantallaRutinaLibre`** — arriba del wizard, dos botones/cards: "Rutinas listas" (→ `PantallaRutinasPredisenadas`) y "Explorar ejercicios" (→ `PantallaBiblioteca`). Usar el navegador/estado de pantalla que ya use ese archivo (mirar cómo abre `DialogoSugerencia` para el patrón de navegación local).

- [ ] **Step 5: Compilar**

```bash
cd "d:/Personal Proyects/controlgym-app" && ./gradlew.bat compileCommonMainKotlinMetadata --console=plain
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
cd "d:/Personal Proyects/controlgym-app"
git add composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinasPredisenadas.kt \
        composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaBiblioteca.kt \
        composeApp/src/commonMain/kotlin/pe/fitcore/app/ui/libre/PantallaRutinaLibre.kt
git commit -m "feat(predisenadas): pantallas galería + biblioteca + entradas en Mi rutina"
```

---

### Task 7: Verificación end-to-end + aplicar a prod (SIN release)

**Files:** ninguno nuevo (aplica migraciones + push).

- [ ] **Step 1: Aplicar ambas migraciones a prod (de verdad, ya probadas en rollback)**

```bash
DBURL=...
psql "$DBURL" -v ON_ERROR_STOP=1 -f 'supabase/migrations/20260729100000_rutinas_predisenadas.sql'
psql "$DBURL" -v ON_ERROR_STOP=1 -f 'supabase/migrations/20260729110000_seed_predisenadas.sql'
```
Expected: sin errores.

- [ ] **Step 2: Verificar en prod (persistido)**

```bash
psql "$DBURL" -c "select slug, categoria, dias_por_semana, disclaimer_salud is not null dis from public.rutina_predisenada order by orden;"
psql "$DBURL" -c "select count(*) ej_sin_catalogo from public.rutina_predisenada_ejercicio where catalogo_id is null;"
```
Expected: 5 filas; `ej_sin_catalogo=0`.

- [ ] **Step 3: Verificar `adoptar` con sesión authenticated real** (no service_role). Usar un JWT de una cuenta de prueba (ver [[cuentas-prueba-y-staff-por-sql]]) o el flujo de la app. Confirmar que tras `adoptar_rutina_predisenada(<id>)`, `mi_rutina_libre()` devuelve esa rutina con sus días/ejercicios.

- [ ] **Step 4: Compilar la app una última vez**

```bash
cd "d:/Personal Proyects/controlgym-app" && ./gradlew.bat compileCommonMainKotlinMetadata --console=plain
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Push de ambos repos (SIN tag/release)**

```bash
cd "d:/Personal Proyects/ControlGym" && git push origin master
cd "d:/Personal Proyects/controlgym-app" && git push origin main
```

- [ ] **Step 6: Avisar al owner para verificación en vivo**

NO crear tag ni GitHub release. Reportar: migraciones aplicadas, 5 rutinas visibles, app compila, listo para que el owner pruebe en un dispositivo. El release se crea solo tras su OK.

---

## Notas de verificación global

- Todas las migraciones se prueban en `begin; ... rollback;` antes de aplicarse.
- La app se verifica por compilación (`compileCommonMainKotlinMetadata`), no hay suite de tests KMP en el repo.
- El panel no se toca; no correr su suite salvo que se modifique un archivo compartido.
- El shape de `detalle_rutina_predisenada` es idéntico a `_rutina_libre_detalle` + `alternativas[]`, para reusar la pantalla de rutina de la app.
