# 📱 Handoff — Arreglar el UI/UX del panel en móvil

> **Estado:** pendiente · **Detectado:** 2026-07-19 en la revisión de UI/UX previa a
> la demo de producto · **Alcance:** solo el panel (no la app móvil KMP).
>
> El panel **en escritorio se ve profesional y está listo para mostrar**. Este
> documento cubre lo único que quedó mal: **el layout en pantallas de celular**.

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
