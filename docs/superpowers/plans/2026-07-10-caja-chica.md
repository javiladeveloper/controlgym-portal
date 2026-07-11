# Caja chica (arqueo + gastos + historial) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar la caja del día de Finanzas con: conteo por denominaciones al cerrar (suma sola), registro de gastos/egresos de caja chica, e historial de cierres — para cuadrar finanzas de verdad. Subsistema 3/3 del módulo de dinero.

**Architecture:** Se AMPLÍA lo existente, no se reescribe. `Finanzas.jsx` ya tiene `CajaDelDia` (abrir/cerrar, efectivo esperado en vivo vs contado, diferencia, congelado al cierre, concurrencia). Se agrega: columna `caja.arqueo_detalle jsonb`, RPC `registrar_gasto_caja` (validaciones server-side), hook `useCaja.js`, y tres piezas de UI dentro de Finanzas (grilla de denominaciones en el cierre, modal de gasto, card colapsable de historial).

**Tech Stack:** Supabase Postgres (migraciones psql UTF-8), React + Vite + Tailwind + React Query, componentes del tema.

## Global Constraints

- Migraciones: `.sql` UTF-8, psql `-f`. Siguiente número libre: `20260710000022`. `DBURL=$(cat /tmp/.dburl)`; NO imprimir /tmp/.dburl.
- **Hechos del esquema verificados (no re-investigar):** `caja` tiene id, empresa_id, sede_id, fecha, saldo_inicial, saldo_final, estado('abierta'|'cerrada'), abierta_por, cerrada_por (FK → `usuario(id)`), created_at, updated_at, efectivo_esperado. `movimiento_financiero.categoria` NO tiene CHECK (texto libre → 'caja_chica' válido). `metodo_pago` CHECK: efectivo, yape, plin, tarjeta, transferencia, otro, mercadopago, culqi. La columna timestamp de movimiento_financiero es `created_at`.
- La caja solo cuadra EFECTIVO (Yape/tarjeta cuadran solos) — el gasto de caja chica default efectivo y descuenta del esperado vía el cálculo `efectivoHoy` existente (filtra `metodo_pago === 'efectivo'`); no tocar ese cálculo.
- Denominaciones Perú: billetes 200, 100, 50, 20, 10 · monedas 5, 2, 1, 0.50, 0.20, 0.10.
- UI: componentes del tema (`Card`, `PrimaryButton`, `Badge`), tokens (`bg-orange` acción, `text-muted`, `bg-green` éxito, `amber` aviso). El arqueo va DENTRO del flujo de cierre (no pantalla nueva); el gasto es un modal chico; el historial una card colapsada al pie. Responsive 375px (la grilla de denominaciones envuelve). Copy español, sentence case.
- Finanzas es módulo admin-only hoy (MODULES roles:['admin']) — NO cambiar permisos de módulo en este plan.
- No romper lo existente de `CajaDelDia`: cálculo del esperado, congelado al cierre, guard de concurrencia (`.eq('estado','abierta')`), toast de doble apertura.

---

## Task 1: Migración — `caja.arqueo_detalle` + RPC `registrar_gasto_caja`

**Files:**
- Create: `supabase/migrations/20260710000022_caja_chica.sql`

**Interfaces:**
- Produces: columna `caja.arqueo_detalle jsonb` (detalle de denominaciones al cierre, ej. `{"b200":1,"b100":2,"m0_50":4}`), RPC `registrar_gasto_caja(p_sede_id uuid, p_monto numeric, p_motivo text, p_metodo_pago text default 'efectivo') → uuid` (id del movimiento creado).

- [ ] **Step 1: Escribir la migración**

```sql
-- Caja chica: detalle del arqueo por denominaciones + gastos de caja validados.

-- Detalle del conteo de billetes/monedas al cierre (para el reporte histórico).
alter table public.caja
  add column if not exists arqueo_detalle jsonb;

-- Gasto/egreso de caja chica (agua, taxi, compras menores). Validaciones que el
-- frontend no puede garantizar: monto > 0, motivo presente y caja del día abierta.
create or replace function public.registrar_gasto_caja(
  p_sede_id uuid,
  p_monto numeric,
  p_motivo text,
  p_metodo_pago text default 'efectivo'
) returns uuid
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_caja public.caja;
  v_id uuid;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a 0'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del gasto'; end if;

  -- Debe haber una caja ABIERTA en esa sede. Se busca por estado, NO por
  -- fecha=current_date: el servidor corre en UTC y desde las 7pm hora Perú
  -- (UTC-5) current_date ya es "mañana", mientras el panel abre la caja con la
  -- fecha local — comparar fechas rechazaría gastos toda la tarde-noche.
  select * into v_caja from public.caja
    where sede_id = p_sede_id and empresa_id = v_empresa and estado = 'abierta'
    order by fecha desc limit 1;
  if v_caja.id is null then
    raise exception 'Abre la caja del día antes de registrar un gasto';
  end if;

  insert into public.movimiento_financiero
    (empresa_id, sede_id, tipo, categoria, descripcion, monto, metodo_pago, caja_id, registrado_por)
  values
    (v_empresa, p_sede_id, 'gasto', 'caja_chica', trim(p_motivo), p_monto,
     coalesce(p_metodo_pago, 'efectivo'), v_caja.id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;
grant execute on function public.registrar_gasto_caja(uuid, numeric, text, text) to authenticated;

comment on function public.registrar_gasto_caja is
  'Gasto de caja chica: valida monto>0, motivo y caja del día abierta. Descuenta del efectivo esperado (vía el cálculo del panel que suma gastos en efectivo).';
```

- [ ] **Step 2: Aplicar**

Run: `DBURL=$(cat /tmp/.dburl); psql "$DBURL" -f supabase/migrations/20260710000022_caja_chica.sql`
Expected: `ALTER TABLE`, `CREATE FUNCTION`, `GRANT`, `COMMENT`.

- [ ] **Step 3: Verificar (rollback)**

```bash
DBURL=$(cat /tmp/.dburl)
psql "$DBURL" -c "select column_name from information_schema.columns where table_name='caja' and column_name='arqueo_detalle';"
psql "$DBURL" -c "select proname, pg_get_function_arguments(oid) from pg_proc where proname='registrar_gasto_caja';"
```
Expected: la columna existe; la función con 4 args. (La validación de "caja abierta" se prueba en la UI, Task 3-4; opcional: en transacción con rollback, llamarla sin caja abierta esperando la excepción 'Abre la caja del día...'.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000022_caja_chica.sql
git commit -m "feat(caja): arqueo_detalle + RPC registrar_gasto_caja"
```

---

## Task 2: Hook `useCaja.js`

**Files:**
- Create: `src/hooks/useCaja.js`

**Interfaces:**
- Consumes: RPC `registrar_gasto_caja`; tabla `caja` (lectura directa por RLS, ya usada así en Finanzas.jsx).
- Produces: `useRegistrarGastoCaja(sedeId)`, `useHistorialCaja(sedeId)`.

- [ ] **Step 1: Escribir el hook**

```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Gasto de caja chica (agua, taxi, compras menores). La RPC valida monto,
// motivo y que la caja del día esté abierta.
export function useRegistrarGastoCaja(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ monto, motivo, metodoPago }) => {
      const { data, error } = await supabase.rpc('registrar_gasto_caja', {
        p_sede_id: sedeId,
        p_monto: monto,
        p_motivo: motivo,
        p_metodo_pago: metodoPago || 'efectivo',
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    },
  })
}

// Cierres de caja pasados, más recientes primero, con quién abrió/cerró.
// Lectura directa (RLS de caja ya permite leer al panel, igual que CajaDelDia).
export function useHistorialCaja(sedeId, limite = 30) {
  return useQuery({
    queryKey: ['historial-caja', sedeId, limite],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('caja')
        .select('id, fecha, saldo_inicial, efectivo_esperado, saldo_final, arqueo_detalle, abierta:usuario!caja_abierta_por_fkey(nombre), cerrada:usuario!caja_cerrada_por_fkey(nombre)')
        .eq('sede_id', sedeId)
        .eq('estado', 'cerrada')
        .order('fecha', { ascending: false })
        .limit(limite)
      if (error) throw error
      return data
    },
  })
}
```

- [ ] **Step 2: Verificar los joins embebidos**

El select usa los nombres de FK reales (`caja_abierta_por_fkey`, `caja_cerrada_por_fkey` → `usuario(id)`, ya verificados). Confirmar que `usuario` tiene columna `nombre`:
```bash
DBURL=$(cat /tmp/.dburl)
psql "$DBURL" -c "select column_name from information_schema.columns where table_name='usuario' and table_schema='public' and column_name in ('nombre','full_name','display_name');"
```
Si la columna se llama distinto (ej. `full_name`), ajustar el select a la real.

- [ ] **Step 3: Build**

Run: `cd "d:/Personal Proyects/ControlGym" && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCaja.js
git commit -m "feat(caja): hook useCaja (gasto de caja + historial de cierres)"
```

---

## Task 3: UI — arqueo por denominaciones en el cierre

**Files:**
- Modify: `src/pages/Finanzas.jsx` (componente `CajaDelDia`, flujo de cierre)

**Interfaces:**
- Consumes: el estado `contado`/`cerrar()` existentes de `CajaDelDia`; columna `caja.arqueo_detalle`.
- Produces: grilla de denominaciones que suma sola y llena "Conté S/"; el cierre guarda `arqueo_detalle`.

- [ ] **Step 1: Agregar la grilla de denominaciones**

En `CajaDelDia` (caja abierta), junto al input "Conté S/": un botón/toggle "🧮 Contar billetes" que despliega la grilla (colapsada por defecto — quien quiera escribir el total directo puede seguir haciéndolo):

```
DENOMINACIONES = [
  { key: 'b200', label: 'S/ 200', valor: 200 }, { key: 'b100', label: 'S/ 100', valor: 100 },
  { key: 'b50', label: 'S/ 50', valor: 50 },   { key: 'b20', label: 'S/ 20', valor: 20 },
  { key: 'b10', label: 'S/ 10', valor: 10 },   { key: 'm5', label: 'S/ 5', valor: 5 },
  { key: 'm2', label: 'S/ 2', valor: 2 },      { key: 'm1', label: 'S/ 1', valor: 1 },
  { key: 'm0_50', label: 'S/ 0.50', valor: 0.5 }, { key: 'm0_20', label: 'S/ 0.20', valor: 0.2 },
  { key: 'm0_10', label: 'S/ 0.10', valor: 0.1 },
]
```
- Estado `arqueo` = objeto `{key: cantidad}`. Cada denominación: label + input number (cantidad).
- Total del arqueo = `Σ cantidad × valor` (redondeado a 2 decimales). Al cambiar cualquier cantidad, **setContado(totalArqueo)** (llena el "Conté S/" automáticamente; el usuario puede sobreescribirlo a mano si quiere, lo que desactiva/limpia la grilla o simplemente deja de sincronizar — elegir lo más simple: la grilla escribe a contado, escribir a mano en contado no borra la grilla pero el valor manda).
- Grilla responsive: `grid grid-cols-3 gap-2 sm:grid-cols-4` (a 375px, 3 columnas de chips label+input chicos).

- [ ] **Step 2: Guardar el detalle al cerrar**

En la función `cerrar()` existente, agregar al `.update({...})`: `arqueo_detalle: hayArqueo ? arqueo : null` (donde `hayArqueo` = alguna cantidad > 0). NO tocar el resto del update (saldo_final, estado, cerrada_por, efectivo_esperado) ni el guard `.eq('estado','abierta')`.

- [ ] **Step 3: Agregar 'caja_chica' a CAT_LABEL**

En el objeto `CAT_LABEL` de Finanzas.jsx agregar: `caja_chica: 'Caja chica'` (para que el desglose por categoría lo etiquete bien).

- [ ] **Step 4: Build + commit**

Run: `npm run build` → sin errores.
```bash
git add src/pages/Finanzas.jsx
git commit -m "feat(caja): arqueo por denominaciones en el cierre (suma sola)"
```

---

## Task 4: UI — gasto de caja chica + historial de cierres

**Files:**
- Modify: `src/pages/Finanzas.jsx` (botón + modal de gasto; card colapsable de historial al pie)

**Interfaces:**
- Consumes: `useRegistrarGastoCaja(sedeId)`, `useHistorialCaja(sedeId)` (Task 2), `Modal` existente del repo (ver `src/components/Modal.jsx` / patrón de otros modales de Finanzas si hay).
- Produces: modal "+ Gasto de caja" y card "Historial de caja".

- [ ] **Step 1: Botón y modal de gasto**

En `CajaDelDia`, cuando la caja está **abierta**: botón secundario "− Gasto de caja" (estilo botón borde como "Cerrar caja"). Abre un modal chico:
- Campos: Motivo (text, requerido), Monto S/ (number > 0), Método (select con efectivo/yape/plin/tarjeta/transferencia — default efectivo).
- Guardar → `useRegistrarGastoCaja` → toast ok ("Gasto registrado — descontado del efectivo esperado" si efectivo) → cierra modal. Error → toast con el mensaje de la RPC (ella valida caja abierta/monto/motivo).
- El efectivo esperado se recalcula solo (la invalidación de `['finanzas', sedeId]` refresca `movs` y `efectivoHoy` ya resta gastos en efectivo).

- [ ] **Step 2: Card de historial**

Al pie de la página Finanzas (después de la lista de movimientos): card colapsada "📒 Historial de caja" (botón que expande). Al expandir, usa `useHistorialCaja(sedeId)`:
- Tabla/filas: Fecha · Fondo inicial · Esperado · Contado · Diferencia (verde "cuadró ✓" si |dif|<0.01; rojo "faltaron/sobraron S/X") · Abrió/Cerró (nombres).
- Estados: LoadingState / EmptyState ("Aún no hay cierres de caja") / ErrorState.
- Responsive: en móvil las filas envuelven (flex-wrap) o tabla con overflow-x-auto.

- [ ] **Step 3: Build + commit**

Run: `npm run build` → sin errores.
```bash
git add src/pages/Finanzas.jsx
git commit -m "feat(caja): gasto de caja chica + historial de cierres"
```

---

## Self-Review

**Spec coverage (caja chica):** arqueo por denominaciones dentro del cierre + `arqueo_detalle` ✅ (T1, T3) · gastos con validación server-side, categoría `caja_chica`, descuenta del esperado ✅ (T1, T4) · historial de cierres con diferencia y responsables ✅ (T2, T4) · no reescribe `CajaDelDia`, amplía ✅ · CAT_LABEL ✅ (T3).
**Placeholders:** T3/T4 describen UI por composición con los datos/estados exactos (patrón del repo, igual que el plan del POS).
**Consistencia:** `registrar_gasto_caja` 4 args ↔ hook 4 params ↔ modal 3 campos + default. `arqueo_detalle` jsonb ↔ objeto `{key: cantidad}` ↔ select del historial. FK names verificados contra la BD real.
**Punto frágil marcado:** nombre de la columna de nombre en `usuario` (T2 Step 2 lo verifica antes del build).

## Notas
- El gasto con `caja_id` enlazado (la RPC lo setea) es un extra sobre las RPCs viejas que dejan caja_id null — mejora el cuadre sin romper nada (el cálculo del panel filtra por fecha, no por caja_id).
- Timezone: la RPC busca la caja por `estado='abierta'` (no por fecha) justamente para evitar el desfase UTC vs hora Perú — desde las 7pm Perú el `current_date` del servidor ya es el día siguiente.
