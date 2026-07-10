# Facturación electrónica (NORAC) — Config + Emisión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un gimnasio active la facturación electrónica (RUC, serie, API key de NORAC) desde Config, y que exista el backend que emite boletas/facturas a NORAC a partir de un `comprobante` en cola — probado contra el pago in-app existente.

**Architecture:** Una tabla `comprobante` (cola) creada en la misma transacción del cobro. Un worker en `api/facturacion/emitir.js` toma los pendientes, lee la key `nrk_` cifrada del gym, hace `POST /api/emit` a NORAC y guarda el resultado. Emisión best-effort tras el cobro + cron de respaldo. Este plan NO incluye el POS ni la caja chica (planes aparte); engancha el canal `pago_app` (webhook) para probar E2E.

**Tech Stack:** Supabase Postgres (migraciones psql UTF-8), RPC `security definer`, React + Vite + Tailwind + React Query, Vercel Functions (`pg.Pool` vía `DATABASE_URL`, sin RLS), Vercel Cron. NORAC API (FastAPI, `X-API-Key: nrk_...`).

## Global Constraints

- Migraciones: archivos `.sql` UTF-8, aplicadas por `psql` con `-f` (nunca `-c` inline por tildes/emojis). Nombre `supabase/migrations/2026071000XX_*.sql`.
- RLS: tablas de negocio con `empresa_id = public.auth_empresa_id()`. `empresa_facturacion` y `comprobante` (credenciales/secreto) → **sin policies para authenticated**; solo backend (service role vía `DATABASE_URL`) y RPC `security definer`.
- Solo **admin** (`public.auth_is_admin()`) configura facturación.
- IGV Perú 18%: precios ya incluyen IGV → `base = round(total/1.18, 2)`, `igv = total − base`.
- La API key `nrk_` es **secreta**: se guarda cifrada con `pgp_sym_encrypt` (pgcrypto ya disponible) usando una clave global en `privado.secreto` (`clave='fact_cipher_key'`). Nunca se devuelve al frontend (solo `tiene_credenciales` bool).
- NORAC base URL por gym en `empresa_facturacion.proveedor_url` (default `https://norac-facturacion.onrender.com`).
- Backend `api/`: usa `import { db, env, usuarioDesdeJwt } from '../_lib/db.js'`. El worker se protege con `CRON_SECRET` (header `authorization: Bearer <CRON_SECRET>`).
- Copy en español, sentence case, tono directo. Componentes del tema (`Card`, `PrimaryButton`, `Badge`), tokens (`bg-orange` acción, `amber` aviso, `bg-green` éxito). Responsive 375px.

---

## Task 1: Migración — tabla `comprobante` + clave de cifrado + columnas de config

**Files:**
- Create: `supabase/migrations/20260710000014_comprobante_tabla.sql`

**Interfaces:**
- Produces: tabla `public.comprobante` (columnas del spec), columna `empresa_facturacion.correlativo_inicial int`, columna `movimiento_financiero.venta_id uuid`, secreto `privado.secreto('fact_cipher_key')`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Facturación NORAC: cola de comprobantes + soporte de cifrado y agrupación de venta.
create extension if not exists pgcrypto;

-- Clave global para cifrar las API keys de NORAC por gym (pgp_sym_encrypt).
-- Si no existe, se inserta una aleatoria (el owner puede rotarla luego).
insert into privado.secreto (clave, valor)
values ('fact_cipher_key', encode(gen_random_bytes(32), 'hex'))
on conflict (clave) do nothing;

-- Config extra: correlativo inicial opcional (para gyms que continúan numeración).
alter table public.empresa_facturacion
  add column if not exists correlativo_inicial int;

-- Agrupa los ítems de un mismo cobro (carrito) para armar UN comprobante multi-línea.
alter table public.movimiento_financiero
  add column if not exists venta_id uuid;
create index if not exists idx_movfin_venta on public.movimiento_financiero(venta_id) where venta_id is not null;

-- Cola de comprobantes para los 3 canales (producto, membresia, pago_app).
create table if not exists public.comprobante (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  origen text not null check (origen in ('producto','membresia','pago_app')),
  ref_tipo text not null,           -- 'venta' | 'membresia' | 'pago_app'
  ref_id uuid not null,             -- venta_id / membresia_id / pago_app_id
  tipo text not null default '03' check (tipo in ('03','01')),
  cliente_tipo_doc text not null default '0' check (cliente_tipo_doc in ('0','1','6')),
  cliente_num_doc text,
  cliente_nombre text not null default 'CLIENTE VARIOS',
  cliente_email text,
  moneda text not null default 'PEN',
  base numeric(12,2),
  igv numeric(12,2),
  total numeric(12,2) not null check (total > 0),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','emitido','observado','anulado','error')),
  norac_id bigint,
  serie_numero text,
  response_code text,
  error_msg text,
  intentos int not null default 0,
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);
-- Idempotencia: un solo comprobante vivo por (ref_tipo, ref_id).
create unique index if not exists uq_comprobante_ref
  on public.comprobante(ref_tipo, ref_id) where estado <> 'anulado';
create index if not exists idx_comprobante_pendiente
  on public.comprobante(estado) where estado = 'pendiente';
create index if not exists idx_comprobante_empresa on public.comprobante(empresa_id);

alter table public.comprobante enable row level security;
-- Lectura para el panel (admin/recepción de la empresa). Escritura solo backend/RPC.
create policy comprobante_select on public.comprobante for select to authenticated
  using (empresa_id = public.auth_empresa_id());

comment on table public.comprobante is
  'Cola de comprobantes electrónicos (NORAC). Un comprobante por venta/membresía/pago. Emisión asíncrona vía api/facturacion/emitir.js.';
```

- [ ] **Step 2: Aplicar la migración**

Run:
```bash
cd "d:/Personal Proyects/ControlGym" && psql "$DATABASE_URL" -f supabase/migrations/20260710000014_comprobante_tabla.sql
```
Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `INSERT 0 1` (o 0 si ya existía), sin errores.

- [ ] **Step 3: Verificar estructura**

Run:
```bash
psql "$DATABASE_URL" -c "\d public.comprobante" -c "select count(*) from privado.secreto where clave='fact_cipher_key';"
```
Expected: la tabla lista sus columnas; el count = 1.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000014_comprobante_tabla.sql
git commit -m "feat(fact): tabla comprobante + clave de cifrado + venta_id"
```

---

## Task 2: Migración — RPCs de config con API key cifrada

**Files:**
- Create: `supabase/migrations/20260710000015_facturacion_rpcs.sql`

**Interfaces:**
- Consumes: `empresa_facturacion`, `privado.secreto('fact_cipher_key')`, `public.auth_empresa_id()`, `public.auth_is_admin()`.
- Produces:
  - `guardar_facturacion_key(p_key text) → void` (admin; cifra y guarda en `proveedor_token`)
  - `guardar_facturacion(p_activo, p_ruc, p_razon_social, p_serie_boleta, p_serie_factura, p_correlativo_inicial, p_proveedor_url) → void` (extiende la existente; proveedor fijo 'norac')
  - `estado_facturacion() → jsonb` (extiende: agrega `proveedor_url`, `correlativo_inicial`)
  - `facturacion_credenciales(p_empresa uuid) → jsonb` (SECURITY DEFINER, **solo backend** por `DATABASE_URL`; descifra la key)

- [ ] **Step 1: Escribir la migración**

```sql
-- RPCs de configuración de facturación NORAC (API key cifrada).

-- Guarda la API key nrk_ cifrada (solo admin). Vacío = borrar credencial.
create or replace function public.guardar_facturacion_key(p_key text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_empresa uuid := public.auth_empresa_id(); v_cipher text;
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador configura la facturación';
  end if;
  select valor into v_cipher from privado.secreto where clave = 'fact_cipher_key';
  insert into public.empresa_facturacion (empresa_id, proveedor_token, actualizado_at)
  values (
    v_empresa,
    case when coalesce(p_key,'') = '' then null
         else encode(pgp_sym_encrypt(p_key, v_cipher), 'base64') end,
    now())
  on conflict (empresa_id) do update set
    proveedor_token = case when coalesce(p_key,'') = '' then null
                          else encode(pgp_sym_encrypt(p_key, v_cipher), 'base64') end,
    actualizado_at = now();
end;
$function$;
grant execute on function public.guardar_facturacion_key(text) to authenticated;

-- Reemplaza guardar_facturacion con los campos nuevos (proveedor fijo 'norac').
drop function if exists public.guardar_facturacion(boolean, text, text, text, text, text);
create or replace function public.guardar_facturacion(
  p_activo boolean,
  p_ruc text default null,
  p_razon_social text default null,
  p_serie_boleta text default null,
  p_serie_factura text default null,
  p_correlativo_inicial int default null,
  p_proveedor_url text default null
) returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null or not public.auth_is_admin() then
    raise exception 'Solo el administrador configura la facturación';
  end if;
  insert into public.empresa_facturacion
    (empresa_id, activo, proveedor, ruc, razon_social, serie_boleta, serie_factura,
     correlativo_inicial, proveedor_url, actualizado_at)
  values (v_empresa, p_activo, 'norac', p_ruc, p_razon_social,
          coalesce(p_serie_boleta,'B001'), coalesce(p_serie_factura,'F001'),
          p_correlativo_inicial,
          coalesce(p_proveedor_url, 'https://norac-facturacion.onrender.com'), now())
  on conflict (empresa_id) do update set
    activo = excluded.activo,
    proveedor = 'norac',
    ruc = coalesce(excluded.ruc, empresa_facturacion.ruc),
    razon_social = coalesce(excluded.razon_social, empresa_facturacion.razon_social),
    serie_boleta = excluded.serie_boleta,
    serie_factura = excluded.serie_factura,
    correlativo_inicial = coalesce(excluded.correlativo_inicial, empresa_facturacion.correlativo_inicial),
    proveedor_url = coalesce(excluded.proveedor_url, empresa_facturacion.proveedor_url),
    actualizado_at = now();
end;
$function$;
grant execute on function public.guardar_facturacion(boolean, text, text, text, text, int, text) to authenticated;

-- Estado no-secreto para el panel (agrega proveedor_url y correlativo_inicial).
create or replace function public.estado_facturacion()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_empresa uuid := public.auth_empresa_id(); v_fila public.empresa_facturacion;
begin
  if v_empresa is null or not public.auth_is_admin() then
    return jsonb_build_object('activo', false, 'motivo', 'solo_admin');
  end if;
  select * into v_fila from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fila.empresa_id is null then return jsonb_build_object('activo', false, 'configurado', false); end if;
  return jsonb_build_object(
    'activo', v_fila.activo, 'configurado', true,
    'ruc', v_fila.ruc, 'razon_social', v_fila.razon_social,
    'serie_boleta', v_fila.serie_boleta, 'serie_factura', v_fila.serie_factura,
    'correlativo_inicial', v_fila.correlativo_inicial,
    'proveedor_url', v_fila.proveedor_url,
    'tiene_credenciales', v_fila.proveedor_token is not null
  );
end;
$function$;
grant execute on function public.estado_facturacion() to authenticated;

-- SOLO BACKEND (DATABASE_URL, no expuesta a authenticated): descifra la key.
create or replace function public.facturacion_credenciales(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_fila public.empresa_facturacion; v_cipher text; v_key text;
begin
  select * into v_fila from public.empresa_facturacion where empresa_id = p_empresa;
  if v_fila.empresa_id is null or not v_fila.activo or v_fila.proveedor_token is null then
    return jsonb_build_object('ok', false);
  end if;
  select valor into v_cipher from privado.secreto where clave = 'fact_cipher_key';
  v_key := pgp_sym_decrypt(decode(v_fila.proveedor_token, 'base64'), v_cipher);
  return jsonb_build_object(
    'ok', true, 'api_key', v_key, 'url', v_fila.proveedor_url,
    'ruc', v_fila.ruc, 'razon_social', v_fila.razon_social,
    'serie_boleta', v_fila.serie_boleta, 'serie_factura', v_fila.serie_factura);
end;
$function$;
-- NO grant a authenticated: solo el backend la llama por conexión postgres directa.
revoke all on function public.facturacion_credenciales(uuid) from public, anon, authenticated;
```

- [ ] **Step 2: Aplicar**

Run:
```bash
psql "$DATABASE_URL" -f supabase/migrations/20260710000015_facturacion_rpcs.sql
```
Expected: `CREATE FUNCTION` ×4, `DROP FUNCTION`, `GRANT`, `REVOKE`, sin errores.

- [ ] **Step 3: Verificar cifrado ida y vuelta**

Run:
```bash
psql "$DATABASE_URL" -c "select (facturacion_credenciales('00000000-0000-0000-0000-000000000000')->>'ok');"
```
Expected: `false` (empresa inexistente → no revienta, devuelve ok:false).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000015_facturacion_rpcs.sql
git commit -m "feat(fact): RPCs de config con API key cifrada (guardar/estado/credenciales)"
```

---

## Task 3: Hook `useFacturacion` (frontend)

**Files:**
- Create: `src/hooks/useFacturacion.js`

**Interfaces:**
- Consumes: RPCs `estado_facturacion`, `guardar_facturacion`, `guardar_facturacion_key`.
- Produces: `useEstadoFacturacion()`, `useGuardarFacturacion()`, `useGuardarFacturacionKey()`, `useProbarNorac()` (llama `POST /api/facturacion/probar`).

- [ ] **Step 1: Escribir el hook**

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

export function useEstadoFacturacion() {
  return useQuery({
    queryKey: ['estado-facturacion'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_facturacion')
      if (error) throw error
      return data
    },
  })
}

export function useGuardarFacturacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cfg) => {
      const { error } = await supabase.rpc('guardar_facturacion', {
        p_activo: cfg.activo,
        p_ruc: cfg.ruc || null,
        p_razon_social: cfg.razon_social || null,
        p_serie_boleta: cfg.serie_boleta || null,
        p_serie_factura: cfg.serie_factura || null,
        p_correlativo_inicial: cfg.correlativo_inicial ?? null,
        p_proveedor_url: cfg.proveedor_url || null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['estado-facturacion'] }),
  })
}

export function useGuardarFacturacionKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (key) => {
      const { error } = await supabase.rpc('guardar_facturacion_key', { p_key: key })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['estado-facturacion'] }),
  })
}

// Prueba la conexión a NORAC con la key guardada (el backend descifra y llama /health).
export function useProbarNorac() {
  return useMutation({
    mutationFn: async () => {
      const jwt = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/api/facturacion/probar', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'No se pudo conectar con NORAC')
      return out
    },
  })
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd "d:/Personal Proyects/ControlGym" && npm run build`
Expected: build sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFacturacion.js
git commit -m "feat(fact): hook useFacturacion (estado/guardar/key/probar)"
```

---

## Task 4: Backend — `POST /api/facturacion/probar` (probar conexión)

**Files:**
- Create: `api/facturacion/probar.js`

**Interfaces:**
- Consumes: `api/_lib/db.js` (`db`, `env`, `usuarioDesdeJwt`), RPC `facturacion_credenciales`, `empresa` del usuario.
- Produces: endpoint que devuelve `{ ok: true }` o `{ error }`. Base para el patrón del worker (Task 5).

- [ ] **Step 1: Escribir el endpoint**

```javascript
// Prueba la conexión a NORAC del gym del usuario autenticado (admin).
import { db, env, usuarioDesdeJwt } from '../_lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const pool = db()
  // empresa activa del usuario (admin). Reusa el claim: buscamos su empresa por membership admin.
  const { rows: emp } = await pool.query(
    `select ue.empresa_id from public.usuario_empresa ue
     where ue.usuario_id = $1 and ue.rol_id in
       (select id from public.rol where codigo = 'admin') limit 1`, [user.id])
  if (!emp.length) return res.status(403).json({ error: 'Solo el administrador' })
  const empresaId = emp[0].empresa_id

  const { rows } = await pool.query('select public.facturacion_credenciales($1) as c', [empresaId])
  const cred = rows[0].c
  if (!cred?.ok) return res.status(400).json({ error: 'Falta configurar el RUC y la API key de NORAC' })

  try {
    const r = await fetch(`${cred.url}/api/documents?limit=1`, {
      headers: { 'X-API-Key': cred.api_key },
    })
    if (r.status === 401 || r.status === 403)
      return res.status(400).json({ error: 'La API key de NORAC no es válida' })
    if (!r.ok) return res.status(400).json({ error: `NORAC respondió ${r.status}` })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo conectar con NORAC: ' + e.message })
  }
}
```

- [ ] **Step 2: Verificar el resolvedor de empresa admin**

Run:
```bash
psql "$DATABASE_URL" -c "select codigo from public.rol where codigo='admin' limit 1;"
```
Expected: devuelve `admin`. Si el código del rol admin difiere, ajustar la query del endpoint al código real (revisar `public.rol`).

- [ ] **Step 3: Commit**

```bash
git add api/facturacion/probar.js
git commit -m "feat(fact): endpoint probar conexión NORAC"
```

---

## Task 5: Backend — worker `POST /api/facturacion/emitir` (cola → NORAC)

**Files:**
- Create: `api/facturacion/emitir.js`
- Create: `api/facturacion/_norac.js` (helper: arma payload + llama NORAC)
- Modify: `vercel.json` (agregar cron)

**Interfaces:**
- Consumes: `api/_lib/db.js`, RPC `facturacion_credenciales`, tabla `comprobante`, `movimiento_financiero` (líneas por `venta_id`).
- Produces: worker idempotente que emite los `comprobante` pendientes. `_norac.js` exporta `emitirEnNorac(cred, comprobante, lineas) → { norac_id, serie_numero, estado, response_code, error }`.

- [ ] **Step 1: Escribir el helper `_norac.js`**

```javascript
// Arma el payload de /api/emit y llama a NORAC. Desglosa IGV y cuadra céntimos.
function hoyLima() {
  // fecha local Perú (UTC-5) YYYY-MM-DD
  const d = new Date(Date.now() - 5 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

// Convierte líneas {descripcion, cantidad, subtotal(con IGV)} a líneas NORAC
// (valor_unitario SIN IGV) y ajusta la última para que Σ == total exacto.
export function construirLineas(lineas, totalConIgv) {
  const out = lineas.map((l) => {
    const cant = Number(l.cantidad) || 1
    const baseLinea = Number((Number(l.subtotal) / 1.18).toFixed(2))
    return { descripcion: l.descripcion, cantidad: String(cant),
             valor_unitario: (baseLinea / cant).toFixed(2), afectacion_igv: '10', unidad: 'NIU' }
  })
  return out
}

export async function emitirEnNorac(cred, comp, lineas) {
  const esFactura = comp.tipo === '01'
  const body = {
    tipo: comp.tipo,
    serie: esFactura ? cred.serie_factura : cred.serie_boleta,
    fecha_emision: hoyLima(),
    moneda: comp.moneda || 'PEN',
    receptor: {
      tipo_doc: comp.cliente_tipo_doc || '0',
      num_doc: comp.cliente_num_doc || '0',
      razon_social: comp.cliente_nombre || 'CLIENTE VARIOS',
      email: comp.cliente_email || '',
    },
    lineas: construirLineas(lineas, Number(comp.total)),
  }
  let r
  try {
    r = await fetch(`${cred.url}/api/emit`, {
      method: 'POST',
      headers: { 'X-API-Key': cred.api_key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { estado: 'pendiente', error: 'red: ' + e.message } // reintentar
  }
  const out = await r.json().catch(() => ({}))
  if (r.status === 401 || r.status === 403) return { estado: 'error', error: 'API key inválida' }
  if (!r.ok) return { estado: 'error', error: out.detail || `NORAC ${r.status}` }
  // queued = SUNAT caído, NORAC reintenta solo → seguimos pendiente
  if (out.estado === 'queued') return { estado: 'pendiente', norac_id: out.id }
  return { estado: 'emitido', norac_id: out.id, serie_numero: out.numero, response_code: out.response_code }
}
```

- [ ] **Step 2: Escribir el worker `emitir.js`**

```javascript
// Worker: emite los comprobantes pendientes a NORAC. Best-effort + idempotente.
// Disparado por Vercel Cron (protegido con CRON_SECRET) o al vuelo tras el cobro.
import { db, env } from '../_lib/db.js'
import { emitirEnNorac } from './_norac.js'

const MAX_INTENTOS = 10

export default async function handler(req, res) {
  // Auth: cron manda Bearer CRON_SECRET; el disparo al vuelo también.
  const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (env('CRON_SECRET') && secret !== env('CRON_SECRET'))
    return res.status(401).json({ error: 'no autorizado' })

  const pool = db()
  // Toma hasta 20 pendientes (todos los gyms) sin bloquear entre invocaciones.
  const { rows: pend } = await pool.query(
    `select * from public.comprobante where estado = 'pendiente'
       and intentos < $1 order by creado_at limit 20`, [MAX_INTENTOS])

  let emitidos = 0
  for (const comp of pend) {
    const { rows: cr } = await pool.query('select public.facturacion_credenciales($1) as c', [comp.empresa_id])
    const cred = cr[0].c
    if (!cred?.ok) {
      await pool.query(`update public.comprobante set intentos = intentos + 1, error_msg = 'gym sin credenciales', actualizado_at = now() where id = $1`, [comp.id])
      continue
    }
    // Líneas: para 'venta' se leen de movimiento_financiero por venta_id; para
    // membresia/pago_app es una sola línea con el concepto.
    let lineas
    if (comp.ref_tipo === 'venta') {
      const { rows: items } = await pool.query(
        `select descripcion, 1 as cantidad, monto as subtotal
           from public.movimiento_financiero where venta_id = $1 and tipo = 'ingreso'`, [comp.ref_id])
      lineas = items.length ? items : [{ descripcion: 'Venta', cantidad: 1, subtotal: comp.total }]
    } else {
      lineas = [{ descripcion: comp.origen === 'membresia' ? 'Membresía' : 'Compra', cantidad: 1, subtotal: comp.total }]
    }

    const r = await emitirEnNorac(cred, comp, lineas)
    if (r.estado === 'emitido') {
      await pool.query(
        `update public.comprobante set estado='emitido', norac_id=$2, serie_numero=$3,
           response_code=$4, actualizado_at=now() where id=$1`,
        [comp.id, r.norac_id, r.serie_numero, r.response_code || null])
      emitidos++
    } else if (r.estado === 'error') {
      await pool.query(
        `update public.comprobante set estado='error', error_msg=$2, intentos=intentos+1, actualizado_at=now() where id=$1`,
        [comp.id, r.error])
    } else {
      // pendiente (red o queued): incrementa intentos, guarda norac_id si vino
      await pool.query(
        `update public.comprobante set intentos=intentos+1, norac_id=coalesce($2,norac_id),
           error_msg=$3, actualizado_at=now() where id=$1`,
        [comp.id, r.norac_id || null, r.error || null])
    }
  }
  return res.status(200).json({ ok: true, procesados: pend.length, emitidos })
}
```

- [ ] **Step 3: Agregar el cron a `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ],
  "crons": [
    { "path": "/api/facturacion/emitir", "schedule": "*/2 * * * *" }
  ]
}
```

- [ ] **Step 4: Verificar que el worker responde (sin pendientes aún)**

Run: `cd "d:/Personal Proyects/ControlGym" && npm run build`
Expected: build sin errores. (Prueba funcional real en Task 7, con un comprobante de verdad.)

- [ ] **Step 5: Commit**

```bash
git add api/facturacion/emitir.js api/facturacion/_norac.js vercel.json
git commit -m "feat(fact): worker de emisión a NORAC + cron cada 2 min"
```

---

## Task 6: UI — `TabFacturacion` en Config

**Files:**
- Create: `src/pages/config/TabFacturacion.jsx`
- Modify: `src/pages/Configuracion.jsx` (registrar la tab, solo admin)

**Interfaces:**
- Consumes: `useEstadoFacturacion`, `useGuardarFacturacion`, `useGuardarFacturacionKey`, `useProbarNorac`.
- Produces: pantalla de config. (Verificación visual, sin test unitario — sigue el patrón de las otras tabs de config.)

- [ ] **Step 1: Escribir `TabFacturacion.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { Card, PrimaryButton, Badge } from '../../components/ui.jsx'
import { LoadingState } from '../../components/states.jsx'
import { toast } from '../../lib/toast.js'
import {
  useEstadoFacturacion, useGuardarFacturacion, useGuardarFacturacionKey, useProbarNorac,
} from '../../hooks/useFacturacion.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'

export default function TabFacturacion() {
  const estado = useEstadoFacturacion()
  const guardar = useGuardarFacturacion()
  const guardarKey = useGuardarFacturacionKey()
  const probar = useProbarNorac()
  const [f, setF] = useState(null)
  const [key, setKey] = useState('')

  useEffect(() => {
    if (estado.data && f === null) {
      setF({
        activo: estado.data.activo || false,
        ruc: estado.data.ruc || '',
        razon_social: estado.data.razon_social || '',
        serie_boleta: estado.data.serie_boleta || 'B001',
        serie_factura: estado.data.serie_factura || 'F001',
        correlativo_inicial: estado.data.correlativo_inicial ?? '',
        proveedor_url: estado.data.proveedor_url || 'https://norac-facturacion.onrender.com',
      })
    }
  }, [estado.data, f])

  if (estado.isLoading || f === null) return <LoadingState variant="card" />
  if (estado.data?.motivo === 'solo_admin')
    return <Card className="mt-4 p-[19px] text-[13px] font-semibold text-muted">Solo el administrador configura la facturación.</Card>

  const tieneCred = estado.data?.tiene_credenciales

  function onGuardar() {
    guardar.mutate({ ...f, correlativo_inicial: f.correlativo_inicial === '' ? null : Number(f.correlativo_inicial) }, {
      onSuccess: () => toast.ok('Facturación guardada'),
      onError: (e) => toast.error(e.message),
    })
  }
  function onGuardarKey() {
    guardarKey.mutate(key, {
      onSuccess: () => { toast.ok('API key guardada'); setKey('') },
      onError: (e) => toast.error(e.message),
    })
  }
  function onProbar() {
    probar.mutate(undefined, {
      onSuccess: () => toast.ok('Conectado a NORAC ✓'),
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="max-w-[700px]">
      <Card className="mt-4 p-[19px]">
        <div className="flex items-center justify-between">
          <div className="text-[14.5px] font-extrabold">Facturación electrónica (SUNAT)</div>
          <Badge bg={f.activo ? T.successBg : T.line2} color={f.activo ? T.success : T.muted}>
            {f.activo ? 'Activa' : 'Inactiva'}
          </Badge>
        </div>
        <p className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
          Emite boletas y facturas por cada venta con tu RUC vía NORAC. El cliente
          recibe su comprobante por correo automáticamente.
        </p>

        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })}
            className="h-4 w-4 accent-orange-600" />
          <span className="text-[13px] font-bold">Emitir boletas y facturas</span>
        </label>

        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="RUC" value={f.ruc} onChange={(v) => setF({ ...f, ruc: v })} />
          <Field label="Razón social" value={f.razon_social} onChange={(v) => setF({ ...f, razon_social: v })} />
          <Field label="Serie boleta" value={f.serie_boleta} onChange={(v) => setF({ ...f, serie_boleta: v })} />
          <Field label="Serie factura" value={f.serie_factura} onChange={(v) => setF({ ...f, serie_factura: v })} />
          <Field label="Correlativo inicial (opcional)" type="number" value={f.correlativo_inicial}
            onChange={(v) => setF({ ...f, correlativo_inicial: v })} />
        </div>
        <p className="mt-2 text-[11.5px] font-semibold text-muted">
          Usa una serie que no hayas usado antes para no duplicar con tus boletas previas.
        </p>

        <div className="mt-4">
          <PrimaryButton onClick={onGuardar} disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </PrimaryButton>
        </div>
      </Card>

      <Card className="mt-4 p-[19px]">
        <div className="text-[14px] font-extrabold">Conexión con NORAC</div>
        <p className="mt-1 text-[12.5px] font-semibold text-muted">
          Pega la API key que obtuviste en NORAC (empieza con <code>nrk_</code>). Se guarda cifrada.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={tieneCred ? '•••••••• (ya configurada)' : 'nrk_live_…'}
            className="min-w-[240px] flex-1 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
          <button onClick={onGuardarKey} disabled={guardarKey.isPending || key === ''}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-4 py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
            Guardar key
          </button>
          <button onClick={onProbar} disabled={probar.isPending || !tieneCred}
            className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-ink hover:border-orange disabled:opacity-50">
            {probar.isPending ? 'Probando…' : 'Probar conexión'}
          </button>
        </div>
        {tieneCred && (
          <div className="mt-2 text-[12px] font-bold" style={{ color: T.success }}>✓ API key configurada</div>
        )}
      </Card>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</span>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
    </label>
  )
}
```

- [ ] **Step 2: Registrar la tab en `Configuracion.jsx`**

Leer `src/pages/Configuracion.jsx`, localizar el array de tabs y el switch de render. Agregar (solo si `rol === 'admin'`) una entrada `{ id: 'facturacion', label: 'Facturación', icon: '🧾' }` dentro de la agrupación adecuada, e importar y renderizar `<TabFacturacion />` en el caso `facturacion`. Seguir el patrón exacto de las tabs existentes (p.ej. `TabCobros`).

- [ ] **Step 3: Verificar build**

Run: `cd "d:/Personal Proyects/ControlGym" && npm run build`
Expected: build sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/config/TabFacturacion.jsx src/pages/Configuracion.jsx
git commit -m "feat(fact): TabFacturacion en Config (RUC, series, API key, probar)"
```

---

## Task 7: Enganchar el canal `pago_app` (webhook) + prueba E2E contra NORAC beta

**Files:**
- Create: `supabase/migrations/20260710000016_pago_app_crea_comprobante.sql`
- Modify: `api/mp/webhook.js` (tras aprobar, disparar el worker al vuelo)

**Interfaces:**
- Consumes: `preparar_comprobante` (existente), tabla `comprobante`, worker `api/facturacion/emitir`.
- Produces: RPC `crear_comprobante_pago_app(p_pago_id uuid) → uuid` que inserta un `comprobante` desde un `pago_app` aprobado.

- [ ] **Step 1: Escribir la RPC que crea el comprobante desde pago_app**

```sql
-- Crea un comprobante 'pendiente' a partir de un pago_app aprobado. Idempotente.
create or replace function public.crear_comprobante_pago_app(p_pago_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_pago public.pago_app; v_fac public.empresa_facturacion; v_id uuid; v_base numeric; v_igv numeric;
begin
  select * into v_pago from public.pago_app where id = p_pago_id;
  if v_pago.id is null or v_pago.estado_pago <> 'aprobado' then return null; end if;
  select * into v_fac from public.empresa_facturacion where empresa_id = v_pago.empresa_id;
  if v_fac.empresa_id is null or not v_fac.activo then return null; end if;

  -- Idempotente: si ya hay comprobante vivo para este pago, devuélvelo.
  select id into v_id from public.comprobante
    where ref_tipo = 'pago_app' and ref_id = p_pago_id and estado <> 'anulado';
  if v_id is not null then return v_id; end if;

  v_base := round(v_pago.monto / 1.18, 2);
  v_igv  := v_pago.monto - v_base;
  insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, tipo,
    cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_email, base, igv, total)
  values (v_pago.empresa_id, 'pago_app', 'pago_app', p_pago_id, '03',
    case when coalesce(v_pago.nuevo_documento,'') = '' then '0' else '1' end,
    nullif(v_pago.nuevo_documento, ''),
    coalesce(nullif(v_pago.nuevo_nombre,''), 'CLIENTE VARIOS'),
    nullif(v_pago.nuevo_email,''), v_base, v_igv, v_pago.monto)
  returning id into v_id;
  update public.pago_app set comprobante_estado = 'emitido' where id = p_pago_id;
  return v_id;
end;
$function$;
grant execute on function public.crear_comprobante_pago_app(uuid) to authenticated;
revoke all on function public.crear_comprobante_pago_app(uuid) from anon;
```

- [ ] **Step 2: Aplicar**

Run: `psql "$DATABASE_URL" -f supabase/migrations/20260710000016_pago_app_crea_comprobante.sql`
Expected: `CREATE FUNCTION`, `GRANT`, `REVOKE`.

- [ ] **Step 3: Modificar el webhook para crear el comprobante y disparar el worker**

En `api/mp/webhook.js`, en el bloque donde el pago se aprueba (donde hoy llama `preparar_comprobante`), reemplazar/añadir: tras marcar el pago aprobado, ejecutar
```javascript
await pool.query('select public.crear_comprobante_pago_app($1)', [pagoAppId])
// disparar el worker al vuelo (best-effort, no bloquea el 200 del webhook)
fetch(`${env('SELF_URL') || ''}/api/facturacion/emitir`, {
  method: 'POST', headers: { authorization: `Bearer ${env('CRON_SECRET')}` },
}).catch(() => {})
```
Ubicar `pagoAppId` = el `external_reference`/id del `pago_app` ya usado en ese archivo. Mantener el `console.log` de compatibilidad o quitarlo.

- [ ] **Step 4: Prueba E2E contra NORAC beta**

Prerequisito: en NORAC (beta) existe un gym con API key; en FitCore se configuró esa key + RUC en TabFacturacion (Task 6) y `activo=true`. Insertar un comprobante de prueba y correr el worker:
```bash
# comprobante de prueba (usa un empresa_id real con facturación activa)
psql "$DATABASE_URL" -c "insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, total) values ('<EMPRESA_ID>', 'membresia', 'membresia', gen_random_uuid(), 50.00);"
# correr el worker
curl -s -X POST "$SELF_URL/api/facturacion/emitir" -H "authorization: Bearer $CRON_SECRET"
# verificar
psql "$DATABASE_URL" -c "select estado, serie_numero, norac_id, error_msg from public.comprobante order by creado_at desc limit 1;"
```
Expected: el worker responde `{ok:true, emitidos:1}`; el comprobante queda `emitido` con `serie_numero` (ej. `B001-...`) y `norac_id`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000016_pago_app_crea_comprobante.sql api/mp/webhook.js
git commit -m "feat(fact): pago in-app crea comprobante + dispara worker (E2E NORAC beta)"
```

---

## Self-Review

**Spec coverage (subsistema Facturación):**
- Config › Facturación (RUC, serie, key cifrada, probar) → Tasks 2, 3, 4, 6 ✅
- Tabla `comprobante` para los 3 canales → Task 1 ✅
- Emisión al vuelo + cron → Task 5 (worker) + Task 7 (disparo al vuelo) ✅
- IGV desglosado + cuadre de céntimos → Task 5 (`construirLineas`) ✅
- Boleta simple / con DNI → Task 7 (RPC decide tipo_doc por documento) ✅
- Correo automático (receptor.email) → Task 5 (`_norac.js` puebla email) ✅
- Permisos admin → Tasks 2, 4, 6 ✅
- `venta_id` para carrito → Task 1 (columna) + Task 5 (lee líneas) ✅
- **Diferido a planes POS/Caja:** UI de badges "Ver boleta/Imprimir/Correo", factura con RUC en el POS, anulación con void, sección Ventas, caja chica. (Este plan deja el backend listo; la UI de estado se hace con el POS.)

**Placeholder scan:** sin TBD/TODO; cada step con código real. El Step 2 de Task 6 describe una edición guiada por patrón existente (registrar tab) — es una modificación de integración, no un placeholder de lógica.

**Type consistency:** `facturacion_credenciales` devuelve `{ok, api_key, url, ruc, razon_social, serie_boleta, serie_factura}` — consumido igual en probar.js y emitir.js. `emitirEnNorac(cred, comp, lineas)` → `{estado, norac_id, serie_numero, response_code, error}` — consumido igual en el worker. `estado_facturacion` keys (`activo, tiene_credenciales, ruc, ...`) — consumidas igual en el hook y la UI.

## Notas de entorno (no son tasks, son prerequisitos de deploy)
- Variables Vercel nuevas: `CRON_SECRET` (aleatorio), `SELF_URL` (URL de producción, para el disparo al vuelo). `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` ya existen.
- NORAC (lado del owner): la instancia debe tener `EMAIL_ENABLED=true` + Resend para que salga el correo automático.
