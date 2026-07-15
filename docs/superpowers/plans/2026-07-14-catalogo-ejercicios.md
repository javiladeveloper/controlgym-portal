# Catálogo de Ejercicios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar un catálogo global de 1,324 ejercicios (GIF, multi-idioma, músculos, equipo) a FitCore, reemplazando `ejercicio_maestro`, con biblioteca visual en panel + app, filtro por equipo y generador de rutinas.

**Architecture:** Tabla nueva `ejercicio_catalogo` (global, rica) poblada por un script Node idempotente desde el dataset. Medios a Supabase Storage. El trigger de herencia existente se re-apunta al catálogo nuevo. RPCs SECURITY DEFINER exponen búsqueda/detalle/generación al panel y a la app.

**Tech Stack:** Postgres (Supabase), `pg` (Node, ya instalado), `@supabase/supabase-js` (para Storage), React + Vite + Tailwind (panel), migraciones vía `psql -f`.

## Global Constraints

- **Migraciones**: archivos en `supabase/migrations/AAAAMMDD######_nombre.sql`, aplicadas con `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f <archivo>`. UTF-8, newline `\n`.
- **NUNCA imprimir `DATABASE_URL`** ni la service_role key.
- **Límite Vercel Hobby: ≤12 funciones serverless** (`api/**/*.js` no prefijados con `_`). Hoy estamos en 12 → NO agregar funciones nuevas; consolidar con `?action=` si hiciera falta.
- **Scripts de datos** viven en `scripts/` (no cuentan como funciones serverless).
- **RLS multi-tenant**: `ejercicio_catalogo` es global (sin `empresa_id`): SELECT para `authenticated`, escritura solo `service_role`. RPCs SECURITY DEFINER con grant explícito.
- **Commit trailer**: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Project ref Supabase**: `zlmqdubrjzmagslcsqvb`. Storage público → URL `https://zlmqdubrjzmagslcsqvb.supabase.co/storage/v1/object/public/<bucket>/<path>`.
- **Datos de origen**: `scripts/datos-ejercicios/exercises.json` (1,324, gitignored) y `scripts/datos-ejercicios/nombres_es.txt` (mapa `ext_id\tnombre_es`, validado 1324/1324).
- **Verificación DB**: probar cambios de comportamiento en transacción `begin; … rollback;` antes de aplicar en firme.
- **Tests/build**: al cerrar, `npm test` (23/23) y `npm run build` deben quedar limpios.

## Prerequisito del owner (BLOQUEA la Fase B — medios)

La subida a Storage necesita la **service_role key** de Supabase (Settings → API →
`service_role`). Guardarla en `.env` como `SUPABASE_SERVICE_ROLE_KEY=...` (gitignored).
Sin ella, las Tasks 1–4 y 8–13 corren igual; solo las Tasks 5–7 (medios) quedan
en espera. El plan lo indica en cada task afectada.

## File Structure

- `supabase/migrations/20260714000001_ejercicio_catalogo.sql` — tabla + índices + RLS.
- `supabase/migrations/20260714000002_ejercicio_catalogo_rpcs.sql` — RPCs búsqueda/detalle.
- `supabase/migrations/20260714000003_herencia_a_catalogo.sql` — migra maestro→catálogo, re-apunta trigger.
- `supabase/migrations/20260714000004_sede_equipo.sql` — tabla equipo por sede + RPC filtro.
- `supabase/migrations/20260714000005_generar_rutina.sql` — RPC generador de plantilla.
- `scripts/importar-ejercicios.mjs` — carga idempotente del JSON → `ejercicio_catalogo`.
- `scripts/subir-medios-ejercicios.mjs` — sube imágenes/GIF a Storage + actualiza URLs.
- `src/hooks/useCatalogoEjercicios.js` — hooks React (búsqueda, detalle, generar).
- `src/pages/config/TabEquipo.jsx` — checklist de equipo por sede (Feature 2).
- `src/components/forms/BuscadorEjercicios.jsx` — buscador con GIF reutilizable (panel).
- `src/pages/Rutinas.jsx` — integrar el buscador al armado de rutinas (modificar).
- `docs/APP-BACKEND-REQUESTS.md` — PEDIDO para el agente de la app (modificar).

---

## Task 1: Tabla `ejercicio_catalogo` + índices + RLS

**Files:**
- Create: `supabase/migrations/20260714000001_ejercicio_catalogo.sql`

**Interfaces:**
- Produces: tabla `public.ejercicio_catalogo` con columnas `id, ext_id, nombre, nombre_es, body_part, grupo_muscular, target, secondary text[], equipment, instrucciones jsonb, pasos jsonb, media_id, foto_url, gif_url, attribution, activo, created_at, updated_at`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Catálogo GLOBAL de ejercicios (reemplaza ejercicio_maestro como fuente).
-- 1,324 ejercicios con GIF, instrucciones/pasos multi-idioma, músculos y equipo.
-- Fuente: hasaneyldrm/exercises-dataset (MIT; media © Gymvisual).
create table if not exists public.ejercicio_catalogo (
  id             uuid primary key default gen_random_uuid(),
  ext_id         text not null unique,          -- "0001" del dataset (idempotencia)
  nombre         text not null,                 -- inglés (fuente)
  nombre_es      text,                          -- traducción curada
  body_part      text not null,
  grupo_muscular text,
  target         text,
  secondary      text[] not null default '{}',
  equipment      text,
  instrucciones  jsonb not null default '{}'::jsonb,  -- {en, es, ...}
  pasos          jsonb not null default '{}'::jsonb,  -- {en:[...], es:[...]}
  media_id       text,
  foto_url       text,
  gif_url        text,
  attribution    text,
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists ejercicio_catalogo_body_part_idx on public.ejercicio_catalogo (body_part);
create index if not exists ejercicio_catalogo_equipment_idx on public.ejercicio_catalogo (equipment);
create index if not exists ejercicio_catalogo_target_idx    on public.ejercicio_catalogo (target);
create extension if not exists pg_trgm with schema extensions;
create index if not exists ejercicio_catalogo_nombre_trgm on public.ejercicio_catalogo
  using gin ((coalesce(nombre_es,'') || ' ' || nombre) extensions.gin_trgm_ops);

alter table public.ejercicio_catalogo enable row level security;
-- Catálogo global de solo lectura: cualquier usuario autenticado lo ve.
drop policy if exists ejercicio_catalogo_sel on public.ejercicio_catalogo;
create policy ejercicio_catalogo_sel on public.ejercicio_catalogo
  for select to authenticated using (true);
-- Escritura solo por el backend (service_role bypassa RLS; no hay policy de write).
```

- [ ] **Step 2: Aplicar la migración**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260714000001_ejercicio_catalogo.sql`
Expected: `CREATE TABLE`, `CREATE INDEX` (varias), `CREATE EXTENSION`, `CREATE POLICY`, sin error.

- [ ] **Step 3: Verificar estructura**

Run: `psql "$(cat /tmp/.dburl)" -tc "select count(*) as cols from information_schema.columns where table_name='ejercicio_catalogo';"`
Expected: `18`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714000001_ejercicio_catalogo.sql
git commit -m "feat(ejercicios): tabla ejercicio_catalogo (global, rica) + RLS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Script de importación idempotente

**Files:**
- Create: `scripts/importar-ejercicios.mjs`

**Interfaces:**
- Consumes: tabla `ejercicio_catalogo` (Task 1); `scripts/datos-ejercicios/exercises.json`; `scripts/datos-ejercicios/nombres_es.txt`.
- Produces: 1,324 filas en `ejercicio_catalogo` con `nombre_es` poblado, `foto_url`/`gif_url` en null (se llenan en Task 6).

- [ ] **Step 1: Escribir el script**

```js
// Importa el dataset de ejercicios a ejercicio_catalogo (idempotente por ext_id).
// Uso: DATABASE_URL debe estar en el entorno (o pasar --dburl). Corre 1 vez.
//   node scripts/importar-ejercicios.mjs
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const DIR = path.join(process.cwd(), 'scripts', 'datos-ejercicios')
const ejercicios = JSON.parse(fs.readFileSync(path.join(DIR, 'exercises.json'), 'utf8'))

// mapa ext_id -> nombre_es (formato "0001\tabdominal 3/4")
const nombresEs = {}
for (const linea of fs.readFileSync(path.join(DIR, 'nombres_es.txt'), 'utf8').split(/\r?\n/)) {
  if (!linea.trim()) continue
  const t = linea.split('\t')
  if (t.length >= 2) nombresEs[t[0].trim()] = t.slice(1).join(' ').trim()
}

const dburl = process.env.DATABASE_URL
if (!dburl) { console.error('Falta DATABASE_URL en el entorno'); process.exit(1) }
const pool = new pg.Pool({ connectionString: dburl, ssl: { rejectUnauthorized: false }, max: 1 })

let ok = 0
for (const e of ejercicios) {
  await pool.query(
    `insert into public.ejercicio_catalogo
       (ext_id, nombre, nombre_es, body_part, grupo_muscular, target, secondary,
        equipment, instrucciones, pasos, media_id, attribution)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (ext_id) do update set
       nombre=excluded.nombre, nombre_es=excluded.nombre_es, body_part=excluded.body_part,
       grupo_muscular=excluded.grupo_muscular, target=excluded.target, secondary=excluded.secondary,
       equipment=excluded.equipment, instrucciones=excluded.instrucciones, pasos=excluded.pasos,
       media_id=excluded.media_id, attribution=excluded.attribution, updated_at=now()`,
    [e.id, e.name, nombresEs[e.id] || null, e.body_part, e.muscle_group || null,
     e.target || null, e.secondary_muscles || [], e.equipment || null,
     JSON.stringify(e.instructions || {}), JSON.stringify(e.instruction_steps || {}),
     e.media_id || null, e.attribution || null])
  ok++
  if (ok % 200 === 0) console.log(`  ${ok}/${ejercicios.length}`)
}
console.log(`Importados: ${ok}`)
await pool.end()
```

- [ ] **Step 2: Correr la importación**

Run: `DATABASE_URL="$(cat /tmp/.dburl)" node scripts/importar-ejercicios.mjs`
Expected: imprime progreso y `Importados: 1324`.

- [ ] **Step 3: Verificar filas y nombre_es**

Run: `psql "$(cat /tmp/.dburl)" -tc "select count(*) total, count(nombre_es) con_es from public.ejercicio_catalogo;"`
Expected: `1324 | 1324`

- [ ] **Step 4: Verificar idempotencia (re-correr no duplica)**

Run: `DATABASE_URL="$(cat /tmp/.dburl)" node scripts/importar-ejercicios.mjs && psql "$(cat /tmp/.dburl)" -tc "select count(*) from public.ejercicio_catalogo;"`
Expected: `1324` (igual que antes).

- [ ] **Step 5: Commit**

```bash
git add scripts/importar-ejercicios.mjs
git commit -m "feat(ejercicios): script de importación idempotente (1324 al catálogo)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: RPC de búsqueda paginada

**Files:**
- Create: `supabase/migrations/20260714000002_ejercicio_catalogo_rpcs.sql`

**Interfaces:**
- Consumes: `ejercicio_catalogo` poblada (Tasks 1–2).
- Produces: `buscar_ejercicios_catalogo(p_texto text, p_body_part text, p_equipment text, p_target text, p_offset int, p_limit int) returns setof jsonb`; `ejercicio_catalogo_detalle(p_id uuid, p_idioma text) returns jsonb`.

- [ ] **Step 1: Escribir la migración con ambas RPCs**

```sql
-- Búsqueda paginada del catálogo (para el buscador del panel y de la app).
create or replace function public.buscar_ejercicios_catalogo(
  p_texto text default null, p_body_part text default null,
  p_equipment text default null, p_target text default null,
  p_offset int default 0, p_limit int default 30)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id,
    'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular,
    'target', target, 'equipment', equipment, 'gif_url', gif_url, 'foto_url', foto_url)
  from public.ejercicio_catalogo
  where activo
    and (p_texto is null or (coalesce(nombre_es,'') || ' ' || nombre) ilike '%'||p_texto||'%')
    and (p_body_part is null or body_part = p_body_part)
    and (p_equipment is null or equipment = p_equipment)
    and (p_target is null or target = p_target)
  order by coalesce(nombre_es, nombre)
  offset greatest(p_offset,0) limit least(coalesce(p_limit,30), 60);
$$;
revoke all on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int) from public;
grant execute on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int) to authenticated, service_role;

-- Detalle de un ejercicio con pasos en el idioma pedido (default español).
create or replace function public.ejercicio_catalogo_detalle(p_id uuid, p_idioma text default 'es')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id, 'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular, 'target', target,
    'secondary', secondary, 'equipment', equipment, 'gif_url', gif_url, 'foto_url', foto_url,
    'attribution', attribution,
    'instruccion', coalesce(instrucciones->>p_idioma, instrucciones->>'es', instrucciones->>'en'),
    'pasos', coalesce(pasos->p_idioma, pasos->'es', pasos->'en', '[]'::jsonb))
  from public.ejercicio_catalogo where id = p_id and activo;
$$;
revoke all on function public.ejercicio_catalogo_detalle(uuid,text) from public;
grant execute on function public.ejercicio_catalogo_detalle(uuid,text) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar la migración**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260714000002_ejercicio_catalogo_rpcs.sql`
Expected: `CREATE FUNCTION` x2, `GRANT` x2, sin error.

- [ ] **Step 3: Probar búsqueda (por texto y por filtro)**

Run: `psql "$(cat /tmp/.dburl)" -tc "select count(*) from public.buscar_ejercicios_catalogo('curl', null, 'dumbbell', null, 0, 60);"`
Expected: un número > 0 (ejercicios de curl con mancuerna).

- [ ] **Step 4: Probar detalle (pasos en español)**

Run: `psql "$(cat /tmp/.dburl)" -tc "select public.ejercicio_catalogo_detalle((select id from public.ejercicio_catalogo where ext_id='0001'),'es')->>'pasos';"`
Expected: un array JSON con pasos en español.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260714000002_ejercicio_catalogo_rpcs.sql
git commit -m "feat(ejercicios): RPCs buscar_ejercicios_catalogo + detalle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Migrar maestro→catálogo y re-apuntar el trigger de herencia

**Files:**
- Create: `supabase/migrations/20260714000003_herencia_a_catalogo.sql`

**Interfaces:**
- Consumes: `ejercicio_catalogo` (Task 1), `ejercicio_maestro`, `trg_ejercicio_hereda_maestro` (existente).
- Produces: trigger `trg_ejercicio_hereda_maestro` reescrito para leer de `ejercicio_catalogo`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Reemplazo de la fuente de herencia: ahora los ejercicios de los gyms heredan
-- media/datos de ejercicio_catalogo (no del viejo ejercicio_maestro, deprecado).

-- 1) Traer del maestro viejo lo que NO esté ya en el catálogo (por nombre),
--    para no perder contenido curado. ext_id 'maestro-<uuid>' los distingue.
insert into public.ejercicio_catalogo (ext_id, nombre, body_part, grupo_muscular, foto_url, gif_url, instrucciones)
select 'maestro-' || m.id, m.nombre, 'other', m.grupo_muscular, m.foto_url, m.video_url,
       jsonb_build_object('es', coalesce(m.descripcion,''))
from public.ejercicio_maestro m
where not exists (
  select 1 from public.ejercicio_catalogo c
  where lower(c.nombre) = lower(m.nombre) or lower(coalesce(c.nombre_es,'')) = lower(m.nombre))
on conflict (ext_id) do nothing;

-- 2) Reescribir el trigger para leer del catálogo (casando por nombre EN o ES).
create or replace function public.trg_ejercicio_hereda_maestro()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_c public.ejercicio_catalogo;
begin
  if new.descripcion is null and new.video_url is null and new.foto_url is null then
    select * into v_c from public.ejercicio_catalogo
      where lower(nombre) = lower(new.nombre) or lower(coalesce(nombre_es,'')) = lower(new.nombre)
      limit 1;
    if v_c.id is not null then
      new.descripcion    := coalesce(v_c.instrucciones->>'es', v_c.instrucciones->>'en');
      new.video_url      := v_c.gif_url;
      new.foto_url       := v_c.foto_url;
      new.grupo_muscular := coalesce(new.grupo_muscular, v_c.grupo_muscular);
    end if;
  end if;
  return new;
end;
$function$;
-- (El trigger ya está enganchado a public.ejercicio; solo cambia el cuerpo.)
```

- [ ] **Step 2: Probar en rollback ANTES de aplicar en firme**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i supabase/migrations/20260714000003_herencia_a_catalogo.sql
-- crear un ejercicio en un gym con un nombre del catálogo (sin media) y ver si hereda
select id as emp from public.empresa order by created_at limit 1 \gset
insert into public.ejercicio (empresa_id, nombre) values (:'emp'::uuid, '3/4 sit-up')
  returning (foto_url is not null) as heredo_foto, (video_url is not null) as heredo_gif;
rollback;
SQL
```
Expected: `heredo_foto`/`heredo_gif` en `t` si el catálogo ya tiene media (tras Task 6); si aún no hay media, al menos `descripcion` se hereda. Sin error.

- [ ] **Step 3: Aplicar en firme**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260714000003_herencia_a_catalogo.sql`
Expected: `INSERT 0 N`, `CREATE FUNCTION`, sin error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714000003_herencia_a_catalogo.sql
git commit -m "feat(ejercicios): herencia lee de ejercicio_catalogo (deprecar maestro)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Crear bucket de Storage

**Prerequisito:** `SUPABASE_SERVICE_ROLE_KEY` en `.env` (ver sección Prerequisito).

**Files:**
- (ninguno; operación de Storage vía SQL)

**Interfaces:**
- Produces: bucket público `ejercicios` en Storage.

- [ ] **Step 1: Crear el bucket (idempotente)**

Run:
```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -c "insert into storage.buckets (id, name, public) values ('ejercicios','ejercicios', true) on conflict (id) do update set public=true;"
```
Expected: `INSERT 0 1` o `UPDATE 1`.

- [ ] **Step 2: Verificar**

Run: `psql "$(cat /tmp/.dburl)" -tc "select id, public from storage.buckets where id='ejercicios';"`
Expected: `ejercicios | t`

- [ ] **Step 3: Commit** (nada que versionar; se documenta en el mensaje)

```bash
git commit --allow-empty -m "chore(ejercicios): bucket público 'ejercicios' en Storage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Subir medios a Storage + actualizar URLs

**Prerequisito:** `SUPABASE_SERVICE_ROLE_KEY` en `.env`; bucket creado (Task 5); repo del dataset clonado en `scripts/datos-ejercicios/exercises-dataset/` (con `images/` y `videos/`).

**Files:**
- Create: `scripts/subir-medios-ejercicios.mjs`

**Interfaces:**
- Consumes: `ejercicio_catalogo` (ext_id, media_id), bucket `ejercicios`.
- Produces: objetos en Storage + `foto_url`/`gif_url` actualizados en cada fila.

- [ ] **Step 1: Asegurar los archivos de medios**

Run:
```bash
ls scripts/datos-ejercicios/exercises-dataset/images/*.jpg | head -1 && ls scripts/datos-ejercicios/exercises-dataset/videos/*.gif | head -1
```
Expected: rutas de ejemplo (si falta, clonar el repo dentro de `scripts/datos-ejercicios/`).

- [ ] **Step 2: Escribir el script**

```js
// Sube imágenes y GIF de ejercicios a Supabase Storage (bucket 'ejercicios')
// y guarda las URLs públicas en ejercicio_catalogo. Idempotente (upsert).
// Uso: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y DATABASE_URL en el entorno.
//   node scripts/subir-medios-ejercicios.mjs
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || 'https://zlmqdubrjzmagslcsqvb.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DB = process.env.DATABASE_URL
if (!KEY || !DB) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY o DATABASE_URL'); process.exit(1) }

const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const pool = new pg.Pool({ connectionString: DB, ssl: { rejectUnauthorized: false }, max: 1 })
const BASE = path.join(process.cwd(), 'scripts', 'datos-ejercicios', 'exercises-dataset')

// La media del dataset se nombra "<ext_id>-<media_id>.jpg|gif".
function nombreArchivo(row, ext) {
  return `${row.ext_id}-${row.media_id}.${ext}`
}

async function subir(localPath, destPath, contentType) {
  const buf = fs.readFileSync(localPath)
  const { error } = await sb.storage.from('ejercicios').upload(destPath, buf, {
    contentType, upsert: true,
  })
  if (error) throw error
  return sb.storage.from('ejercicios').getPublicUrl(destPath).data.publicUrl
}

const { rows } = await pool.query(`select id, ext_id, media_id from public.ejercicio_catalogo where ext_id not like 'maestro-%'`)
let n = 0
for (const row of rows) {
  const img = path.join(BASE, 'images', nombreArchivo(row, 'jpg'))
  const gif = path.join(BASE, 'videos', nombreArchivo(row, 'gif'))
  let fotoUrl = null, gifUrl = null
  if (fs.existsSync(img)) fotoUrl = await subir(img, `img/${row.ext_id}.jpg`, 'image/jpeg')
  if (fs.existsSync(gif)) gifUrl = await subir(gif, `gif/${row.ext_id}.gif`, 'image/gif')
  await pool.query(`update public.ejercicio_catalogo set foto_url=$1, gif_url=$2, updated_at=now() where id=$3`,
    [fotoUrl, gifUrl, row.id])
  n++
  if (n % 100 === 0) console.log(`  ${n}/${rows.length}`)
}
console.log(`Medios subidos/actualizados: ${n}`)
await pool.end()
```

- [ ] **Step 3: Correr la subida**

Run: `SUPABASE_SERVICE_ROLE_KEY="<key>" DATABASE_URL="$(cat /tmp/.dburl)" node scripts/subir-medios-ejercicios.mjs`
Expected: progreso y `Medios subidos/actualizados: 1324` (o el número que exista).

- [ ] **Step 4: Verificar URL pública real (HTTP 200)**

Run:
```bash
url=$(psql "$(cat /tmp/.dburl)" -tAc "select gif_url from public.ejercicio_catalogo where ext_id='0001';") && curl -s -o /dev/null -w "%{http_code}\n" "$url"
```
Expected: `200`

- [ ] **Step 5: Commit**

```bash
git add scripts/subir-medios-ejercicios.mjs
git commit -m "feat(ejercicios): subir medios (img+gif) a Storage + URLs en catálogo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Hooks React del catálogo

**Files:**
- Create: `src/hooks/useCatalogoEjercicios.js`

**Interfaces:**
- Consumes: RPCs `buscar_ejercicios_catalogo`, `ejercicio_catalogo_detalle` (Task 3).
- Produces: `useBuscarEjercicios(filtros)`, `useEjercicioDetalle(id)` (hooks de `@tanstack/react-query`).

- [ ] **Step 1: Escribir los hooks**

```js
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Busca en el catálogo global. filtros = { texto, body_part, equipment, target, offset, limit }
export function useBuscarEjercicios(filtros = {}) {
  const { texto, body_part, equipment, target, offset = 0, limit = 30 } = filtros
  return useQuery({
    queryKey: ['catalogo-ejercicios', texto, body_part, equipment, target, offset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('buscar_ejercicios_catalogo', {
        p_texto: texto || null, p_body_part: body_part || null,
        p_equipment: equipment || null, p_target: target || null,
        p_offset: offset, p_limit: limit,
      })
      if (error) throw error
      return data || []
    },
  })
}

// Detalle de un ejercicio (pasos en español por defecto).
export function useEjercicioDetalle(id, idioma = 'es') {
  return useQuery({
    queryKey: ['catalogo-ejercicio', id, idioma],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ejercicio_catalogo_detalle', { p_id: id, p_idioma: idioma })
      if (error) throw error
      return data
    },
  })
}
```

- [ ] **Step 2: Verificar que compila (build)**

Run: `npm run build 2>&1 | grep -iE "error|built in" | tail -3`
Expected: `✓ built in ...`, sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCatalogoEjercicios.js
git commit -m "feat(ejercicios): hooks useBuscarEjercicios + useEjercicioDetalle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Buscador de ejercicios con GIF (componente)

**Files:**
- Create: `src/components/forms/BuscadorEjercicios.jsx`

**Interfaces:**
- Consumes: `useBuscarEjercicios`, `useEjercicioDetalle` (Task 7).
- Produces: `<BuscadorEjercicios onElegir={(ej) => ...} />` — lista con GIF, filtros por body_part/equipment/target, y callback al elegir un ejercicio.

- [ ] **Step 1: Escribir el componente**

```jsx
import { useState } from 'react'
import { useBuscarEjercicios } from '../../hooks/useCatalogoEjercicios.js'
import { LoadingState, ErrorState } from '../states.jsx'

// Taxonomías del dataset (fijas). Se muestran en español donde aplica.
const BODY_PARTS = ['back','cardio','chest','lower arms','lower legs','neck','shoulders','upper arms','upper legs','waist']
const EQUIPOS = ['assisted','band','barbell','body weight','bosu ball','cable','dumbbell','kettlebell','leverage machine','medicine ball','resistance band','smith machine','stability ball','weighted']

export default function BuscadorEjercicios({ onElegir }) {
  const [texto, setTexto] = useState('')
  const [bodyPart, setBodyPart] = useState('')
  const [equipo, setEquipo] = useState('')
  const q = useBuscarEjercicios({ texto, body_part: bodyPart, equipment: equipo, limit: 30 })
  const items = q.data || []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar ejercicio…"
          className="min-w-[180px] flex-1 rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange" />
        <select value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} className="cursor-pointer rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold">
          <option value="">Zona</option>
          {BODY_PARTS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={equipo} onChange={(e) => setEquipo(e.target.value)} className="cursor-pointer rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold">
          <option value="">Equipo</option>
          {EQUIPOS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      {q.isLoading && <LoadingState variant="cards" rows={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {!q.isLoading && !q.isError && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((ej) => (
            <button key={ej.id} onClick={() => onElegir?.(ej)}
              className="flex cursor-pointer flex-col overflow-hidden rounded-[12px] border border-line bg-white text-left transition-colors hover:border-orange">
              {ej.gif_url
                ? <img src={ej.gif_url} alt="" loading="lazy" className="h-[130px] w-full bg-[#0B0E14] object-contain" />
                : <div className="flex h-[130px] items-center justify-center bg-surface text-[11px] font-bold text-faint">Sin GIF</div>}
              <div className="p-2.5">
                <div className="line-clamp-2 text-[12.5px] font-extrabold leading-tight">{ej.nombre}</div>
                <div className="mt-1 text-[10.5px] font-bold text-muted">{ej.target || ej.body_part} · {ej.equipment || ''}</div>
              </div>
            </button>
          ))}
          {items.length === 0 && <div className="col-span-full py-6 text-center text-[12.5px] font-semibold text-muted">Sin resultados. Prueba otro filtro.</div>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build 2>&1 | grep -iE "error|built in" | tail -3`
Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

```bash
git add src/components/forms/BuscadorEjercicios.jsx
git commit -m "feat(ejercicios): componente BuscadorEjercicios con GIF y filtros

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Integrar el buscador al armado de rutinas (panel)

**Files:**
- Modify: `src/pages/Rutinas.jsx`

**Interfaces:**
- Consumes: `<BuscadorEjercicios>` (Task 8).
- Produces: en Rutinas.jsx, un modal/panel "Agregar del catálogo" que al elegir un ejercicio lo materializa en `public.ejercicio` del gym (heredando media por el trigger) y lo añade a la rutina/plantilla en edición.

- [ ] **Step 1: Leer Rutinas.jsx e identificar el punto de "agregar ejercicio"**

Run: `grep -nE "ejercicio|agregar|from\\('ejercicio'\\)|rutina_ejercicio|plantilla_rutina_ejercicio" src/pages/Rutinas.jsx | head -30`
Expected: localizar dónde hoy se añade un ejercicio a una rutina/plantilla.

- [ ] **Step 2: Escribir el helper que materializa un ejercicio del catálogo en `ejercicio`**

En Rutinas.jsx, agregar (adaptando a los nombres reales del archivo):
```jsx
import BuscadorEjercicios from '../components/forms/BuscadorEjercicios.jsx'
import { supabase } from '../lib/supabaseClient.js'

// Convierte un ejercicio del catálogo global en un ejercicio del gym (idempotente
// por nombre). El trigger de herencia copia la media del catálogo la 1ª vez.
async function materializarEjercicio(empresaId, ej) {
  // ¿ya existe por nombre en este gym?
  const { data: existente } = await supabase.from('ejercicio')
    .select('id').eq('empresa_id', empresaId).ilike('nombre', ej.nombre).limit(1).maybeSingle()
  if (existente) return existente.id
  const { data, error } = await supabase.from('ejercicio')
    .insert({ empresa_id: empresaId, nombre: ej.nombre, grupo_muscular: ej.grupo_muscular || ej.body_part })
    .select('id').single()
  if (error) throw error
  return data.id
}
```

- [ ] **Step 3: Montar el buscador en un modal "Agregar del catálogo"**

Agregar estado y UI (adaptar al patrón de modales del archivo — `Modal` de `components/Modal.jsx`):
```jsx
// dentro del componente de edición de rutina/plantilla:
const [catalogoOpen, setCatalogoOpen] = useState(false)
// ...botón:
<button onClick={() => setCatalogoOpen(true)}
  className="cursor-pointer rounded-[10px] border border-orange bg-transparent px-4 py-2 text-[13px] font-extrabold text-orange hover:bg-orange-50">
  📚 Agregar del catálogo
</button>
// ...modal:
{catalogoOpen && (
  <Modal title="Catálogo de ejercicios" subtitle="Elige uno para agregarlo a la rutina" width={720} onClose={() => setCatalogoOpen(false)}>
    <BuscadorEjercicios onElegir={async (ej) => {
      try {
        const ejercicioId = await materializarEjercicio(empresaId, ej)
        // añadir ejercicioId a la rutina/plantilla en edición (usar la función que ya exista)
        await agregarEjercicioARutina(ejercicioId, ej.nombre)
        toast.ok(`${ej.nombre} agregado`)
        setCatalogoOpen(false)
      } catch (e) { toast.error(e.message) }
    }} />
  </Modal>
)}
```

- [ ] **Step 4: Verificar build + test**

Run: `npm run build 2>&1 | grep -iE "error|built in" | tail -3 && npm test 2>&1 | grep -iE "Tests|failed" | tail -2`
Expected: build OK, `Tests 23 passed (23)`.

- [ ] **Step 5: Verificar en el navegador (manual, con Playwright o dev server)**

Abrir Rutinas, pulsar "Agregar del catálogo", buscar "curl", elegir uno, confirmar que aparece en la rutina y que su GIF se ve. Sin errores de consola.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Rutinas.jsx
git commit -m "feat(ejercicios): agregar ejercicios del catálogo a rutinas (panel)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Tabla de equipo por sede + filtro (Feature 2)

**Files:**
- Create: `supabase/migrations/20260714000004_sede_equipo.sql`

**Interfaces:**
- Consumes: `buscar_ejercicios_catalogo` (Task 3), tabla `sede`.
- Produces: tabla `sede_equipo(sede_id, equipment, disponible)`; RPC `equipo_de_sede(p_sede_id)`; extensión de `buscar_ejercicios_catalogo` con `p_sede_id` (filtra a equipo disponible + siempre incluye 'body weight').

- [ ] **Step 1: Escribir la migración**

```sql
-- Equipo que cada sede tiene, para filtrar el catálogo a lo que puede hacer.
create table if not exists public.sede_equipo (
  sede_id     uuid not null references public.sede(id) on delete cascade,
  empresa_id  uuid not null references public.empresa(id) on delete cascade,
  equipment   text not null,
  disponible  boolean not null default true,
  primary key (sede_id, equipment)
);
alter table public.sede_equipo enable row level security;
drop policy if exists sede_equipo_rw on public.sede_equipo;
create policy sede_equipo_rw on public.sede_equipo for all to authenticated
  using (empresa_id = auth_empresa_id()) with check (empresa_id = auth_empresa_id());

-- Lista el equipo marcado de una sede (para pintar el checklist del panel).
create or replace function public.equipo_de_sede(p_sede_id uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select equipment from public.sede_equipo where sede_id = p_sede_id and disponible;
$$;
grant execute on function public.equipo_de_sede(uuid) to authenticated, service_role;

-- Nueva sobrecarga de búsqueda que cruza con el equipo de la sede (body weight
-- siempre disponible: no requiere equipo).
create or replace function public.buscar_ejercicios_catalogo(
  p_texto text, p_body_part text, p_equipment text, p_target text,
  p_offset int, p_limit int, p_sede_id uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', id, 'ext_id', ext_id, 'nombre', coalesce(nombre_es, nombre), 'nombre_en', nombre,
    'body_part', body_part, 'grupo_muscular', grupo_muscular, 'target', target,
    'equipment', equipment, 'gif_url', gif_url, 'foto_url', foto_url)
  from public.ejercicio_catalogo c
  where activo
    and (p_texto is null or (coalesce(nombre_es,'') || ' ' || nombre) ilike '%'||p_texto||'%')
    and (p_body_part is null or body_part = p_body_part)
    and (p_equipment is null or equipment = p_equipment)
    and (p_target is null or target = p_target)
    and (p_sede_id is null or equipment = 'body weight'
         or equipment in (select equipment from public.sede_equipo where sede_id = p_sede_id and disponible))
  order by coalesce(nombre_es, nombre)
  offset greatest(p_offset,0) limit least(coalesce(p_limit,30), 60);
$$;
revoke all on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int,uuid) from public;
grant execute on function public.buscar_ejercicios_catalogo(text,text,text,text,int,int,uuid) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar la migración**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260714000004_sede_equipo.sql`
Expected: `CREATE TABLE`, `CREATE POLICY`, `CREATE FUNCTION` x2, `GRANT`, sin error.

- [ ] **Step 3: Probar el filtro en rollback**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
select id as sede from public.sede order by created_at limit 1 \gset
select empresa_id as emp from public.sede where id=:'sede'::uuid \gset
insert into public.sede_equipo(sede_id, empresa_id, equipment) values (:'sede'::uuid, :'emp'::uuid, 'dumbbell');
-- con sede: solo dumbbell + body weight
select count(*) as con_filtro from public.buscar_ejercicios_catalogo(null,null,null,null,0,60,:'sede'::uuid);
-- sin sede: todo
select count(*) as sin_filtro from public.buscar_ejercicios_catalogo(null,null,null,null,0,60,null);
rollback;
SQL
```
Expected: `con_filtro` < `sin_filtro`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260714000004_sede_equipo.sql
git commit -m "feat(ejercicios): equipo por sede + filtro del catálogo (Feature 2)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: UI de equipo por sede (checklist)

**Files:**
- Create: `src/pages/config/TabEquipo.jsx`
- Modify: `src/pages/Configuracion.jsx`

**Interfaces:**
- Consumes: `equipo_de_sede` (Task 10), tabla `sede_equipo`.
- Produces: pestaña "Equipo" en Configuración con un checklist de los 28 tipos por sede.

- [ ] **Step 1: Escribir TabEquipo.jsx**

```jsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { toast } from '../../lib/toast.js'

const EQUIPOS = ['assisted','band','barbell','body weight','bosu ball','cable','dumbbell','elliptical machine','ez barbell','hammer','kettlebell','leverage machine','medicine ball','olympic barbell','resistance band','roller','rope','skierg machine','sled machine','smith machine','stability ball','stationary bike','stepmill machine','tire','trap bar','upper body ergometer','weighted','wheel roller']

export default function TabEquipo() {
  const { empresa } = useAuth()
  const { sedeId, sedeNombre } = usePanel()
  const qc = useQueryClient()
  const [guardando, setGuardando] = useState(null)

  const disp = useQuery({
    queryKey: ['equipo-sede', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('equipo_de_sede', { p_sede_id: sedeId })
      if (error) throw error
      return new Set(data || [])
    },
  })
  const marcados = disp.data || new Set()

  async function toggle(equipment) {
    setGuardando(equipment)
    const activo = marcados.has(equipment)
    try {
      if (activo) {
        await supabase.from('sede_equipo').delete().eq('sede_id', sedeId).eq('equipment', equipment)
      } else {
        await supabase.from('sede_equipo').upsert({ sede_id: sedeId, empresa_id: empresa.id, equipment, disponible: true })
      }
      qc.invalidateQueries({ queryKey: ['equipo-sede', sedeId] })
    } catch (e) { toast.error(e.message) } finally { setGuardando(null) }
  }

  return (
    <div className="max-w-[760px]">
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🏋️ Equipo de {sedeNombre}</div>
        <p className="mt-1 text-[13px] font-semibold text-muted">Marca el equipo que tiene esta sede. El catálogo de ejercicios y el generador de rutinas se limitarán a lo que puedes hacer aquí (los de peso corporal siempre están disponibles).</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EQUIPOS.map((eq) => {
            const on = marcados.has(eq)
            return (
              <button key={eq} onClick={() => toggle(eq)} disabled={guardando === eq}
                className={`cursor-pointer rounded-[10px] border px-3 py-2 text-left text-[12.5px] font-extrabold transition-colors disabled:opacity-50 ${on ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
                {on ? '✓ ' : ''}{eq}
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Registrar la pestaña en Configuracion.jsx**

Run: `grep -nE "TABS|key:|Comp:" src/pages/Configuracion.jsx | head -20`
Luego agregar el import y la entrada:
```jsx
import TabEquipo from './config/TabEquipo.jsx'
// en el array de TABS, después de una pestaña existente:
{ key: 'equipo', label: 'Equipo 🏋️', Comp: TabEquipo },
```

- [ ] **Step 3: Verificar build**

Run: `npm run build 2>&1 | grep -iE "error|built in" | tail -3`
Expected: `✓ built in ...`

- [ ] **Step 4: Commit**

```bash
git add src/pages/config/TabEquipo.jsx src/pages/Configuracion.jsx
git commit -m "feat(ejercicios): pestaña Equipo por sede (checklist)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: Generador de rutina por objetivo (Feature 3)

**Files:**
- Create: `supabase/migrations/20260714000005_generar_rutina.sql`

**Interfaces:**
- Consumes: `ejercicio_catalogo`, `objetivo_entrenamiento`, `sede_equipo`, tablas `plantilla_rutina*`.
- Produces: RPC `generar_plantilla_rutina(p_empresa_id uuid, p_sede_id uuid, p_objetivo_codigo text, p_dias int) returns uuid` (id de la plantilla creada).

- [ ] **Step 1: Escribir la migración**

```sql
-- Genera una plantilla de rutina editable a partir de un objetivo. Reparte
-- ejercicios del catálogo por zona (body_part) según el nº de días y aplica
-- series/reps/descanso por defecto según el objetivo. Respeta el equipo de sede.
create or replace function public.generar_plantilla_rutina(
  p_empresa_id uuid, p_sede_id uuid, p_objetivo_codigo text, p_dias int default 3)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_plantilla uuid;
  v_dia uuid;
  v_zonas text[] := array['chest','back','upper legs','shoulders','upper arms','waist'];
  v_series int; v_reps text; v_descanso text; v_por_dia int := 5;
  v_zona text; v_i int; v_orden int;
begin
  -- Parámetros por objetivo (enfoque del entrenamiento).
  case p_objetivo_codigo
    when 'ganar_masa' then v_series:=4; v_reps:='8-12'; v_descanso:='90s';
    when 'fuerza'     then v_series:=5; v_reps:='3-5';  v_descanso:='2-3 min';
    when 'resistencia'then v_series:=3; v_reps:='15-20';v_descanso:='30s';
    when 'bajar_peso' then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    when 'tonificar'  then v_series:=3; v_reps:='12-15';v_descanso:='45s';
    else v_series:=3; v_reps:='10-12'; v_descanso:='60s';
  end case;

  insert into public.plantilla_rutina (empresa_id, nombre, objetivo_codigo)
  values (p_empresa_id, 'Rutina ' || initcap(replace(p_objetivo_codigo,'_',' ')) || ' (' || p_dias || ' días)', p_objetivo_codigo)
  returning id into v_plantilla;

  for v_i in 1..p_dias loop
    v_zona := v_zonas[1 + ((v_i - 1) % array_length(v_zonas,1))];
    insert into public.plantilla_rutina_dia (plantilla_rutina_id, nombre, orden)
    values (v_plantilla, 'Día ' || v_i || ' · ' || v_zona, v_i)
    returning id into v_dia;

    v_orden := 0;
    insert into public.plantilla_rutina_ejercicio (plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, descanso, orden)
    select v_dia, null, coalesce(c.nombre_es, c.nombre), v_series, v_reps, v_descanso,
           (v_orden := v_orden + 1)
    from public.ejercicio_catalogo c
    where c.activo and c.body_part = v_zona
      and (c.equipment = 'body weight'
           or c.equipment in (select equipment from public.sede_equipo where sede_id = p_sede_id and disponible)
           or not exists (select 1 from public.sede_equipo where sede_id = p_sede_id))
    order by random()
    limit v_por_dia;
  end loop;

  return v_plantilla;
end $$;
revoke all on function public.generar_plantilla_rutina(uuid,uuid,text,int) from public;
grant execute on function public.generar_plantilla_rutina(uuid,uuid,text,int) to authenticated, service_role;
```

NOTA: si `plantilla_rutina` no tiene columna `objetivo_codigo`, agregarla primero
en esta misma migración: `alter table public.plantilla_rutina add column if not exists objetivo_codigo text;`
Verificar antes con: `psql "$(cat /tmp/.dburl)" -tc "select column_name from information_schema.columns where table_name='plantilla_rutina';"`

- [ ] **Step 2: Verificar columnas de plantilla_rutina y ajustar la migración**

Run: `psql "$(cat /tmp/.dburl)" -tc "select column_name from information_schema.columns where table_name='plantilla_rutina' order by ordinal_position;"`
Expected: revisar si existe `objetivo_codigo`; si no, dejar el `alter ... add column if not exists` al inicio de la migración.

- [ ] **Step 3: Aplicar la migración**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260714000005_generar_rutina.sql`
Expected: `CREATE FUNCTION`, `GRANT`, sin error.

- [ ] **Step 4: Probar el generador en rollback**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
select id as emp from public.empresa order by created_at limit 1 \gset
select id as sede from public.sede where empresa_id=:'emp'::uuid limit 1 \gset
select public.generar_plantilla_rutina(:'emp'::uuid, :'sede'::uuid, 'ganar_masa', 3) as plantilla \gset
select (select count(*) from public.plantilla_rutina_dia where plantilla_rutina_id=:'plantilla'::uuid) as dias,
       (select count(*) from public.plantilla_rutina_ejercicio e join public.plantilla_rutina_dia d on d.id=e.plantilla_rutina_dia_id where d.plantilla_rutina_id=:'plantilla'::uuid) as ejercicios;
rollback;
SQL
```
Expected: `dias = 3` y `ejercicios > 0` (idealmente ~15).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260714000005_generar_rutina.sql
git commit -m "feat(ejercicios): generar_plantilla_rutina por objetivo (Feature 3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 13: PEDIDO app + verificación final

**Files:**
- Modify: `docs/APP-BACKEND-REQUESTS.md`

**Interfaces:**
- Consumes: todas las RPCs anteriores.
- Produces: PEDIDO documentado para el agente de la app; verificación e2e del feature.

- [ ] **Step 1: Escribir el PEDIDO app**

Agregar al final de `docs/APP-BACKEND-REQUESTS.md`:
```
================================================================================
PEDIDO 36 -- Biblioteca de ejercicios (catálogo con GIF) en la app del socio
================================================================================

FitCore tiene un catálogo GLOBAL de 1,324 ejercicios (tabla ejercicio_catalogo)
con GIF animado, imagen, nombre en español, músculos y equipo, e instrucciones
paso a paso multi-idioma. Consúmelo desde la app así:

- Búsqueda:  supabase.rpc('buscar_ejercicios_catalogo', {
    p_texto, p_body_part, p_equipment, p_target, p_offset, p_limit })
    → [{ id, ext_id, nombre (ES), nombre_en, body_part, grupo_muscular, target,
         equipment, gif_url, foto_url }]  (paginado por offset, máx 60)
- Detalle:   supabase.rpc('ejercicio_catalogo_detalle', { p_id, p_idioma:'es' })
    → { ..., instruccion, pasos:[...] }  (pasos en el idioma pedido, cae a es/en)
- gif_url / foto_url son URLs públicas de Storage (bucket 'ejercicios') — se
  muestran directo.

USOS en la app: biblioteca navegable (con GIF), y mostrar el GIF+pasos de cada
ejercicio dentro de la rutina asignada al socio (rutina_ejercicio.ejercicio_id
casa por nombre con el catálogo si se requiere el GIF).

Ambas RPCs tienen grant a authenticated (cualquier socio logueado).

Creado: 2026-07-14 (catálogo de ejercicios).
```

- [ ] **Step 2: Verificación e2e completa**

Run:
```bash
cd "/d/Personal Proyects/ControlGym" && npm test 2>&1 | grep -iE "Tests|failed" | tail -2 && npm run build 2>&1 | grep -iE "error|built in" | tail -2 && find api -name '*.js' -not -path '*/_*' | grep -vE '/_' | wc -l
```
Expected: `Tests 23 passed (23)`, `✓ built in ...`, `12` (funciones serverless sin cambios).

- [ ] **Step 3: Verificación de datos**

Run: `psql "$(cat /tmp/.dburl)" -tc "select count(*) total, count(nombre_es) es, count(gif_url) con_gif from public.ejercicio_catalogo;"`
Expected: `1324 | 1324 | ~1324` (con_gif solo tras Task 6).

- [ ] **Step 4: Commit**

```bash
git add docs/APP-BACKEND-REQUESTS.md
git commit -m "docs(ejercicios): PEDIDO 36 app consume catálogo con GIF + cierre

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review (cobertura del spec)

- Tabla `ejercicio_catalogo` → Task 1 ✅
- Importación idempotente → Task 2 ✅
- RPCs búsqueda/detalle → Task 3 ✅
- Herencia re-apuntada + migrar maestro → Task 4 ✅
- Storage bucket + subida de medios → Tasks 5–6 ✅
- Hooks + buscador con GIF (panel) → Tasks 7–9 ✅
- Feature 2 (equipo por sede) → Tasks 10–11 ✅
- Feature 3 (generador) → Task 12 ✅
- PEDIDO app + verificación → Task 13 ✅

**Dependencias de orden:** Task 4 (herencia con media) y Task 9 (GIF visible) rinden
mejor tras Task 6 (medios). Si la service_role key no está lista, ejecutar 1–4 y
7–13 con la salvedad de que los GIF/URLs aparecen recién al correr Task 6.
