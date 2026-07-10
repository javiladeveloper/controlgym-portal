# Ideas de Image Gym (primer cliente) — plan y roadmap

Feedback real de Image Gym (owner + su compañera + la Sra. María), 2026-07-10.
8 ideas. Este doc mapea: **qué tenemos**, **dónde vive cada una** (panel /
app socio / página web), **esfuerzo**, y el **orden recomendado**.

> **Decisión de ubicación (del owner):** las fotos (perfil, del día) y el buzón
> se recepcionan/gestionan según dónde tengan sentido — la app recibe imágenes y
> fotos del día; el buzón de sugerencias puede ir en la **página web** con un
> correo de la empresa. El panel es la herramienta de gestión (deudores, validar
> fotos, ver sugerencias, autorizar menores).

> **Nota:** el proveedor de facturación electrónica (SEE) será la **propia
> aplicación del owner** (su backend), no un tercero como Nubefact. Se integra
> cuando esté listo. (No es parte de estas 8 ideas, pero se registra aquí.)

---

## Las 8 ideas

### 1. Alertas de vencimiento y deuda (1–2 días antes) ✅ HECHO (2026-07-10)
**Qué pidió:** avisar a cada socio 1–2 días antes del vencimiento; y una lista
de socios con deuda a quienes se les manda alerta virtual de pago.
- **Ya tenemos:** `recordar_vencimientos_socios()` manda **email** a los que
  vencen HOY o en 3 días (cron `fitcontrol-vencimientos-socios` diario). Socios
  se marcan `moroso`. KPI "membresías por vencer 7d" en el dashboard.
- **Falta:**
  - Ajustar la ventana a **1–2 días** (hoy es hoy/+3).
  - Avisar también por **push en la app** del socio (hoy solo email).
  - **Panel:** una lista/sección de **socios con deuda / por vencer** con botón
    "Enviar recordatorio" (push + email).
- **Dónde vive:** panel (lista de deudores + acción) · app socio (recibe el push).
- **Esfuerzo:** medio. **Valor comercial: ALTO** (morosidad es el dolor #1).

### 2. Foto del socio para reconocimiento facial (la sube él) 🔴 falta
**Qué pidió:** cada socio sube su propia foto; con estándares de cómo debe verse.
- **Ya tenemos:** nada (socio no tiene columna de foto). El molinete facial es
  Fase 2 (hardware).
- **Falta:** `socio.foto_url`; en la **app**, el socio sube su foto con una guía
  visual ("de frente, buena luz, sin gorra ni lentes, fondo claro"); en el
  **panel**, recepción la ve/valida antes de habilitarla para el facial.
- **Dónde vive:** app socio (sube + guía) · panel (valida). La usa el Agente
  Puente del molinete facial (Fase 2) cuando exista el hardware.
- **Esfuerzo:** medio. **Valor: alto** (habilita el facial, diferenciador).

### 3. Croquis del gimnasio con áreas y máquinas 🔴 falta (el más nuevo)
**Qué pidió:** un mapa del gym en la app donde se vea cada área, sobre todo
musculación — los socios se pierden buscando máquinas.
- **Ya tenemos:** `maquina.zona` (texto). Nada visual.
- **Falta:** una forma de mostrar un croquis. Opciones (a decidir):
  (a) el gym **sube una imagen** de su plano y marca puntos/áreas encima
  (simple, funciona ya); (b) un editor de croquis por zonas (complejo).
- **Dónde vive:** app socio (lo ve) · panel (el gym sube/edita el croquis).
- **Esfuerzo:** alto (el (a) es medio). **Valor: medio** (buen "wow", no urgente).

### 4. Listado de suplementos con precio y beneficio ✅ HECHO (2026-07-10)
**Qué pidió:** en la app, lista de suplementos que venden con precio y beneficio
de cada uno.
- **Ya tenemos:** la **tienda** (kardex `visible_en_app` con foto, precio,
  descripción; RPC `catalogo_app`; ofertas). Categoría "suplementos" existe.
- **Falta:** un campo **`beneficio`** en producto (o usar `descripcion`), y que
  la tienda/app resalte los suplementos con su beneficio.
- **Dónde vive:** app socio (los ve en la tienda) · panel (los edita en Kardex).
- **Esfuerzo:** bajo. **Valor: medio** (ya casi está, remate fácil).

### 5. Buzón de sugerencias virtual ✅ HECHO (2026-07-10, en la web)
**Qué pidió:** un buzón donde los socios dejan opiniones y dudas.
- **Ya tenemos:** nada.
- **Decisión del owner:** va en la **página web** del gym, con un correo de la
  empresa (el socio escribe → llega al correo del gym / se guarda).
- **Falta:** en la página web pública del gym, un formulario "Sugerencias /
  dudas" que envía al `email_contacto` del gym (ya existe ese dato) y/o guarda en
  una tabla `sugerencia` que el panel muestra.
- **Dónde vive:** página web (formulario) · panel (bandeja de sugerencias, opc.).
- **Esfuerzo:** bajo. **Valor: medio** (agrado, sencillo).

### 6. Autorización virtual para menores/adolescentes 🟡 base modelada
**Qué pidió:** una autorización virtual para los jóvenes/adolescentes que vienen.
- **Ya tenemos:** tabla `apoderado` + `apoderado_socio` (modelado). Categoría de
  gym "niños" con apoderados.
- **Falta:** el **flujo de autorización**: el apoderado autoriza (firma virtual /
  consentimiento) el ingreso/actividad del menor; queda registrado. Definir si es
  en la app del apoderado o un enlace que firma.
- **Dónde vive:** app del apoderado (autoriza) · panel (ve el estado). Requiere
  brainstorm del flujo legal/UX.
- **Esfuerzo:** medio-alto. **Valor: medio** (nicho: gyms con menores).

### 7. Galería de fotos en días festivos 🔴 falta (owner: la app recepciona)
**Qué pidió:** la Sra. María quiere que los socios suban fotos en días festivos
(ej. día del padre, foto con sus papás).
- **Ya tenemos:** nada.
- **Decisión del owner:** la **app** recibe las fotos del día / festivas.
- **Falta:** una galería social simple: el socio sube una foto (ligada a un
  evento/fecha), el gym la modera, se muestra en la app. Tabla `foto_social` +
  storage + UI.
- **Dónde vive:** app socio (sube y ve) · panel (modera). 
- **Esfuerzo:** medio. **Valor: bajo-medio** (comunidad/engagement, no core).

### 8. (implícito) Prevención de morosos en el molinete
La idea 1 menciona que "el molinete no deja entrar a los que tienen deuda". Eso
**ya está cubierto** por la validación de membresía en el check-in
(`checkin_manual` deniega `membresia_vencida`). Cuando el molinete físico se
integre (Fase 2, endpoint hardware), heredará esa validación. No requiere
trabajo nuevo salvo el hardware.

---

## Orden recomendado (por valor comercial para cerrar Image Gym)

| # | Idea | Esfuerzo | Valor | Ubicación |
|---|------|----------|-------|-----------|
| 1 | **Alertas vencimiento/deuda** (1-2d + push + lista deudores) | medio | 🔥 alto | panel + app |
| 4 | **Suplementos con beneficio** (remate de la tienda) | bajo | medio | app + panel |
| 5 | **Buzón de sugerencias** (en la web + correo) | bajo | medio | web + panel |
| 2 | **Foto del socio** (sube + estándares) | medio | alto | app + panel |
| 7 | **Galería festiva** (fotos del día) | medio | bajo-medio | app + panel |
| 6 | **Autorización de menores** (necesita brainstorm) | medio-alto | medio | app apoderado |
| 3 | **Croquis del gym** (el más nuevo/visual) | alto | medio | app + panel |

**Sugerencia de arranque:** 1 + 4 + 5 primero (alto valor / bajo-medio esfuerzo,
cierran percepción de producto completo), luego 2 (foto, habilita facial), y
dejar 3/6/7 para una segunda ola (cada una amerita su propio diseño).

Creado: 2026-07-10.
