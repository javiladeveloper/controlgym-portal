# Precios nuevos + plan por miembro — diseño

## Problema

Dos cambios comerciales que van juntos:

1. **Los planes de gym suben y absorben la app.** Hoy cada plan tiene dos
   precios (sin app / con app). Esa dualidad complica BD, panel y landing, y la
   app ya no es un extra: es el producto. Los planes de gym pasan a precio único
   con app incluida, más caro que el "con app" de hoy.
2. **Falta una puerta de entrada sin riesgo.** Un gym chico no arranca pagando
   S/99/mes a ciegas. Nace el plan **Miembros**: sin cuota fija, S/1 por socio
   con membresía vigente, cobrado a mes vencido. Si no registra socios, no paga.
   Al crecer, el plan fijo le sale más barato y migra solo (es el embudo, no un
   accidente: un gym de 300 socios pagaría S/300 vs S/279 del Pro completo).

## Precios

| Plan | Hoy (sin app / con app) | Nuevo |
|---|---|---|
| Estudio | 49 / 79 | **99** (app incluida) |
| Crecimiento | 99 / 139 | **169** (app incluida) |
| Pro | 179 / 229 | **279** (app incluida) |
| **Miembros** | — | **S/1 por socio vigente** · sin app |
| Trainer | 29 / 49 | sin cambios |
| Academia | 49 / 69 | sin cambios |
| Niños | 69 / 109 | sin cambios |

Todo por SEDE (decisión previa: cada sede paga su plan).

Los planes de segmento conservan la dualidad sin-app/con-app; solo los de gym la
pierden. Por eso `precio_plan(plan, con_app)` mantiene su firma: ignora
`con_app` para gym, lo respeta para segmento.

**Copy del plan Miembros** (card del panel y landing):

> **Miembros — Usa el sistema GRATIS**
> **S/1** por socio activo / mes
> Gestiona tu gym sin pagar nada por adelantado. A fin de mes pagas S/1 por
> cada socio con membresía vigente — si no registras socios, no pagas nada.
> *Sin cuota fija · sin tarjeta · sin compromiso*
> Letra chica: *Tus socios no se conectan a la app en este plan.*

"El sistema", no "la aplicación": la app móvil es gratis para el socio (existe un
modo libre sin gym), lo que este plan no incluye es la presencia del gym en ella.
Decir "usa la aplicación gratis" haría entender que incluye la app del socio.

## Arquitectura

Cuatro piezas. Las tres primeras son independientes; la cuarta (gate de app)
toca a la app móvil y se coordina con su agente.

### 1. Precios (`precio_plan` + `planesComerciales.js`)

`precio_plan(p_plan, p_con_app)` se redefine con `create or replace` (el patrón
del repo: ya se redefinió 4 veces, la última en `20260706000039_plan_pro.sql`):

```sql
estudio     → 99      -- ignora p_con_app
crecimiento → 169     -- ignora p_con_app
pro         → 279     -- ignora p_con_app
cadena      → 279     -- alias legado
miembros    → 0       -- su monto NO es de lista: sale del conteo
trainer/academia/ninos → sin cambios
```

`miembros → 0` es deliberado: el precio de lista no aplica, el monto real vive en
`factura_sede.monto`. Devolver 0 (no null) evita que `suscripciones_mis_sedes()`
pinte un monto vacío.

En `src/config/planesComerciales.js`, `PLANES_GYM` cambia `{base, conApp}` por
`{precio}`, y se agrega `PLAN_MIEMBROS = {slug:'miembros', porSocio:1, ...}`.
`planPorSlug()` lo incluye.

`plan_rank('miembros') = 1` (mismo set de módulos que Estudio).

`elegir_plan()` valida hoy contra una lista fija (`estudio|crecimiento|cadena`)
que rechazaría el plan nuevo: se amplía para aceptar `miembros`, `pro` y los
slugs de segmento. Al elegir Miembros, la sede queda `estado='activa'` (no
`'prueba'`): no necesita trial porque ya es gratis por definición — el trial de
30 días es para los planes de pago.

**Migración de gyms existentes:** los que hoy están en `con_app=false` pagando
49/99/179 pasan a 99/169/279. La migración les pone `con_app=true` (ahora reciben
la app, que antes no pagaban) y recalcula `monto`. Las filas con
`monto_override=true` no se tocan — ese flag existe precisamente para precios
pactados a mano.

### 2. Facturación del plan Miembros (`factura_sede`)

Hoy existe `pago_plataforma` (historial de cobros) pero **no existe el "cuánto
debes"**. El plan Miembros lo necesita: hay que congelar el conteo del corte y
tener contra qué pagar.

```sql
create table factura_sede (
  id uuid primary key,
  empresa_id uuid not null references empresa(id),
  sede_id uuid not null references sede(id) on delete cascade,
  periodo date not null,            -- 2026-07-01 = julio
  socios_contados int not null,
  monto numeric(12,2) not null,
  moneda text not null default 'PEN',
  estado text not null default 'emitida'
    check (estado in ('emitida','pagada','vencida','anulada')),
  vence_el date not null,
  pagada_at timestamptz,
  pago_id uuid references pago_plataforma(id),
  created_at timestamptz not null default now(),
  unique (sede_id, periodo)
);
```

`unique (sede_id, periodo)` es la idempotencia: el cron puede correr N veces el
mismo día sin duplicar. `socios_contados` congela el conteo — si el gym da de
baja socios el día 2, la factura de julio no cambia.

RLS: SELECT para staff de la empresa (`empresa_id = auth_empresa_id()`) o
superadmin. Sin INSERT/UPDATE para `authenticated` — solo el backend escribe
(conexión directa), como `pago_plataforma`.

`contar_socios_facturables(p_sede_id uuid, p_fecha date) → int`: socios con
membresía vigente a esa fecha. Es la definición del cobro, así que va en función
propia, testeable sola.

### 3. Ciclo mensual (cron + Culqi + solo lectura)

Engancha en el cron diario existente `/api/facturacion` (3am) con
`?action=cierre-mes`. No gasta función serverless — Vercel Hobby permite 12 y
están las 12 usadas.

```
día 1, 3am  → por cada sede en plan miembros: cuenta socios del mes cerrado,
              emite factura (vence_el = +7 días), notifica al gym
días 1-7    → panel: "Debes S/240 por julio · vence el 8" + botón Pagar
              → Culqi → webhook marca pagada → sigue normal
día 8, 3am  → factura sin pagar → estado 'vencida' → sede a SOLO LECTURA
al pagar    → factura pagada → sede vuelve a 'activa' automáticamente
```

Ambos pasos (emitir y vencer) corren en el mismo cron diario, son idempotentes y
se guían por fecha, no por "hoy es 1": si el cron no corre un día, al siguiente
emite igual las facturas faltantes.

**Sede con 0 socios al corte**: no se emite factura (nada que cobrar). Es el caso
normal del gym que recién entra, y sostiene la promesa "si no registras socios,
no pagas nada" — sin factura de S/0 que asuste.

**Aviso**: correo al admin del gym al emitir (día 1) y recordatorio al día 5. Es
un cobro que vence, así que el correo es el canal — no push, que es para socios.
La barra en el panel es el aviso principal; el correo solo trae de vuelta a quien
no entró.

Estado nuevo `impaga` en `suscripcion_sede.estado` (se suma al check existente
`prueba|activa|vencida|cancelada`). `vencida` ya significa "trial vencido"; no se
reutiliza para no confundir dos causas distintas de bloqueo.

**Solo lectura:** `estado_suscripcion_sede()` es el único punto que resuelve el
acceso de una sede. Para `impaga` devuelve `activa: true, solo_lectura: true` —
el gym entra y ve todo, pero se bloquean en **BD** las tres operaciones que
definen "operar":

- registrar cobros/ventas
- inscribir socios (alta y renovación de membresía)
- marcar asistencia / check-in

El bloqueo va en los RPCs, no escondiendo botones: un botón oculto se salta con
la consola. El panel además muestra una barra roja persistente con el monto y el
botón de pago.

**Aviso de migración:** cuando `monto` del mes supera el precio de un plan fijo,
el panel sugiere el cambio ("con Crecimiento pagarías S/169 en vez de S/240").
Sin tope duro ni límite de socios: el gym decide.

### 4. Gate de la app (trabajo nuevo)

Hallazgo de la exploración: **`con_app` hoy no bloquea nada**. Todos sus usos son
`precio_plan` / `monto`; el único lugar que lo expone es `estado_suscripcion_sede()`
y ningún RPC de la app lo consulta. O sea que hoy un gym con `con_app=false`
igual tiene a sus socios en la app. El gate nunca se cableó.

Como el plan Miembros se vende diciendo "tus socios no se conectan a la app", el
gate tiene que existir para que sea verdad.

`vincular_socio()` es la puerta: engancha al usuario con filas de `socio` por
email/teléfono, y `socio.sede_id` (not null) ata cada socio a su sede. El gate
excluye del vínculo a los socios de sedes sin app:

```sql
-- dentro de vincular_socio(), al hacer el update de socio:
and (select (public.estado_suscripcion_sede(s.sede_id))->>'con_app')::boolean
```

Y los RPCs que devuelven datos del gym al socio verifican lo mismo, para el caso
de un socio ya vinculado cuyo gym baja al plan Miembros: deja de ver ese gym.

Se coordina con el agente de la app vía `docs/APP-BACKEND-REQUESTS.md`: la app
debe manejar "el usuario no tiene gym" (modo libre) sin romperse.

## Los tres sitios del pricing

El precio vive en tres lugares que deben cuadrar:

1. `src/config/planesComerciales.js` — panel
2. `precio_plan()` en BD — fuente de verdad del monto cobrado
3. `src/pages/PlataformaLanding.jsx` — landing con calculadora

La landing pierde el toggle "solo panel / panel+app" para gym (ya no aplica) y
gana la card del plan Miembros con una calculadora simple: "¿cuántos socios
tienes?" → "pagarías S/N/mes" → y si N supera un plan fijo, lo sugiere.

## Verificación

- **`precio_plan` (psql)**: cada slug devuelve lo esperado con `con_app` true y
  false; gym ignora el flag, segmento lo respeta, `miembros` da 0.
- **Conteo**: sede con socios vigentes/vencidos/dados de baja →
  `contar_socios_facturables` cuenta solo los vigentes a la fecha del corte.
- **Idempotencia**: correr el cierre dos veces sobre el mismo periodo → 1 sola
  factura (choca el unique y no duplica).
- **Congelado**: emitir factura, dar de baja socios, re-correr → `socios_contados`
  no cambia.
- **Ciclo completo**: emitir → día 8 sin pago → sede `impaga` →
  `estado_suscripcion_sede` da `solo_lectura: true` → intentar cobrar/inscribir/
  marcar asistencia por RPC falla → marcar pagada → sede vuelve a `activa` y las
  tres operaciones funcionan.
- **Gate de app**: socio de sede en plan Miembros → `vincular_socio()` no lo
  engancha; socio ya vinculado cuyo gym baja a Miembros → deja de ver el gym.
- **Migración**: gym con `con_app=false` → queda en `con_app=true` con el precio
  nuevo; gym con `monto_override=true` → intacto.
- **Panel (Playwright)**: card de Miembros con su copy; barra de deuda; sugerencia
  de migración cuando el monto supera un plan fijo. `npm test` + `npm run build`.

## Lo que cambió al construirlo

Cosas que el diseño no previó y salieron al implementar y revisar:

- **`revoke ... from public` no protege nada aquí.** El esquema tiene un
  `alter default privileges ... grant execute on functions to authenticated`
  (de `20260712000006_auditoria_seguridad`), así que toda función nueva nace
  ejecutable por cualquier usuario con sesión, y `create or replace` lo reaplica.
  Las RPC de billing hay que revocarlas **explícitamente a `authenticated`**.
- **Un SELECT no puede escribir.** `estado_suscripcion_sede` marcaba el trial
  vencido al vuelo; al invocarla desde una policy (por fila), Postgres aborta la
  consulta. El efecto se movió a `vencer_trials_sede()`, que corre en el cron.
- **`'vencida'` es un estado terminal**, no "debe ahora": al pagar la factura
  pasa a `'pagada'`, pero una anulada o de otro plan queda `'vencida'` para
  siempre. El bloqueo se decide por el **plan vigente de la sede**, no por el
  estado de facturas históricas.
- **El bloqueo va también en `movimiento_financiero`.** El diseño listaba
  "registrar cobros" pero el dinero no pasa por `socio`/`membresia`/`checkin`:
  entra por ahí. Sin ese trigger, el gym impago seguía facturando.
- **El cierre emite todo periodo faltante**, no solo el mes anterior: Vercel
  documenta que la entrega del cron es best-effort y puede saltarse ejecuciones,
  así que "solo el mes anterior" perdía un mes entero si fallaba el cambio de mes.
- **El plan gratis no puede tener trial.** `elegir_plan` dejaba la sede en
  `prueba`; a los 30 días vencía y bloqueaba al gym por no pagar algo gratis.
- **El copy dice "Empieza sin pagar nada", no "GRATIS".** Esto es pospago: poner
  GRATIS en el gancho con el cobro en letra chica es lo que produce el reclamo al
  primer cobro. Por lo mismo cayó "Sin compromiso" (si no pagas, te bloquean).
- **`mi_consumo_actual()`** no estaba en el diseño y resultó imprescindible: sin
  ella el panel mostraba "S/ 0 al mes" todo el mes y la factura caía de sorpresa.

## Fuera de alcance

- **Tope de cobro / límite de socios** en el plan Miembros: descartado, el embudo
  es intencional (el gym grande migra solo).
- **Tarjeta guardada / cobro automático** en el plan Miembros: pedir tarjeta mata
  el gancho de "sin compromiso". Paga por link cada mes.
- **Prorrateo** al cambiar de plan a mitad de mes: el cobro por miembro es a mes
  vencido sobre el conteo del corte; un cambio de plan a mitad de mes se cobra
  completo en el plan que tenía al corte.
- **Facturación electrónica (NORAC)** de las facturas de plataforma: hoy NORAC
  emite comprobantes de los gyms a sus socios, no de FitCore a los gyms.
