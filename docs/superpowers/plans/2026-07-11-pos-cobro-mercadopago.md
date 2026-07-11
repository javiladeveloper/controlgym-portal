# Cobro con MercadoPago desde el POS (QR + link WhatsApp) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el POS (sección Ventas) pueda cobrar por pasarela: método "MercadoPago" → QR en pantalla (el cliente escanea y paga con tarjeta/Yape vía MP) + botón para mandar el link por WhatsApp. El pago cae en la cuenta MP del gym (−5% FitCore), el webhook confirma y registra la venta (stock + caja + boleta) solo.

**Architecture:** REUSA el pipeline in-app completo: `POST /api/mp/crear-pago` (ya soporta carrito + membresía con el token del gym y marketplace_fee 5%) crea la preferencia y devuelve `init_point`; `api/mp/webhook.js` ya registra stock/caja/comprobante al aprobarse. Lo nuevo: columna `pago_app.canal` ('app'|'mostrador' — mostrador NO pasa por el flujo de recojo/entrega porque el cliente tiene el producto en la mano), RPC de poll `estado_pago_pos`, y en el POS un modal con QR (lib `react-qr-code`) + link `wa.me` + poll hasta aprobado.

**Tech Stack:** Supabase Postgres (psql UTF-8), Vercel Functions existentes, React + `react-qr-code` (SVG, sin red), React Query (refetchInterval).

## Global Constraints

- Migraciones: `.sql` UTF-8, psql `-f`, siguiente número libre `20260711000001`. `DBURL=$(cat /tmp/.dburl)`; NO imprimir /tmp/.dburl.
- NO duplicar lógica de pago: el POS llama el MISMO `/api/mp/crear-pago` y el MISMO webhook confirma. Cero endpoints nuevos de pago.
- El dinero va a la cuenta MP del gym (token de `empresa_mp`) con `marketplace_fee` 5% — ya lo hace crear-pago; no tocar montos/comisión.
- `pago_app.estado_activacion` CHECK actual — verificar sus valores antes de usar uno nuevo; para mostrador-producto usar `'no_aplica'` si el CHECK lo permite (el cliente ya se llevó el producto; NO debe aparecer en "órdenes por entregar" de Kardex).
- El poll del POS necesita leer el estado del pago: RPC `estado_pago_pos(p_pago_id)` security definer que valida `empresa_id = auth_empresa_id()` (recepción puede; no exponer datos de otros gyms). No confiar en RLS de pago_app (está cerrada para authenticated en varias columnas).
- UI: tokens del tema, responsive, español. El modal de QR muestra: QR grande + monto + "El cliente escanea y paga con tarjeta o Yape" + botón WhatsApp (`https://wa.me/?text=...` con el init_point; si el flujo es membresía y el socio tiene teléfono, `wa.me/51<telefono>?text=`) + estado en vivo ("Esperando pago…" → "✓ Pagado").
- Si el gym NO tiene MP conectado, crear-pago ya devuelve error claro → el POS lo muestra en toast (no hace falta pre-chequear).
- Boleta: el webhook ya llama `crear_comprobante_pago_app` → sale sola con los datos que ya vienen en el pago (para mostrador pasar los datos de cliente del bloque de boleta del POS como `nuevo:{nombre,documento,email}` si el usuario los llenó).

---

## Task 1: Migración — `pago_app.canal` + RPC de poll `estado_pago_pos`

**Files:**
- Create: `supabase/migrations/20260711000001_pago_mostrador.sql`

**Interfaces:**
- Produces: columna `pago_app.canal text default 'app' check in ('app','mostrador')`; RPC `estado_pago_pos(p_pago_id uuid) → jsonb` con `{estado_pago, estado_activacion, monto, comprobante_estado}` validando empresa del caller.

- [ ] **Step 1: Verificar el CHECK de estado_activacion**

Run:
```bash
DBURL=$(cat /tmp/.dburl)
psql "$DBURL" -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.pago_app'::regclass and contype='c';"
```
Anotar los valores permitidos de `estado_activacion` (el webhook usará `'no_aplica'` para mostrador-producto — confirmar que existe en el CHECK; si no, incluir su alta en esta migración).

- [ ] **Step 2: Escribir la migración**

```sql
-- Cobro por pasarela desde el POS (mostrador): mismo pipeline que la app,
-- pero el canal distingue que NO hay recojo (el cliente ya tiene el producto).
alter table public.pago_app
  add column if not exists canal text not null default 'app';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pago_app_canal_check') then
    alter table public.pago_app add constraint pago_app_canal_check
      check (canal in ('app','mostrador'));
  end if;
end $$;

-- Poll del POS: estado del pago SIN exponer tokens ni datos de otros gyms.
create or replace function public.estado_pago_pos(p_pago_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_pago public.pago_app; v_empresa uuid := public.auth_empresa_id();
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  select * into v_pago from public.pago_app
    where id = p_pago_id and empresa_id = v_empresa;
  if v_pago.id is null then return jsonb_build_object('encontrado', false); end if;
  return jsonb_build_object(
    'encontrado', true,
    'estado_pago', v_pago.estado_pago,
    'monto', v_pago.monto,
    'comprobante_estado', v_pago.comprobante_estado);
end;
$function$;
grant execute on function public.estado_pago_pos(uuid) to authenticated;
```

- [ ] **Step 3: Aplicar y verificar**

Run: `psql "$DBURL" -f supabase/migrations/20260711000001_pago_mostrador.sql` → `ALTER TABLE`, `CREATE FUNCTION`, `GRANT`.
Verificar: `psql "$DBURL" -c "select proname from pg_proc where proname='estado_pago_pos';"`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260711000001_pago_mostrador.sql
git commit -m "feat(pos-mp): pago_app.canal + RPC estado_pago_pos (poll del POS)"
```

---

## Task 2: Backend — crear-pago acepta `canal` + webhook sin recojo para mostrador

**Files:**
- Modify: `api/mp/crear-pago.js` (aceptar y persistir `canal`)
- Modify: `api/mp/webhook.js` (si `canal='mostrador'` y tipo producto → `estado_activacion='no_aplica'`, NO 'pendiente_activacion')

**Interfaces:**
- Consumes: contrato actual de crear-pago (`{empresa_id, tipo, items|ref_id, socio_id?, sede_id?, nuevo?}`).
- Produces: crear-pago acepta `canal?: 'app'|'mostrador'` (default 'app') y lo guarda en el insert de pago_app. El webhook, en el bloque de productos aprobados, usa el canal para decidir el estado de activación.

- [ ] **Step 1: crear-pago.js**

En el destructuring del body agregar `canal`; en el INSERT de `pago_app` agregar la columna `canal` con `['app','mostrador'].includes(canal) ? canal : 'app'`. NO tocar montos, fee, preferencia ni validaciones existentes.

- [ ] **Step 2: webhook.js**

En el bloque `tipo='producto'` aprobado (donde hoy setea `estado_activacion='pendiente_activacion'`): leer `pago.canal`; si es `'mostrador'`, setear `'no_aplica'` en su lugar (el cliente ya tiene el producto — no debe aparecer en órdenes por entregar). El resto (registrar_mov_inventario por ítem, comprobante, disparo del worker) queda igual. Membresía no cambia (renew_membership igual para ambos canales).

- [ ] **Step 3: Verificar que no se rompió el flujo app**

Leer el diff completo de ambos archivos: el camino `canal='app'` (default) debe ser byte-idéntico al comportamiento actual. `npm run build` verde.

- [ ] **Step 4: Commit**

```bash
git add api/mp/crear-pago.js api/mp/webhook.js
git commit -m "feat(pos-mp): canal mostrador (sin recojo) en crear-pago y webhook"
```

---

## Task 3: POS — método MercadoPago + modal QR/WhatsApp + poll

**Files:**
- Modify: `package.json` (agregar `react-qr-code`)
- Create: `src/components/CobroQrModal.jsx`
- Modify: `src/hooks/useVentas.js` (agregar `useCrearPagoMostrador`, `useEstadoPagoPos`)
- Modify: `src/pages/Ventas.jsx` (chip MercadoPago + integración del modal)

**Interfaces:**
- Consumes: `/api/mp/crear-pago` (con canal:'mostrador'), RPC `estado_pago_pos`, `usePanel` (sedeId), `useAuth` (empresa.id).
- Produces: `useCrearPagoMostrador()` → `{pago_id, init_point}`; `useEstadoPagoPos(pagoId, {enabled})` con `refetchInterval: 4000`; `<CobroQrModal pagoId initPoint monto telefono? onPagado onClose/>`.

- [ ] **Step 1: Instalar react-qr-code**

Run: `npm install react-qr-code` (SVG puro, sin red, ~10KB). Verificar que quedó en package.json.

- [ ] **Step 2: Hooks en useVentas.js**

```javascript
// Crea el pago de mostrador (misma preferencia MP que la app, canal mostrador).
export function useCrearPagoMostrador() {
  return useMutation({
    mutationFn: async ({ empresaId, tipo, items, refId, socioId, sedeId, cliente }) => {
      const body = {
        empresa_id: empresaId, tipo, sede_id: sedeId, canal: 'mostrador',
        ...(tipo === 'producto' ? { items } : { ref_id: refId, socio_id: socioId }),
        ...(cliente?.numDoc ? { nuevo: { nombre: cliente.nombre, documento: cliente.numDoc, email: cliente.email } } : {}),
      }
      const res = await fetch('/api/mp/crear-pago', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'No se pudo crear el cobro')
      return out // { pago_id, init_point }
    },
  })
}

// Poll del estado del pago mientras el modal QR está abierto.
export function useEstadoPagoPos(pagoId) {
  return useQuery({
    queryKey: ['estado-pago-pos', pagoId],
    enabled: !!pagoId,
    refetchInterval: (q) => (q.state.data?.estado_pago === 'aprobado' ? false : 4000),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_pago_pos', { p_pago_id: pagoId })
      if (error) throw error
      return data
    },
  })
}
```
(Verificar el nombre real de los campos que devuelve crear-pago — leer el return del endpoint: puede ser `{init_point, pago_id}` u otro; ajustar.)

- [ ] **Step 3: CobroQrModal.jsx**

Modal (componente `Modal` del repo) con:
- Monto grande arriba (`money(monto, moneda)`).
- `<QRCode value={initPoint} size={220} />` centrado (import de react-qr-code).
- Texto: "El cliente escanea y paga con tarjeta o Yape".
- Botón "Enviar link por WhatsApp": `window.open('https://wa.me/' + (telefono ? '51'+telefono : '') + '?text=' + encodeURIComponent('Paga aquí tu compra en <gym>: ' + initPoint))`.
- Estado en vivo con `useEstadoPagoPos(pagoId)`: "⏳ Esperando el pago…" → al llegar `estado_pago==='aprobado'`: "✓ Pagado" (verde) + `onPagado()` (el padre invalida kardex/finanzas y muestra el resultado normal del POS). Botón "Cancelar cobro" (cierra el modal; el pago queda pendiente en MP y expira solo — no revertimos nada porque el webhook solo actúa al aprobarse).

- [ ] **Step 4: Integración en Ventas.jsx**

- Agregar chip `MercadoPago` a los métodos (junto a los de `METODOS_PAGO`; visual igual, puede ir con un icono 📲). OJO: NO agregarlo a `METODOS_PAGO` global (ese arreglo alimenta selects de gasto/registro con el CHECK de metodo_pago del movimiento — 'mercadopago' SÍ está en el CHECK, verificar; si está, se puede agregar allí con flag; decisión del implementer con verificación).
- Al darle Cobrar con MercadoPago: en vez de las RPCs locales, llamar `useCrearPagoMostrador` con el carrito (o membresía + socioId) + los datos de cliente del bloque de boleta → abrir `CobroQrModal`.
- En `onPagado`: cerrar modal, invalidar `['kardex']`/`['finanzas']`/`['membresias']`, mostrar el card de resultado del POS ("✓ Cobrado S/XX — Boleta en proceso") — la venta ya la registró el webhook (NO llamar vender_carrito local: sería doble venta).
- Los métodos físicos (efectivo/yape/plin/tarjeta/transferencia) siguen exactamente igual (RPC local).

- [ ] **Step 5: Build + commit**

`npm run build` verde.
```bash
git add package.json package-lock.json src/components/CobroQrModal.jsx src/hooks/useVentas.js src/pages/Ventas.jsx
git commit -m "feat(pos-mp): cobro con QR de MercadoPago + link WhatsApp en el POS"
```

---

## Task 4: Verificación E2E del circuito (hasta donde se puede sin pagar)

**Files:**
- (sin archivos nuevos — verificación)

- [ ] **Step 1: Crear un pago de mostrador real contra la BD**

Con MaximusGym (tiene MP conectado): llamar `POST /api/mp/crear-pago` (producción o local con DATABASE_URL) con un producto real, `canal:'mostrador'` → debe devolver `init_point` válido de MercadoPago y crear la fila `pago_app` con `canal='mostrador'`, `estado_pago='pendiente'`. Verificar en BD.

- [ ] **Step 2: Verificar el poll**

`select public.estado_pago_pos('<pago_id>')` → `{encontrado:true, estado_pago:'pendiente', ...}`. Con un uuid de otro gym → `encontrado:false`.

- [ ] **Step 3: Limpiar el pago de prueba**

`delete from public.pago_app where id='<pago_id>' and estado_pago='pendiente';` (solo el de prueba, pendiente, nunca uno aprobado).

- [ ] **Step 4: Commit final si hubo ajustes**

El pago REAL de punta a punta (escanear el QR y pagar) lo hace el owner con un monto chico — igual que validará la boleta NORAC.

---

## Self-Review

**Cobertura:** QR en pantalla ✅ (T3) · link WhatsApp ✅ (T3) · dinero a la cuenta MP del gym −5% ✅ (reusa crear-pago) · confirmación automática + stock + caja + boleta ✅ (reusa webhook) · sin recojo en mostrador ✅ (T1 canal + T2 webhook) · poll seguro multi-tenant ✅ (T1 RPC) · métodos físicos intactos ✅ (T3).
**Decisión clave documentada:** cero endpoints de pago nuevos — el POS entra por el mismo carril que la app; el `canal` solo cambia la activación (no el dinero).
**Puntos frágiles marcados:** valores del CHECK de estado_activacion (T1 Step 1), nombre exacto del retorno de crear-pago (T3 Step 2), presencia de 'mercadopago' en el CHECK de metodo_pago (T3 Step 4).
