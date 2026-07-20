# 📱 Handoff — UI/UX del panel en móvil

> **Estado:** ✅ **Hallazgos 1 y 2 RESUELTOS** (2026-07-20) · quedan los cosméticos
> (3 y 4) · **Alcance:** solo el panel web (no la app móvil KMP, que es otro repo).
>
> El panel **en escritorio se ve profesional y está listo para mostrar**. Este
> documento cubrió el layout en pantallas de celular.

---

## ✅ Lo que ya se arregló (2026-07-20)

Verificado a 390 px midiendo `getBoundingClientRect()` en las 14 rutas del panel:
**ninguna pantalla tiene botones inalcanzables**.

| Pantalla | Qué pasaba | Fix aplicado |
|---|---|---|
| **Clientes** | "Nuevo socio" fuera de pantalla (`x=383` de 390 px) | `flex-wrap` en la cabecera + input `w-full sm:w-[290px]` |
| **Máquinas** | `overflow-hidden` **recortaba** la tabla (min-w 660px) y su grid de 2 columnas no cabía | `overflow-x-auto` + `grid-cols-1 lg:grid-cols-[1.7fr_1fr]` |
| **CRM** | filas de lista sin envolver | `flex-wrap` en las 4 filas con ese patrón |

**Correcciones al diagnóstico original** (útiles para no repetir el análisis):
- El **kanban de CRM ya estaba bien**: usa `max-lg:overflow-x-auto` con snap y
  columnas de `78vw` (carrusel deslizable). Era un falso positivo del detector,
  que buscaba la clase `overflow-x-auto` exacta en vez del estilo computado.
- Las **tablas de Clientes/Membresías/Personal/Kardex ya tenían `overflow-x-auto`**:
  sus acciones se alcanzan deslizando. Es mejorable (ver Hallazgo 2) pero **no
  bloquea**.
- **Clases** no tenía problema real.

**Cómo detectarlo bien** (el detector correcto usa estilo computado, no clases):

```js
const scrollable = (el) => { let p = el
  while (p && p !== document.body) { const s = getComputedStyle(p)
    if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true
    p = p.parentElement } return false }
const d = document.documentElement
;[...document.querySelectorAll('button,a')]
  .filter(e => { const b = e.getBoundingClientRect()
    return b.width > 0 && b.right > d.clientWidth + 2 && !scrollable(e) })
  .map(e => e.textContent.trim())
```
Debe devolver `[]` en todas las rutas con el viewport en 390 px.

---

## Resumen para quien lo tome

En viewport de celular (~390 px) **hay botones de acción que quedan fuera de la
pantalla y no se pueden alcanzar**. En Clientes, eso significa que **no se puede
dar de alta un socio desde el celular**.

Verificado midiendo `getBoundingClientRect()` real a 390 px, no a ojo.

---

## Hallazgo 1 — 🔴 Botones de cabecera cortados (BLOQUEANTE)

**El más grave: el botón primario de la pantalla no es alcanzable.**

**Causa raíz** (`src/pages/Clientes.jsx:384-392`): la cabecera es un `flex` **sin
`flex-wrap`**, con un input de **ancho fijo** y dos botones al lado:

```jsx
<div className="flex items-center gap-3">
  <input className="w-[290px] …" placeholder="Buscar por nombre, DNI…" />
  <GhostButton>⬆ Importar</GhostButton>
  <PrimaryButton>Nuevo socio</PrimaryButton>   {/* ← se sale de la pantalla */}
</div>
```

290 px (input) + gaps + 2 botones supera los 390 px del viewport. Como el
contenedor **no envuelve ni permite scroll horizontal**, "Nuevo socio" queda
recortado: medido en `x=383 … right=488` con `clientWidth=390`.

**Fix sugerido:** que la cabecera envuelva y el input sea fluido.

```jsx
<div className="flex flex-wrap items-center gap-3">
  <input className="w-full sm:w-[290px] …" />
  …
</div>
```

**Revisar el mismo patrón en** (inputs de ancho fijo en cabecera):
- `src/pages/Clientes.jsx:389` → `w-[290px]`
- `src/pages/CRM.jsx:493` → `w-[220px]`
- `src/pages/Bienvenida.jsx:489` → `w-[380px]`

---

## Hallazgo 2 — ⚠️ Acciones de fila solo alcanzables deslizando (MENOR)

Las tablas **sí tienen `overflow-x-auto`** (ej. `Clientes.jsx:410`) y las filas
usan `min-w-[720px]`. O sea: en móvil las columnas de acción **se alcanzan
deslizando la tabla en horizontal** — funciona, pero no es evidente y se siente
tosco en el celular.

Afecta a: **Clientes** (✏️, "Ver ficha"), **Membresías** ("Renovar", "Congelar",
"Reactivar"), **Personal** ("Entrada", "Pagar sueldo"), **CRM** ("Avanzar →",
"→ Socio"), **Kardex** ("Anular"), **Clases**, **Máquinas**.

**No bloquea**, pero si se quiere una experiencia móvil real, el patrón correcto
es **tarjetas apiladas en móvil y tabla en escritorio** (`hidden md:grid` para la
tabla + una vista de tarjetas `md:hidden`), en vez de una tabla de 720 px que se
arrastra.

**Pantallas que YA están bien en móvil:** Ventas y Promociones (0 elementos fuera
de pantalla) — sirven de referencia del patrón bueno.

---

## Hallazgo 3 — ⚠️ Barras de "Metas del equipo" vacías (COSMÉTICO)

En el Dashboard, "Metas del equipo" pinta tres barras planas ("0 de 3 leads").
No está roto (los datos son 0 de verdad), pero es lo primero que se ve al abrir
el panel y **da sensación de producto apagado en una demo**.

**Opciones:** ocultar la tarjeta cuando todas las metas están en 0, o mostrar un
vacío con intención ("Aún nadie registró leads hoy").

---

## Hallazgo 4 — ⚠️ Sin red, el panel expulsa a `/sin-empresa` (COSMÉTICO)

Si se cae la conexión, `get_bootstrap` falla y el usuario aterriza en
`/sin-empresa` (pantalla de "no perteneces a ningún gimnasio") en vez de un
"sin conexión, reintentando". Observado en vivo durante la revisión con
`ERR_INTERNET_DISCONNECTED` (`src/context/AuthContext.jsx:29`).

Es confuso: parece que perdió acceso a su cuenta. Conviene distinguir **error de
red** de **usuario sin empresa**.

---

## Cómo verificar el arreglo

Con el panel corriendo y sesión guardada (`tests/e2e/.auth/admin.json`):

```bash
BASE_URL=http://localhost:5173 npx playwright test panel.auth --project=mobile
```

> ⚠️ **Ojo con la sesión de los e2e.** El `access_token` de Supabase dura 1 h y el
> `refresh_token` es de **un solo uso**. `tests/e2e/global-setup.js` lo renueva al
> arrancar, pero si el storageState quedó viejo (o alguien ya gastó ese refresh),
> **toda la suite del panel falla con "Cargando…"** y parece un bug del panel
> cuando es la credencial. Si ves fallos masivos, comprueba primero:
> ```bash
> node -e "const t=JSON.parse(require('fs').readFileSync('tests/e2e/.auth/admin.json','utf8')).origins[0].localStorage[0].value; const e=JSON.parse(t).expires_at; console.log(e<Date.now()/1000?'TOKEN EXPIRADO':'ok')"
> ```
> Para regenerarlo: loguearse en el panel y volver a guardar el storageState.
> **Mejora pendiente:** que el global-setup haga login con usuario/clave de QA
> (desde variables de entorno) en vez de depender de un refresh token de un solo
> uso — así la suite nunca queda bloqueada por credenciales.

Y esta comprobación directa detecta elementos fuera de pantalla en cualquier ruta:

```js
// en la consola del navegador, con el viewport en 390px
const d = document.documentElement
;[...document.querySelectorAll('button,a')]
  .filter(e => { const b = e.getBoundingClientRect()
                 return b.width > 0 && b.right > d.clientWidth + 2 })
  .map(e => e.textContent.trim())
```
Debe devolver `[]` en todas las pantallas.

**Sugerencia:** al arreglarlo, añadir a `tests/e2e/panel.auth.spec.js` un test
móvil que recorra las rutas y falle si algún botón queda fuera del viewport — así
la regresión no vuelve.

---

## Lo que NO hay que tocar

El escritorio está bien resuelto y no necesita rediseño: identidad visual
consistente, buena jerarquía, copys en peruano y accionables. **Finanzas** es la
mejor pantalla del panel ("¿En qué se movió la plata este mes?", colores
semánticos, filtros de periodo) — no cambiarla, usarla de referencia.
