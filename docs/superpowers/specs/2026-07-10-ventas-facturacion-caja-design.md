# Ventas (POS) + Facturación electrónica (NORAC) + Caja chica

**Fecha:** 2026-07-10
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Objetivo

Reorganizar el módulo de dinero de FitCore en tres piezas claras y cuidadas
(UI/UX consistente con el tema ya unificado, responsive, sin recargar):

1. **Punto de Venta (POS):** una sección **nueva "Ventas"** separada de Kardex,
   donde se venden productos y se cobra/renueva membresía, se elige método de
   pago (incluida **tarjeta**), y sale la boleta. Kardex vuelve a ser **solo
   inventario** (stock, ofertas, entregas de la app).
2. **Facturación electrónica:** cada venta/cobro/pago in-app genera una **boleta
   o factura** válida ante SUNAT vía **NORAC** (`norac-facturacion`, el SEE
   propio del owner, ya homologado). Sale sola sin frenar la caja.
3. **Caja chica completa:** sobre el arqueo/cierre que ya existe, agregar **conteo
   por denominaciones**, **gastos/egresos** rápidos, e **historial de cierres**,
   para cuadrar finanzas de verdad.

**Recordatorio transversal:** cuidar UI/UX. Reusar `Card`, `PrimaryButton`,
`Badge`, `StatCard` y los tokens del tema (`bg-green`=éxito/acción,
`amber`=aviso, `bg-orange`=acción primaria). Responsive a 375px. No inflar
pantallas.

## Contexto (lo que ya existe)

- **Venta de producto:** RPC `registrar_mov_inventario(p_sede_id, p_producto_id,
  p_tipo, p_cantidad, p_monto)` descuenta stock y registra ingreso en caja
  (`movimiento_financiero` categoría `venta_kardex`, `ref_tipo='producto'`).
  Hoy **no pide datos del cliente** ni pregunta método de pago.
- **Membresía:** `renew_membership(...)`, `abonar_membresia(...)`,
  `inscribir_socio(...)` registran ingreso en caja con `metodo_pago`. Soportan
  abonos parciales (saldo).
- **Pago in-app (MercadoPago):** `api/mp/crear-pago.js` + `api/mp/webhook.js`.
  El webhook al aprobar llama `preparar_comprobante(pago_app.id)` — que hoy solo
  hace `console.log` (no emite).
- **Caja:** tabla `caja` (apertura/cierre por sede/día) + `movimiento_financiero`
  (`tipo` ingreso/gasto, `categoria`, `metodo_pago`, `ref_tipo`/`ref_id`
  polimórfico). CHECK de `metodo_pago`: efectivo, yape, plin, tarjeta,
  transferencia, otro, mercadopago, culqi.
- **Andamiaje de facturación** (`20260706000020_facturacion_see_andamiaje.sql`):
  tabla `empresa_facturacion` (activo, proveedor, ruc, razon_social,
  serie_boleta, serie_factura, correlativo_*, proveedor_token, proveedor_url,
  igv_incluido) con RLS cerrado; columnas `comprobante_*` en `pago_app`; RPCs
  `guardar_facturacion`, `estado_facturacion`, `preparar_comprobante`. **No emite
  y no tiene UI.** Solo enganchado (parcialmente) a `pago_app`.
- **Datos fiscales:** `empresa` tiene `ruc`, `razon_social`, `direccion`.
  `socio` tiene `documento` (sin `tipo_documento`).

## Contrato de NORAC (API real, ya homologada)

- **Base URL:** `https://norac-facturacion.onrender.com` (FastAPI).
- **Auth (M2M):** header `X-API-Key: nrk_{live|test}_<hex>`. Una API key
  **scope=company** por gym, atada a su RUC (no se manda `X-Company-Id`; el
  emisor va en la key). El gym obtiene su key registrándose en NORAC.
- **Emitir:** `POST /api/emit`
  - `tipo`: `"03"` boleta · `"01"` factura · `"07"` NC · `"08"` ND
  - `serie` (requerido, ej. `"B001"`/`"F001"`), `correlativo` (opcional — **si se
    omite, NORAC lo autoincrementa**; lo omitimos)
  - `fecha_emision` (YYYY-MM-DD), `moneda` (default PEN)
  - `receptor`: `{ tipo_doc, num_doc, razon_social, email? }`
    - `tipo_doc`: `"1"`=DNI, `"6"`=RUC, `"0"`=sin documento (boleta genérica)
  - `lineas[]`: `{ descripcion, cantidad, valor_unitario (SIN IGV),
    afectacion_igv:"10" (gravado), unidad:"NIU" }`
  - **Response:** `{ id, numero:"B001-00000012", estado:"accepted"|"queued",
    response_code, importe_total, igv }`. `queued` = SUNAT caído, NORAC
    firmó y reintenta solo (no es error).
- **PDF:** `GET /api/documents/{id}/pdf` (application/pdf con QR). No expone
  XML/CDR por HTTP.
- **Anular:** `POST /api/documents/{id}/void` body `{ motivo }`.
- **Sin webhook:** el estado `queued`→`accepted` se consulta con
  `GET /api/documents/{id}` (polling).
- **Modo:** `sunat_mode` (beta/production) se configura por empresa **dentro de
  NORAC** (no desde FitCore).

## Decisiones (acordadas con el owner)

| Tema | Decisión |
|---|---|
| Onboarding NORAC | El gym **pega su API key** `nrk_...` en Config › Facturación (cifrada). Auto-alta desde FitCore = fase futura. |
| Canales a facturar | **Los 3**: producto, membresía, pago in-app. |
| Boleta por defecto | **Boleta simple sin DNI** (`tipo_doc:"0"`, `num_doc:"0"`, `razon_social:"CLIENTE VARIOS"`). No se pide nada al cliente. |
| Opcional | A un clic (colapsado): **boleta con DNI** o **factura con RUC**. |
| IGV | Los precios **ya incluyen IGV** → se desglosa: `base = total/1.18`, `igv = total − base`, `valor_unitario = base/cantidad`. |
| Emisión | **Al vuelo tras el cobro (best-effort) + cron de respaldo.** La venta nunca se traba. |
| Correlativo | Lo lleva **NORAC** (omitimos `correlativo`). |
| UI de estado | **Badges + "Ver boleta"** integrados en Kardex / Membresías / pagos. Sin sección nueva. |
| Método de pago en venta | Exponer `Efectivo · Yape · Plin · Tarjeta · Transferencia` en la venta (resuelve tarjeta en mostrador). |
| Sección de Venta | **Nueva sección "Ventas" (POS)** separada de Kardex: productos + membresía. Kardex = solo inventario. |
| Caja chica | Sobre el arqueo existente: **denominaciones + gastos + historial de cierres**. La caja sigue contando solo efectivo (Yape/tarjeta cuadran solos). |

## Arquitectura

**Enfoque elegido: cola asíncrona + intento al vuelo.**

Al cobrar (cualquier canal), en la **misma transacción** que registra el ingreso
en caja se crea un `comprobante` en estado `pendiente`. Justo después se intenta
emitir de una vez (best-effort); si NORAC tarda o falla, queda `pendiente` y un
cron lo recoge. La venta confirma al instante pase lo que pase con la facturación.

### Modelo de datos

Nueva tabla `comprobante` (una sola, para los 3 canales; reemplaza las columnas
`comprobante_*` sueltas de `pago_app`):

```
comprobante
  id uuid pk
  empresa_id uuid not null           -- RLS: = auth_empresa_id()
  origen text                        -- 'producto' | 'membresia' | 'pago_app'
  ref_tipo text, ref_id uuid         -- apunta al movimiento_financiero / membresia / pago_app
  tipo text default '03'             -- '03' boleta | '01' factura
  cliente_tipo_doc text default '0'  -- '0' | '1' DNI | '6' RUC
  cliente_num_doc text               -- null / DNI / RUC
  cliente_nombre text default 'CLIENTE VARIOS'
  moneda text default 'PEN'
  base numeric(12,2)                 -- sin IGV
  igv numeric(12,2)
  total numeric(12,2)                -- lo cobrado (con IGV)
  estado text default 'pendiente'    -- pendiente | emitido | observado | anulado | error
  norac_id bigint                    -- id que devuelve NORAC
  serie_numero text                  -- 'B001-00000012'
  response_code text
  error_msg text
  intentos int default 0
  created_at, updated_at
  índices: (empresa_id, estado), (ref_tipo, ref_id)
  RLS: empresa_id = auth_empresa_id(); escritura solo backend/RPC
```

`empresa_facturacion.proveedor_token` guarda la key `nrk_...` **cifrada**
(pgcrypto o secreto en `privado.secreto`). Nunca legible por el frontend
(RLS ya cerrado; `estado_facturacion` devuelve solo `tiene_credenciales`).

**Comprobante con carrito multi-ítem:** una venta de N productos genera N
`movimiento_financiero` (uno por ítem, como hoy) pero **un solo `comprobante`**
con N líneas ante NORAC. Por eso el comprobante no se ata a un único
`movimiento_financiero`, sino a una **venta**: se agrega columna
`venta_id uuid` a `movimiento_financiero` (agrupa los ítems de un mismo cobro) y
el comprobante usa `ref_tipo='venta'`, `ref_id=venta_id`. Las líneas del
comprobante se leen de los movimientos con ese `venta_id`. Para membresía y
pago in-app, `ref_id` es la membresía / `pago_app` (una línea). El POS genera un
`venta_id` (uuid) por cobro y lo pasa a cada `registrar_mov_inventario`.

### RPCs (Postgres)

- `crear_comprobante(p_origen, p_ref_tipo, p_ref_id, p_total, p_tipo,
  p_cliente_tipo_doc, p_cliente_num_doc, p_cliente_nombre) → uuid`
  — idempotente por (ref_tipo, ref_id): calcula base/igv desde el total, inserta
  `comprobante` estado `pendiente`. Si el gym no factura
  (`empresa_facturacion.activo=false`) → no crea nada (devuelve null).
  Se llama **dentro** de las RPCs de cobro existentes (o justo después, misma tx).
  El worker arma las **líneas** del payload NORAC leyendo los movimientos con ese
  `venta_id` (productos) o la membresía/pago (una línea).
- `registrar_mov_inventario` gana param opcional `p_venta_id uuid default null`
  (agrupa ítems del mismo cobro). Retrocompatible: null = venta de un solo ítem
  (genera su propio venta_id internamente).
- `comprobantes_pendientes(p_limit) → setof` — para el worker (todos los gyms,
  con su token). SECURITY DEFINER, solo backend.
- `marcar_comprobante(p_id, p_estado, p_norac_id, p_serie_numero,
  p_response_code, p_error) → void` — el worker guarda el resultado.
- Integración en cobros existentes: `registrar_mov_inventario`,
  `renew_membership`, `abonar_membresia`, `inscribir_socio` llaman
  `crear_comprobante(...)` tras registrar el ingreso (misma tx). El pago in-app
  reusa el gancho del webhook (`preparar_comprobante` se reemplaza/ajusta para
  crear un `comprobante`).

### Backend (`api/`)

- `api/facturacion/emitir.js` — worker. Toma `comprobantes_pendientes`, por cada
  uno lee la key del gym, arma el body y hace `POST /api/emit` a NORAC. Mapea:
  `accepted`→`emitido`, `queued`→sigue `pendiente`, rechazo→`observado`,
  error de red→`pendiente` con `intentos++` (tope, ej. 10 → `error`).
  Idempotente. Disparado por **Vercel Cron** (cada 1–5 min) **y** invocado
  best-effort tras el cobro.
- `api/facturacion/pdf.js` (o link directo) — proxy/redirect a
  `…/api/documents/{norac_id}/pdf` con la key del gym (el frontend no ve la key).
- Ajuste en `api/mp/webhook.js`: al aprobar, crea el `comprobante` (reusa RPC) en
  vez del `console.log` actual.

**Receptor según tipo:**
- Boleta simple → `{ tipo_doc:"0", num_doc:"0", razon_social:"CLIENTE VARIOS" }`
- Boleta con DNI → `{ tipo_doc:"1", num_doc:DNI, razon_social:nombre }`
- Factura → `{ tipo_doc:"6", num_doc:RUC, razon_social:razón_social }`

**Anulación:** al anular una venta/membresía con comprobante `emitido`, el worker
llama `POST /api/documents/{norac_id}/void` y marca `anulado`.

### Frontend

1. **Config › Facturación** (nueva tab / usa `empresa_facturacion`):
   toggle "Emitir boletas y facturas", RUC, razón social, serie boleta/factura,
   campo API key NORAC (write-only, muestra `••••` + "Probar conexión"). Llama
   `guardar_facturacion` + una RPC/endpoint nuevo para guardar la key cifrada y
   probar (`GET /health` o `GET /api/documents?limit=1` a NORAC).
2. **Sección Ventas (POS):** ver "Sección Ventas (POS)" arriba. Aquí vive el
   selector de método de pago y el bloque colapsado "¿Boleta con datos o
   factura?". Kardex pierde el flujo de venta.
3. **Badges + "Ver boleta":** en Ventas (historial de ventas del día),
   Membresías y la lista de pagos, cada movimiento con comprobante muestra estado
   (Emitida/Pendiente/Observada/Anulada) y, si `emitido`, botón "Ver boleta"
   (abre PDF). Si `observado`/`error`, botón "Reintentar" (resetea a `pendiente`).
4. **Finanzas:** arqueo por denominaciones en el cierre, "+ Gasto de caja",
   e "Historial de caja" (ver "Caja chica" arriba).

## Sección Ventas (POS) — separada de Kardex

**Nueva ruta/módulo `Ventas`** en el sidebar (rol admin/recepción). Kardex se
queda como inventario puro: se le **quita** el `MovimientoModal` de venta (tipo
'venta'); conserva compra, ajuste, ofertas, imagen, "vender en app" y entregas.

**Pantalla POS (una sola, simple):**
```
[Ventas]                                    Sede: <activa>
┌─ Cobrar ─────────────────────────────────┐   ┌─ Resumen ────────┐
│ ( ) Producto   ( ) Membresía             │   │ Ítems:           │
│                                          │   │  Proteína  S/25  │
│ Buscar producto ▾  [＋ agregar]          │   │  Agua      S/ 3  │
│  (carrito: producto · cant · subtotal)   │   │ ─────────────────│
│                                          │   │ Total    S/28.00 │
│ — o —                                    │   │ IGV incl. S/4.27 │
│ Buscar socio ▾ → renovar/plan            │   │                  │
│                                          │   │ Método: (Efec.)  │
│ ▸ ¿Boleta con datos / factura? (opcional)│   │ (Yape)(Tarjeta)… │
└──────────────────────────────────────────┘   │ [Cobrar S/28]    │
                                                └──────────────────┘
```
- **Productos:** carrito multi-ítem (reusa `precioEfectivo` para ofertas). Al
  cobrar → por cada ítem `registrar_mov_inventario('venta', ...)` (descuenta
  stock + ingreso en caja) y un solo `comprobante` por la venta.
- **Membresía:** busca socio → renovar/plan → `renew_membership`/`abonar_membresia`
  (reusa lo existente) → comprobante.
- **Método de pago:** chips `Efectivo · Yape · Plin · Tarjeta · Transferencia`
  (ya en el CHECK de `metodo_pago`). Se pasa a la RPC de cobro.
- **Boleta/factura opcional:** bloque colapsado; por defecto boleta simple.
- Tras cobrar: toast + badge del comprobante + acceso al PDF cuando esté emitido.

**UI/UX:** dos columnas en desktop (cobro | resumen), apiladas en móvil
(`grid-cols-1 lg:grid-cols-[1fr_320px]`). Componentes del tema. El carrito y el
buscador reusan patrones existentes (no inventar inputs nuevos).

## Caja chica (sobre Finanzas existente)

Finanzas **ya tiene** abrir/cerrar caja, efectivo esperado en vivo vs contado,
diferencia (cuadre), congelado al cierre, anulación con contra-asiento. Se
**amplía**, no se reescribe:

1. **Arqueo por denominaciones** (al cerrar): grilla de billetes/monedas
   (200/100/50/20/10/monedas) que **suma sola** el total contado y lo vuelca en
   el campo "Conté S/". El total sigue guardándose en `caja.saldo_final`; el
   detalle de denominaciones se guarda como JSON en una columna nueva
   `caja.arqueo_detalle jsonb` (opcional, para el reporte). No cambia el cálculo
   de diferencia.
2. **Gastos/egresos de caja chica** (mientras la caja está abierta): botón
   "+ Gasto de caja" → motivo + monto + método (efectivo por defecto) →
   inserta `movimiento_financiero` tipo `gasto`, categoría `caja_chica`,
   `metodo_pago`, ligado al día. Descuenta del efectivo esperado
   (ya lo hace el cálculo `efectivoHoy`). Nueva RPC `registrar_gasto_caja(
   p_sede_id, p_monto, p_motivo, p_metodo_pago)` para validaciones (monto > 0,
   caja abierta).
3. **Historial de cierres**: vista/RPC `historial_caja(p_sede_id, p_desde,
   p_hasta)` que lista cierres pasados (fecha, fondo, esperado, contado,
   diferencia, quién abrió/cerró). UI: tabla colapsable "Historial de caja" en
   Finanzas con las últimas N y filtro por rango. Solo lectura.

**Migración de caja:** agregar `caja.arqueo_detalle jsonb null`; agregar
`'caja_chica'` a las categorías reconocidas (`CAT_LABEL` en Finanzas + validación
de la RPC). El CHECK de `metodo_pago` ya cubre los métodos.

**UI/UX:** el arqueo por denominaciones aparece **dentro del cierre** (no una
pantalla nueva); los gastos son un modal chico; el historial es una tarjeta
colapsada al pie de Finanzas. Nada satura la pantalla principal.

## Manejo de errores

- **Gym sin facturación activa:** no se crea comprobante; la venta funciona igual.
- **Gym sin key / key inválida:** comprobante queda `pendiente`; Config muestra
  "no conectado"; al configurar la key, el cron emite los pendientes acumulados.
- **NORAC caído / timeout:** best-effort falla en silencio → `pendiente` → cron
  reintenta. La caja no se ve afectada.
- **SUNAT caído (`queued`):** NORAC ya lo maneja; comprobante sigue `pendiente`
  hasta que el polling lo vea `accepted`.
- **Rechazo SUNAT (`observado`):** se guarda `error_msg`; el gym ve el motivo y
  puede reintentar tras corregir.
- **Doble emisión:** `crear_comprobante` es idempotente por `(ref_tipo, ref_id)`;
  el worker marca por `id` — un comprobante nunca se emite dos veces.

## Fuera de alcance (fase futura, no ahora)

- Auto-alta del gym en NORAC desde FitCore (subir certificado/SOL).
- Cobro con tarjeta procesado por FitCore (link Culqi/MP en mostrador) — hoy solo
  se **registra** `metodo_pago='tarjeta'` (POS físico del banco).
- Sección "Comprobantes" consolidada con filtros/exportación para contabilidad.
- Notas de crédito por devolución parcial (más allá de la anulación simple).
- Descarga de XML/CDR (NORAC no los expone por HTTP hoy).
- Facturación del propio SaaS (el 3%/5% de FitCore a cada gym) — problema aparte.

## Verificación

**Facturación:**
- Migración aplica limpia; `comprobante` con RLS (gym A no ve comprobantes de B).
- Venta en el POS (efectivo y tarjeta) → ingreso en caja + comprobante
  `pendiente` → worker → `emitido` con `norac_id`, "Ver boleta" abre PDF. Probado
  contra NORAC en modo beta.
- Cobro/renovación de membresía desde el POS → comprobante emitido.
- Pago in-app aprobado → comprobante emitido (webhook).
- Boleta con DNI y factura con RUC opcionales funcionan.
- NORAC apagado → la venta igual confirma; comprobante `pendiente`; al volver
  NORAC el cron lo emite.
- Anular venta con comprobante emitido → `void` en NORAC → `anulado`.

**POS:**
- La sección Ventas cobra productos (carrito multi-ítem con ofertas) y membresía.
- Kardex ya NO permite vender (solo inventario); no se rompió compra/ajuste/app.
- Método de pago se registra correctamente en `movimiento_financiero`.

**Caja chica:**
- Arqueo por denominaciones suma el total y coincide con "Conté S/"; el cuadre no
  cambia. `arqueo_detalle` se guarda.
- "+ Gasto de caja" descuenta del efectivo esperado y aparece como gasto
  `caja_chica`; solo con caja abierta; rechaza monto ≤ 0.
- Historial de caja lista cierres pasados con su diferencia y responsables.

**Transversal:**
- UI responsive a 375px (POS apila, arqueo no desborda); usa tokens del tema.
- `npm run build` sin errores.
