# Compartir una rutina por enlace y QR — diseño

**Fecha:** 2026-08-03
**Estado:** aprobado por el owner, pendiente de plan de implementación

## Qué se construye

Poder pasarle tu rutina a alguien concreto —un amigo, un cliente— sin publicarla
a toda la comunidad. Dos formas de lo mismo:

- **Enlace:** `fitcorecenter.com/r/a7k2m9x3`, para WhatsApp o donde sea.
- **QR:** ese mismo enlace en código, para quien tienes delante.

Quien lo abre **con la app** entra directo a la rutina y puede usarla. Quien lo
abre **sin la app** ve una página web con la rutina completa y un botón para
descargarla: cada rutina compartida se vuelve una puerta de entrada.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Sin la app | Página web con la rutina + botón de descarga | Llevar directo a la tienda desperdicia el interés: la persona no sabe qué le compartieron ni por qué bajarse nada |
| Qué se comparte | Cualquier rutina propia, publicada o no | Mandarle algo a alguien concreto y publicarlo para todos son cosas distintas |
| Al editar la rutina | El enlace muestra una copia congelada | Quien la está siguiendo no ve cambiar el plan bajo sus pies. Misma decisión que al publicar en la comunidad |
| Quién puede abrirlo | Cualquiera con el enlace, sin cuenta | Es lo natural para WhatsApp, y sin esto la página web no capta a nadie nuevo |

## Estado actual (verificado)

Todo lo necesario ya existe en el proyecto:

- **Deep links funcionando:** `fitcore://login` y `fitcore://pago` en
  `AndroidManifest.xml`. El patrón está probado.
- **QR integrado:** `qrose` (`rememberQrCodePainter`), lo usa el carnet del socio
  en `PantallaPerfilSocio.kt`.
- **Páginas públicas en el panel:** `main.jsx` ya enruta `/terminos`,
  `/privacidad`, `/demo`, `/planes` sin sesión.
- **El panel usa la `anon key`** (`supabaseClient.js`), así que una RPC con
  `grant execute to anon` se puede llamar sin sesión.
- **La ruta `/r/<token>` no choca con nada** y el rewrite genérico de
  `vercel.json` (`/((?!api/|sitemap...).*) → /index.html`) ya la sirve: no hay
  que tocar la configuración de Vercel, solo enrutarla en `main.jsx` junto a las
  otras públicas.
- **Adoptar una rutina:** `adoptar_rutina_predisenada(uuid)` ya copia una rutina
  a la cuenta de quien la usa.

## Arquitectura

### Tabla `rutina_compartida`

| Campo | Tipo | Para qué |
|---|---|---|
| `id` | uuid | PK |
| `token` | text unique | 8 caracteres → la parte pública del enlace |
| `usuario_id` | uuid | Quién comparte. Puede revocar |
| `rutina_libre_id` | uuid null | De qué rutina salió (`on delete set null`) |
| `nombre` | text | Título mostrado |
| `contenido` | jsonb | **La rutina congelada**: días, focos, ejercicios |
| `activo` | boolean | Revocar sin borrar |
| `aperturas` | int | Cuántas veces se abrió |
| `created_at` | timestamptz | |

**Por qué el contenido va en JSON congelado y no como enlace a la rutina viva:**
el owner eligió copia congelada, y guardarla ya renderizada evita que la página
pública tenga que leer cinco tablas con permisos de invitado. Una consulta, un
dato, y la RLS de las tablas de rutinas no se toca.

**Por qué un token y no el id de la rutina:**
1. Con el id, cualquiera podría probar identificadores y leer rutinas ajenas.
2. Se puede revocar el enlace sin borrar la rutina.
3. Se cuentan las aperturas.

### RPCs

```
compartir_mi_rutina(p_rutina_libre uuid) → jsonb {token, url}
```
Congela la rutina y devuelve el token. **Idempotente**: si esa rutina ya se
compartió y sigue activa, devuelve el mismo enlace en vez de generar otro — si
no, cada toque del botón crearía un enlace nuevo y el anterior quedaría huérfano.
Solo `authenticated`, y solo rutinas propias.

```
ver_rutina_compartida(p_token text) → jsonb {nombre, autor, contenido, ...}
```
Devuelve el contenido e incrementa `aperturas`. **Accesible sin sesión**
(`grant execute to anon`): es lo que hace funcionar la página web. Solo lee
`rutina_compartida`, nunca las tablas de rutinas.

```
revocar_rutina_compartida(p_token text) → jsonb {ok}
```
Apaga el enlace (`activo = false`). Solo el autor.

### RLS

`rutina_compartida` con RLS activo y **sin política de SELECT para `anon`**: la
página pública entra por la RPC `security definer`, no leyendo la tabla. Así un
invitado no puede enumerar tokens ni listar lo compartido por otros.

El autor sí ve las suyas (`usuario_id = auth.uid()`), para poder revocarlas.

### Flujo

**Compartir (app):** botón "Compartir" en la rutina → llama
`compartir_mi_rutina` → muestra el enlace (copiar / compartir nativo) y el QR.

**Recibir con la app:** `fitcore://rutina?token=…` → la app llama
`ver_rutina_compartida` → pantalla con la rutina y "Usar esta rutina" (que copia
el contenido a una rutina propia nueva, sin tocar la del autor).

Ese esquema hay que **declararlo en `AndroidManifest.xml`** (`<data
android:scheme="fitcore" android:host="rutina" />`, junto a los de `login` y
`pago` que ya están) y **manejarlo en `MainActivity`**, siguiendo el patrón de
`NavegacionPush` que ya usan los push de socio y tienda. Sin eso el enlace no
abre nada y el fallo es silencioso.

En iOS el equivalente va en `Info.plist` (`CFBundleURLSchemes`, donde ya está
`pe.fitcore.app`).

**Recibir sin la app:** `fitcorecenter.com/r/<token>` → página pública del panel
→ llama `ver_rutina_compartida` con la `anon key` → pinta la rutina completa,
quién la compartió, y los botones de descarga (Google Play / App Store, los
mismos enlaces que ya usa el landing).

### Dónde vive la lógica (para que sea testeable)

La lógica que se prueba NO puede vivir dentro de componentes de UI: un test que
tiene que montar una pantalla para comprobar que una URL se arma bien es lento y
frágil. Va en funciones puras:

- **Panel:** `src/lib/compartir.js` → `urlCompartir(token)`,
  `tokenDesdeRuta(pathname)`, y el formateo de la rutina para la vista pública.
  La página solo llama a estas funciones y pinta.
- **App:** el parseo del deep link (`tokenDeDeepLink`) va junto a los modelos, no
  dentro del composable ni de `MainActivity`.

Es el mismo criterio que ya sigue `src/lib/unidades.js`, que tiene sus tests.

## Riesgos y cómo se tratan

**Enumeración de tokens.** 8 caracteres alfanuméricos son ~2.8 billones de
combinaciones; probar al azar no es viable. Aun así el token se genera con
`gen_random_bytes`, no con un contador ni con el id.

**Alguien comparte algo que no debería.** El enlace expone la rutina a quien lo
tenga — por eso al compartir se avisa en una línea de que cualquiera con el
enlace podrá verla. Y se puede revocar.

**Contenido desactualizado.** Es la decisión tomada (copia congelada), no un
fallo. Si el autor quiere compartir la versión nueva, revoca y comparte otra vez.

**La página pública se indexa en Google.** Es deseable —capta usuarios— pero
significa que una rutina compartida puede aparecer en buscadores. Se documenta
en el aviso al compartir.

## Fuera de alcance (a propósito)

- **Caducidad del enlace:** revocar ya cubre el caso, y una fecha de expiración
  es un campo más que explicar.
- **Un enlace distinto por persona:** un enlace por rutina basta para lo pedido.
- **Ver quién abrió el enlace:** solo el contador. Registrar quién entra en una
  página pública abre un tema de privacidad que nadie pidió.
- **Compartir rutinas de un gimnasio** (las que asigna un trainer): esto es solo
  para rutinas propias del usuario.

## Verificación

Esta feature se entrega **con pruebas automatizadas reales**, no solo con
comprobaciones manuales. Motivo: los fallos más caros de este proyecto no los
detectó nadie mirando (el `DELETE` sin `WHERE` que rompía crear rutinas, la fuga
de rutinas pendientes a cualquier usuario, el `nivel = 'intermedio'` fijo que
dejaba el filtro inservible). Los tres eran comprobables por código.

### Capa 1 — SQL: `supabase/tests/compartir_rutina.test.sql` (NUEVO)

Hoy **no existen** pruebas de SQL en el repo: las RPCs se verifican a mano en
`begin; … rollback;` y esa verificación se pierde en cuanto termina la sesión.
Este archivo la deja escrita y repetible. Corre entero dentro de una transacción
que hace `rollback` al final, así que se puede lanzar contra producción sin
tocar datos. Cada caso usa `assert` y falla ruidosamente.

Casos que DEBEN pasar:
1. `compartir_mi_rutina` devuelve token de 8 caracteres y una url que lo contiene.
2. Compartir DOS VECES la misma rutina devuelve el **mismo** token (idempotencia)
   — sin esto, cada toque del botón genera un enlace y el anterior queda huérfano.
3. `ver_rutina_compartida` con rol `anon` (sin sesión) devuelve el contenido.
4. Cada llamada a `ver_rutina_compartida` incrementa `aperturas` en 1.
5. El contenido devuelto trae los días y ejercicios de la rutina original.

Casos que DEBEN fallar:
6. Compartir una rutina de OTRO usuario → excepción.
7. `ver_rutina_compartida` con un token inexistente → excepción con mensaje claro.
8. `ver_rutina_compartida` de un enlace revocado → excepción.
9. `revocar_rutina_compartida` sobre un enlace ajeno → excepción.
10. Un usuario `authenticated` cualquiera hace `select` directo sobre
    `rutina_compartida` de otro → **0 filas** (la RLS aísla; la RPC es la única
    puerta).

### Capa 2 — Panel: `tests/compartir-rutina.test.js` (NUEVO, vitest)

Sigue el estilo de `tests/unidades.test.js` (funciones puras, sin red). Prueba
la lógica extraída a `src/lib/compartir.js`:
- `urlCompartir(token)` arma `https://fitcorecenter.com/r/<token>`.
- `tokenDesdeRuta('/r/a7k2m9x3')` devuelve el token; con `/r/` o `/otra/cosa`
  devuelve null (así la página no llama a la RPC con basura).
- El formateo de la rutina para la vista pública: días ordenados, un día sin
  ejercicios no rompe, y una rutina sin días devuelve lista vacía en vez de
  reventar.

### Capa 3 — App: `composeApp/src/commonTest/.../CompartirRutinaTest.kt` (NUEVO)

Sigue el estilo de los tests que ya existen (`CarritoOfertaTest.kt`,
`MinimoCompraTest.kt`), con `kotlin.test`:
- El modelo de la rutina compartida **deserializa el JSON REAL** de la RPC
  (pegado literal en el test). Es la prueba que habría evitado los desajustes de
  `@SerialName` que ya nos costaron tres pantallas en blanco.
- Un JSON con campos ausentes o `null` no lanza excepción (defaults correctos).
- `tokenDeDeepLink("fitcore://rutina?token=a7k2m9x3")` extrae el token, y
  devuelve null si el enlace viene sin token o con otro host.

### Comprobaciones manuales (lo que un test no cubre)

- Compilar Android **e** iOS.
- En emulador: el QR se pinta y se puede escanear; el deep link abre la rutina.
- La página `/r/<token>` carga en el navegador **sin sesión iniciada**.
- `npm test` y `npm run build` limpios en el panel.
