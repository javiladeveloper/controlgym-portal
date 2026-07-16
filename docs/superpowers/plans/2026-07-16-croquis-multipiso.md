# Croquis Multi-piso Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un gimnasio estructure su croquis por PISOS, ubique cada máquina en el plano del piso (arrastrar → x/y), y el socio pueda indicar su piso al pedir ayuda.

**Architecture:** Tabla nueva `sede_piso` (sede→pisos, cada uno con su plano). A `maquina` se le suman `piso_id/pos_x/pos_y` (aditivo). Editor visual en el panel (HTML/CSS puro, arrastrar). RPCs `pisos_de_sede`/`maquinas_del_piso`. `solicitud_ayuda` gana `piso_id`. La vista de la app queda como PEDIDO.

**Tech Stack:** Postgres (Supabase), migraciones vía `psql -f`, React+Vite+Tailwind panel, bucket Storage `branding`.

## Global Constraints

- **Migraciones**: `supabase/migrations/AAAAMMDD######_nombre.sql`, aplicadas con `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f <archivo>`. UTF-8.
- **NUNCA imprimir `DATABASE_URL`**.
- **Límite Vercel Hobby ≤12 funciones serverless** — NO agregar funciones nuevas.
- **Commit trailer**: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **Aditivo/retrocompatible**: las columnas de `maquina` son nullable; `sede.croquis_url` se conserva; las 6 máquinas actuales sin piso siguen válidas; `Maquinas.jsx` y el bootstrap no se rompen.
- **Coordenadas en %** (0-100), no píxeles — el plano escala en cualquier pantalla. Clampar 0-100.
- **RLS**: `sede_piso` sigue el patrón de `maquina` para staff (`empresa_id = auth_empresa_id() AND (sede_id in auth_sede_ids() OR auth_is_admin())`) MÁS lectura para el socio de esa sede (patrón `socio_app_sede` de la tabla `sede`).
- **Auth funcs existentes**: `auth_empresa_id()`, `auth_is_admin()`, `auth_sede_ids()`, `es_socio_de(p_empresa uuid)`.
- **Subir imagen**: `subirImagen(empresaId, folder, file)` de `src/hooks/useConfiguracion.js` → sube al bucket `branding`, devuelve URL pública. Usar folder `'croquis'`.
- **Máquinas**: tabla `maquina(id, empresa_id, sede_id, nombre, detalle, zona, unidades, estado, deleted_at)`; se leen con queryKey `['maquinas', sedeId]`.
- **Verificación DB**: probar en `begin; … rollback;` antes de cambios que muevan datos.
- **Tests/build**: al cerrar, `npm test` y `npm run build` limpios.

## File Structure

- `supabase/migrations/20260716000020_sede_piso.sql` — tabla `sede_piso` + columnas en `maquina` + RLS.
- `supabase/migrations/20260716000021_croquis_rpcs.sql` — RPCs `pisos_de_sede`, `maquinas_del_piso`, `ubicar_maquina` + `solicitud_ayuda.piso_id`.
- `src/hooks/useCroquis.js` — hooks React (pisos, guardar/borrar piso, ubicar máquina).
- `src/pages/config/TabCroquis.jsx` — editor de pisos + posicionador de máquinas (nuevo tab).
- `src/pages/Configuracion.jsx` — registrar el tab (modificar).
- `docs/APP-BACKEND-REQUESTS.md` — PEDIDO app (modificar).

---

## Task 1: Tabla `sede_piso` + columnas en `maquina` + RLS

**Files:**
- Create: `supabase/migrations/20260716000020_sede_piso.sql`

**Interfaces:**
- Produces: tabla `public.sede_piso(id, empresa_id, sede_id, nombre, orden, plano_url, created_at)`; columnas `maquina.piso_id/pos_x/pos_y`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Croquis multi-piso: una sede tiene varios pisos, cada uno con su plano; las
-- máquinas se ubican en un piso con coordenadas x/y (%). Aditivo: las columnas
-- de maquina son nullable, sede.croquis_url se conserva.
create table if not exists public.sede_piso (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  sede_id    uuid not null references public.sede(id) on delete cascade,
  nombre     text not null,
  orden      int not null default 0,
  plano_url  text,
  created_at timestamptz not null default now()
);
create index if not exists sede_piso_sede_idx on public.sede_piso (sede_id, orden);

alter table public.sede_piso enable row level security;
-- Staff: mismo alcance que maquina (empresa + sede propia o admin).
drop policy if exists sede_piso_staff on public.sede_piso;
create policy sede_piso_staff on public.sede_piso for all to authenticated
  using (empresa_id = public.auth_empresa_id()
         and (sede_id in (select public.auth_sede_ids()) or public.auth_is_admin()))
  with check (empresa_id = public.auth_empresa_id()
         and (sede_id in (select public.auth_sede_ids()) or public.auth_is_admin()));
-- Socio de la app: lee los pisos de su sede (patrón socio_app_sede).
drop policy if exists sede_piso_socio on public.sede_piso;
create policy sede_piso_socio on public.sede_piso for select to authenticated
  using (exists (
    select 1 from public.socio s
    where s.usuario_id = auth.uid() and s.sede_id = sede_piso.sede_id and s.deleted_at is null));

-- Ubicación de la máquina en un piso (aditivo, nullable).
alter table public.maquina add column if not exists piso_id uuid references public.sede_piso(id) on delete set null;
alter table public.maquina add column if not exists pos_x numeric;  -- % horizontal 0-100
alter table public.maquina add column if not exists pos_y numeric;  -- % vertical 0-100
```

- [ ] **Step 2: Aplicar**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260716000020_sede_piso.sql`
Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE POLICY` x2, `ALTER TABLE` x3, sin error.

- [ ] **Step 3: Verificar estructura + que maquina no se rompió**

Run:
```bash
psql "$(cat /tmp/.dburl)" -tAc "select count(*) from information_schema.columns where table_name='sede_piso';"
psql "$(cat /tmp/.dburl)" -tAc "select count(*) from information_schema.columns where table_name='maquina' and column_name in ('piso_id','pos_x','pos_y');"
psql "$(cat /tmp/.dburl)" -tAc "select count(*) from public.maquina where deleted_at is null;"
```
Expected: `7` (columnas sede_piso), `3` (columnas nuevas maquina), `6` (máquinas actuales intactas).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716000020_sede_piso.sql
git commit -m "feat(croquis): tabla sede_piso + posición (piso_id/pos_x/pos_y) en maquina

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: RPCs de croquis + `solicitud_ayuda.piso_id`

**Files:**
- Create: `supabase/migrations/20260716000021_croquis_rpcs.sql`

**Interfaces:**
- Consumes: `sede_piso`, `maquina` (Task 1).
- Produces: `pisos_de_sede(p_sede_id) → jsonb`; `maquinas_del_piso(p_piso_id) → jsonb`; `ubicar_maquina(p_maquina_id, p_piso_id, p_pos_x, p_pos_y) → jsonb`; columna `solicitud_ayuda.piso_id`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Pisos de una sede (para editor del panel y app). Lectura: staff o socio de la
-- sede (la RLS de sede_piso ya lo garantiza; security invoker respeta la RLS).
create or replace function public.pisos_de_sede(p_sede_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'orden', orden, 'plano_url', plano_url) order by orden, nombre), '[]'::jsonb)
  from public.sede_piso where sede_id = p_sede_id;
$$;
grant execute on function public.pisos_de_sede(uuid) to authenticated, service_role;

-- Máquinas UBICADAS en un piso (con su posición) — para pintar los pines.
create or replace function public.maquinas_del_piso(p_piso_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'nombre', nombre, 'zona', zona, 'estado', estado,
    'pos_x', pos_x, 'pos_y', pos_y) order by nombre), '[]'::jsonb)
  from public.maquina
  where piso_id = p_piso_id and deleted_at is null and pos_x is not null and pos_y is not null;
$$;
grant execute on function public.maquinas_del_piso(uuid) to authenticated, service_role;

-- Ubicar (o mover) una máquina en un piso. Clampa x/y a 0-100. Solo staff con
-- acceso a esa máquina (la RLS de maquina aplica en el update). security invoker.
create or replace function public.ubicar_maquina(p_maquina_id uuid, p_piso_id uuid, p_pos_x numeric, p_pos_y numeric)
returns jsonb language plpgsql security invoker set search_path = public as $$
begin
  update public.maquina
     set piso_id = p_piso_id,
         pos_x = greatest(0, least(100, p_pos_x)),
         pos_y = greatest(0, least(100, p_pos_y)),
         updated_at = now()
   where id = p_maquina_id;   -- RLS de maquina restringe a las del staff
  if not found then raise exception 'máquina no encontrada o sin acceso'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.ubicar_maquina(uuid,uuid,numeric,numeric) to authenticated, service_role;

-- El socio puede indicar su piso al pedir ayuda (fallback: ubicacion_texto existente).
alter table public.solicitud_ayuda add column if not exists piso_id uuid references public.sede_piso(id) on delete set null;
```

- [ ] **Step 2: Aplicar**

Run: `psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 -f supabase/migrations/20260716000021_croquis_rpcs.sql`
Expected: `CREATE FUNCTION` x3, `GRANT` x3, `ALTER TABLE`, sin error.

- [ ] **Step 3: Probar en rollback (crear piso, ubicar máquina, leerla)**

```bash
psql "$(cat /tmp/.dburl)" -v ON_ERROR_STOP=1 <<'SQL'
begin;
select empresa_id, sede_id from public.maquina where deleted_at is null limit 1 \gset
-- crear un piso
insert into public.sede_piso (empresa_id, sede_id, nombre, orden) values (:'empresa_id'::uuid, :'sede_id'::uuid, 'Planta baja', 0) returning id as piso \gset
select id as maq from public.maquina where sede_id = :'sede_id'::uuid and deleted_at is null limit 1 \gset
-- ubicar la máquina (usa update directo porque ubicar_maquina depende de RLS; aquí como postgres)
update public.maquina set piso_id = :'piso'::uuid, pos_x = 42.5, pos_y = 60 where id = :'maq'::uuid;
-- leer
select public.pisos_de_sede(:'sede_id'::uuid) as pisos;
select public.maquinas_del_piso(:'piso'::uuid) as maquinas_ubicadas;
rollback;
SQL
```
Expected: `pisos` contiene "Planta baja"; `maquinas_ubicadas` contiene la máquina con `pos_x:42.5, pos_y:60`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716000021_croquis_rpcs.sql
git commit -m "feat(croquis): RPCs pisos_de_sede/maquinas_del_piso/ubicar_maquina + solicitud_ayuda.piso_id

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Hooks React del croquis

**Files:**
- Create: `src/hooks/useCroquis.js`

**Interfaces:**
- Consumes: RPCs de Task 2; `subirImagen` de `useConfiguracion.js`.
- Produces: `usePisos(sedeId)`, `useGuardarPiso(sedeId)`, `useBorrarPiso(sedeId)`, `useMaquinasSede(sedeId)`, `useUbicarMaquina(sedeId)`.

- [ ] **Step 1: Escribir los hooks**

```jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Pisos de una sede (con su plano).
export function usePisos(sedeId) {
  return useQuery({
    queryKey: ['pisos', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pisos_de_sede', { p_sede_id: sedeId })
      if (error) throw error
      return data || []
    },
  })
}

// Crea/edita un piso (upsert por id). plano_url ya subido con subirImagen.
export function useGuardarPiso(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, empresa_id, nombre, orden, plano_url }) => {
      const row = { sede_id: sedeId, empresa_id, nombre, orden: orden ?? 0, plano_url: plano_url ?? null }
      const q = id
        ? supabase.from('sede_piso').update(row).eq('id', id)
        : supabase.from('sede_piso').insert(row)
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pisos', sedeId] }),
  })
}

export function useBorrarPiso(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('sede_piso').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pisos', sedeId] }),
  })
}

// Máquinas de la sede (todas — con piso_id/pos_x/pos_y para saber cuáles ubicar).
export function useMaquinasSede(sedeId) {
  return useQuery({
    queryKey: ['maquinas-croquis', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.from('maquina')
        .select('id, nombre, zona, estado, piso_id, pos_x, pos_y')
        .eq('sede_id', sedeId).is('deleted_at', null).order('nombre')
      if (error) throw error
      return data || []
    },
  })
}

// Ubicar/mover una máquina (x/y en %).
export function useUbicarMaquina(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ maquinaId, pisoId, x, y }) => {
      const { error } = await supabase.rpc('ubicar_maquina', {
        p_maquina_id: maquinaId, p_piso_id: pisoId, p_pos_x: x, p_pos_y: y })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maquinas-croquis', sedeId] }),
  })
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build 2>&1 | grep -iE "error|built in" | tail -2`
Expected: `✓ built in ...`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCroquis.js
git commit -m "feat(croquis): hooks usePisos/useGuardarPiso/useMaquinasSede/useUbicarMaquina

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Editor de croquis (tab en Configuración)

**Files:**
- Create: `src/pages/config/TabCroquis.jsx`
- Modify: `src/pages/Configuracion.jsx`

**Interfaces:**
- Consumes: hooks de Task 3 (`usePisos`, `useGuardarPiso`, `useBorrarPiso`, `useMaquinasSede`, `useUbicarMaquina`), `subirImagen` de `useConfiguracion.js`, `usePanel` (sedeId), `useAuth` (empresa).
- Produces: pestaña "Croquis 🗺️" en Configuración: gestiona pisos (agregar/nombrar/subir plano) y ubica máquinas arrastrándolas sobre el plano.

- [ ] **Step 1: Escribir TabCroquis.jsx**

```jsx
import { useState, useRef } from 'react'
import { Card } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { toast } from '../../lib/toast.js'
import { subirImagen } from '../../hooks/useConfiguracion.js'
import { usePisos, useGuardarPiso, useBorrarPiso, useMaquinasSede, useUbicarMaquina } from '../../hooks/useCroquis.js'

export default function TabCroquis() {
  const { empresa } = useAuth()
  const { sedeId, sedeNombre } = usePanel()
  const pisos = usePisos(sedeId)
  const guardarPiso = useGuardarPiso(sedeId)
  const borrarPiso = useBorrarPiso(sedeId)
  const maquinas = useMaquinasSede(sedeId)
  const ubicar = useUbicarMaquina(sedeId)
  const [pisoSel, setPisoSel] = useState(null)   // id del piso en edición
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const planoRef = useRef(null)
  const fileRef = useRef(null)

  const lista = pisos.data || []
  const piso = lista.find((p) => p.id === pisoSel) || null
  const maqsDelPiso = (maquinas.data || []).filter((m) => m.piso_id === pisoSel && m.pos_x != null)
  const maqsSinUbicar = (maquinas.data || []).filter((m) => m.piso_id !== pisoSel || m.pos_x == null)

  async function agregarPiso() {
    if (!nuevoNombre.trim()) return
    try {
      await guardarPiso.mutateAsync({ empresa_id: empresa.id, nombre: nuevoNombre.trim(), orden: lista.length })
      setNuevoNombre('')
    } catch (e) { toast.error(e.message) }
  }

  async function subirPlano(file) {
    if (!piso) return
    setSubiendo(true)
    try {
      const url = await subirImagen(empresa.id, 'croquis', file)
      await guardarPiso.mutateAsync({ id: piso.id, empresa_id: empresa.id, nombre: piso.nombre, orden: piso.orden, plano_url: url })
    } catch (e) { toast.error('No se pudo subir: ' + e.message) } finally { setSubiendo(false) }
  }

  // Soltar una máquina sobre el plano → calcular x/y en % del contenedor.
  async function soltar(e, maquinaId) {
    e.preventDefault()
    const rect = planoRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    try {
      await ubicar.mutateAsync({ maquinaId, pisoId: piso.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
    } catch (err) { toast.error(err.message) }
  }

  async function quitarUbicacion(maquinaId) {
    try { await ubicar.mutateAsync({ maquinaId, pisoId: null, x: null, y: null }) }
    catch (err) { toast.error(err.message) }
  }

  return (
    <div className="max-w-[820px]">
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🗺️ Croquis de {sedeNombre}</div>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Crea los pisos de tu sede, sube el plano de cada uno y arrastra tus máquinas a su lugar.
          El socio lo verá en la app para ubicarse.
        </p>

        {/* Pisos */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {lista.map((p) => (
            <button key={p.id} onClick={() => setPisoSel(p.id)}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors ${pisoSel === p.id ? 'border-orange bg-orange-50 text-orange' : 'border-line text-muted hover:border-orange'}`}>
              {p.nombre}{!p.plano_url && ' · sin plano'}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nuevo piso…"
              className="w-[130px] rounded-[9px] border border-line px-2.5 py-1.5 text-[12.5px] font-semibold outline-none focus:border-orange" />
            <button onClick={agregarPiso} className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-3 py-1.5 text-[12px] font-extrabold text-orange hover:bg-orange-50">+ Piso</button>
          </div>
        </div>
      </Card>

      {piso && (
        <Card className="mt-4 p-[19px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[14px] font-extrabold">{piso.nombre}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-1.5 text-[12px] font-extrabold text-muted hover:border-orange disabled:opacity-50">
                {subiendo ? 'Subiendo…' : piso.plano_url ? 'Cambiar plano' : 'Subir plano'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) subirPlano(f); e.target.value = '' }} />
              <button onClick={() => { if (confirm(`¿Borrar el piso "${piso.nombre}"?`)) { borrarPiso.mutate(piso.id); setPisoSel(null) } }}
                className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-extrabold text-red hover:underline">Borrar piso</button>
            </div>
          </div>

          {/* Plano con pines */}
          {piso.plano_url ? (
            <div ref={planoRef} onDragOver={(e) => e.preventDefault()}
              className="relative mt-3 w-full overflow-hidden rounded-[12px] border border-line bg-[#0B0E14]">
              <img src={piso.plano_url} alt="" className="w-full select-none" draggable={false} />
              {maqsDelPiso.map((m) => (
                <button key={m.id} onClick={() => quitarUbicacion(m.id)} title={`${m.nombre} — clic para quitar`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange px-2 py-1 text-[10px] font-extrabold text-white shadow-lg"
                  style={{ left: `${m.pos_x}%`, top: `${m.pos_y}%` }}>
                  📍 {m.nombre}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-[12px] border border-dashed border-line py-10 text-center text-[12.5px] font-semibold text-faint">
              Sube el plano de este piso para empezar a ubicar máquinas.
            </div>
          )}

          {/* Máquinas por ubicar (arrastrables) */}
          {piso.plano_url && (
            <div className="mt-4">
              <div className="mb-2 text-[12px] font-extrabold text-muted">Arrastra una máquina sobre el plano:</div>
              <div className="flex flex-wrap gap-2">
                {maqsSinUbicar.map((m) => (
                  <div key={m.id} draggable onDragEnd={(e) => soltar(e, m.id)}
                    className="cursor-grab rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-extrabold text-muted active:cursor-grabbing hover:border-orange">
                    {m.nombre}
                  </div>
                ))}
                {maqsSinUbicar.length === 0 && <span className="text-[12px] font-semibold text-faint">Todas las máquinas están ubicadas en este piso.</span>}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Registrar el tab en Configuracion.jsx**

En `src/pages/Configuracion.jsx`: importar `TabCroquis` y agregar la entrada al array TABS (mira el patrón exacto: `{ key: 'equipo', label: 'Equipo 🏋️', Comp: TabEquipo },`). Agregar después de 'equipo':
```jsx
import TabCroquis from './config/TabCroquis.jsx'
// en TABS:
{ key: 'croquis', label: 'Croquis 🗺️', Comp: TabCroquis },
```

- [ ] **Step 3: Verificar build + test**

Run: `npm run build 2>&1 | grep -iE "error|built in" | tail -2 && npm test 2>&1 | grep -iE "Tests" | tail -1`
Expected: build OK, tests pasan.

- [ ] **Step 4: Verificar en el navegador (Playwright/dev server)**

Abrir Configuración → Croquis, agregar un piso "Planta baja", subir una imagen de plano, arrastrar una máquina sobre él, recargar → el pin (📍) queda donde se soltó. 0 errores de consola.

- [ ] **Step 5: Commit**

```bash
git add src/pages/config/TabCroquis.jsx src/pages/Configuracion.jsx
git commit -m "feat(croquis): editor de pisos + posicionar máquinas (tab Croquis)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: PEDIDO app + verificación final

**Files:**
- Modify: `docs/APP-BACKEND-REQUESTS.md`

**Interfaces:**
- Consumes: todas las RPCs anteriores.
- Produces: PEDIDO documentado para el agente de la app; verificación e2e.

- [ ] **Step 1: Escribir el PEDIDO app**

Agregar al inicio de la sección de pedidos en `docs/APP-BACKEND-REQUESTS.md`:
```
================================================================================
PEDIDO 42 -- Mapa del gym por pisos + piso al pedir ayuda
================================================================================

El gym ahora estructura su croquis por PISOS con máquinas ubicadas. Consúmelo:

- Pisos de la sede:  supabase.rpc('pisos_de_sede', { p_sede_id })
    → [{ id, nombre, orden, plano_url }]  (ordenado)
- Máquinas ubicadas en un piso:  supabase.rpc('maquinas_del_piso', { p_piso_id })
    → [{ id, nombre, zona, estado, pos_x, pos_y }]  (pos en % 0-100)
  plano_url es una imagen pública; pinta los pines con left:pos_x% top:pos_y%.

SECCIÓN "MAPA DEL GYM": el socio elige piso (pisos_de_sede) → ve plano_url con los
pines de maquinas_del_piso → toca un pin para ver la máquina.

PEDIR AYUDA: al crear una solicitud_ayuda, el socio puede elegir su piso →
guarda solicitud_ayuda.piso_id (uuid del piso). Si la sede no tiene pisos/croquis,
usa el campo de texto solicitud_ayuda.ubicacion_texto (ya existe) como fallback.
Así el entrenador sabe en qué piso está.

Ambas RPCs tienen grant a authenticated (socio de la sede las usa; RLS lo acota).

Creado: 2026-07-16 (croquis multi-piso).
```

- [ ] **Step 2: Verificación e2e completa**

Run:
```bash
cd "/d/Personal Proyects/ControlGym" && npm test 2>&1 | grep -iE "Tests" | tail -1 && npm run build 2>&1 | grep -iE "error|built in" | tail -1 && find api -name '*.js' -not -path '*/_*' | grep -vE '/_' | wc -l
```
Expected: tests pasan, build OK, `12` (funciones serverless sin cambios).

- [ ] **Step 3: Verificación de datos (RLS y retrocompat)**

Run:
```bash
psql "$(cat /tmp/.dburl)" -tAc "select count(*) from public.maquina where deleted_at is null;"
psql "$(cat /tmp/.dburl)" -tAc "select count(*) from information_schema.columns where table_name='solicitud_ayuda' and column_name='piso_id';"
```
Expected: `6` (máquinas intactas), `1` (piso_id agregado a solicitud_ayuda).

- [ ] **Step 4: Commit + push**

```bash
git add docs/APP-BACKEND-REQUESTS.md
git commit -m "docs(croquis): PEDIDO 42 app consume mapa por pisos + piso al pedir ayuda

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

## Self-Review (cobertura del spec)

- Tabla `sede_piso` + columnas en `maquina` → Task 1 ✅
- RPCs pisos_de_sede/maquinas_del_piso/ubicar_maquina + solicitud_ayuda.piso_id → Task 2 ✅
- Hooks React → Task 3 ✅
- Editor de pisos + posicionar máquinas (arrastrar) → Task 4 ✅
- PEDIDO app + verificación → Task 5 ✅
- Aditivo/retrocompatible (maquina nullable, croquis_url conservado, 6 máquinas intactas) → verificado en Task 1 Step 3 y Task 5 Step 3 ✅
- Vista de la app fuera de alcance (PEDIDO) → consistente con el spec ✅

**Nota:** `pisos_de_sede`/`maquinas_del_piso` son `security invoker` (respetan la RLS de sede_piso/maquina) — el socio solo ve los de su sede, el staff los de su empresa. `ubicar_maquina` también invoker → la RLS de maquina restringe qué máquinas puede mover el staff.
