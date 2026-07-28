# Notificaciones push por rol — FitCore

> Mapa de qué notificación push le llega a cada rol, verificado contra el código
> (`supabase/migrations/*.sql` + `api/**`). Última revisión: 2026-07-28.

## Arquitectura (cómo funciona)

- `encolar_push(usuario_id, titulo, cuerpo, data)` inserta en `public.push_cola`.
- Un worker (`api/push/enviar.js`) drena la cola y envía por FCM.
- Un pg_cron (`fitcontrol-push-worker`, `* * * * *`) llama al worker cada minuto.
- La tabla `public.notificacion` es la **campanita del panel web** (NO es push al
  móvil). Se anota abajo cuando es la única vía de aviso para un rol.
- El "socio" recibe el push en la app móvil vía `socio.usuario_id`.

Roles internos (`rol.codigo`): `admin`, `recepcion`, `entrenador`, `nutricionista`,
`comunicador` (vendedor/CRM). El **socio** no es un rol de staff: es el cliente.

---

## 📱 SOCIO (app del cliente)

Todo lo suyo es sobre su plan, su membresía y su gimnasio.

| Notificación | Cuándo lo dispara |
|---|---|
| 💪 **Nueva rutina** / 🥗 **Nueva dieta** | Trigger `trg_push_envio` al setear `enviado_at` en `rutina`/`dieta` |
| **Tu entrenador te preparó un plan 💪** | `enviar_plan_socio(socio_id)` al enviar/asignar rutina o dieta |
| **Completa tu perfil para tu plan 📝** | `pedir_datos_para_plan(socio_id)` — el trainer le pide objetivo/peso/talla |
| 💪 **¡Aprobado! Sube la carga** / 🧘 **Aún no — sigue así** | El trainer aprueba/rechaza una solicitud de subir carga |
| 💪 **{trainer} va en camino / ya va hacia ti** | `tomar_ayuda(ayuda_id)` — un trainer reclamó su pedido de ayuda |
| ⏰ **Tu membresía vence HOY / mañana / en 2-3 días** | Cron diario de vencimientos (horario diurno) |
| 💳 **Recordatorio de pago** | `alertar_socio(socio_id)` — lo dispara admin/recepción manual |
| 🎂 **¡Feliz cumpleaños!** | Cron de cumpleaños |
| 🏷️ **¡Producto en oferta!** | Cron `avisar_ofertas_app` — productos con descuento visibles en la app |

---

## 🏋️ TRAINER (entrenador) — y el NUTRICIONISTA recibe lo mismo

Lo operativo de atender socios. Destinatario: staff con rol `entrenador`/`nutricionista`,
o el `asignado_a` de la solicitud según el reparto.

| Notificación | Cuándo | Destinatario |
|---|---|---|
| 💪 **Nuevo socio: {nombre}** | Se registra un socio nuevo (la importación masiva NO dispara) | Todos los trainers/nutris disponibles |
| **Nuevo objetivo de un socio 🎯** | El socio define su objetivo en la app | Trainers/nutris del gym |
| 🏋️ **{nombre} quiere subir de carga** | El socio pide subir peso | **Solo al asignado** (reparto automático); los demás lo ven en bandeja sin sonar |
| 🏋️ **Solicitud de carga reasignada a ti** | Un trainer marca salida → sus pendientes pasan al siguiente | Al nuevo trainer |
| 🆘 **{nombre} pide ayuda** | El socio pide ayuda en el gym | A los trainers presentes; first-claim (el primero que la toma se la queda) |
| ❌ **Ayuda cancelada** | El socio cancela y ya había alguien en camino | Al trainer que la tomó (`atendida_por`) |
| **Rutina por vencer** | Rutina activa que vence en ≤3 días | Al **`entrenador_id`** de la rutina; si es null, cae al admin |

---

## 👑 ADMIN (dueño/gerente)

Negocio y respaldo cuando nadie más atiende. A veces junto con `recepcion`.

| Notificación | Cuándo | Detalle |
|---|---|---|
| ⏰ **Lead sin seguimiento** | Prospecto +24h sin atender | Va al **vendedor asignado**; solo cae al admin si el lead está sin asignar. Solo horario laboral (8:00–19:59 zona del gym) |
| 🆘 **{nombre} pide ayuda** | Ningún trainer pudo recibirla | Respaldo → admin **+ recepción** |
| 🔧 **Mantenimiento hoy/mañana** | Cron `avisar_mantenimientos_proximos` | Solo admin |
| 🏟️ **{sede} al {%} de aforo** | La sede cruza 80% / 100% (cada 15 min) | Solo admin |
| 🎂 **Cumpleaños de hoy** (resumen) | Cron `push_cumpleanos` | Admin **+ recepción** |
| **Rutina por vencer** | Respaldo si la rutina no tiene entrenador | Admin como fallback del trainer |

### Solo campanita del panel (tabla `notificacion`, NO push al móvil)

| Título | Origen |
|---|---|
| 💪 **Nuevo socio: {nombre}** ("Créale su rutina…") | Trigger de nuevo socio |
| 🏋️ **{nombre} quiere subir de carga** | Trigger de solicitud de carga |
| 🆘 **{nombre} pide ayuda y no hay trainer presente** | Trigger de ayuda, rama sin trainer |
| ⚠️ **Pago recibido de un cobro cancelado** | Webhooks de MercadoPago/Yape |

---

## 🎯 VENDEDOR / COMUNICADOR (rol `comunicador`)

Todo el CRM de prospectos. NO le llega al trainer ni (normalmente) al admin.

| Notificación | Cuándo | Destinatario |
|---|---|---|
| **Nuevo prospecto 🎯** | Entra un lead nuevo | Al comunicador con menos leads (`asignado_a`) |
| **Prospecto reasignado a ti 🔁** | Cron rota un lead sin contactar | Al comunicador que lo recibe |
| **Prospecto rotado a otro asesor** | Mismo cron de rotación | Al comunicador saliente |
| ⏰ **Lead sin seguimiento** | Prospecto +24h sin atender | Al asignado; admin solo si está sin asignar |

---

## Puntos de ambigüedad (quién manda)

- **Lead sin seguimiento / Nuevo prospecto / rotaciones** → normalmente al **comunicador**
  asignado; el **admin** solo recibe "Lead sin seguimiento" cuando el lead está sin asignar.
- **{nombre} pide ayuda** → primero a **trainers** presentes; si ninguno recibe (nadie
  con token/presente), respaldo a **admin + recepción**.
- **Rutina por vencer** → al **entrenador de la rutina**; si es null, al **admin**.
- **Nueva dieta** la genera el flujo del **nutricionista**, pero el push va al **socio**;
  el nutricionista recibe los mismos avisos de staff que el entrenador.

---

## Notificaciones nocturnas — arreglado

Dos avisos llegaban de madrugada; ya corregidos en
`supabase/migrations/20260728110000_notificaciones_horario_diurno.sql` (aplicada):

1. **Lead sin seguimiento** — corría cada hora a cualquier hora. Ahora solo encola
   entre 8:00 y 19:59 (zona horaria del gym). El job sigue corriendo cada hora;
   un lead detectado de madrugada se avisa en la primera corrida de la mañana
   (idempotente por día vía `sla_lead_avisado`).
2. **Rutina por vencer** — se llamaba desde el cron de facturación de Vercel
   (4am UTC = 11pm Perú). Se movió al pg_cron diurno `fitcontrol-rutinas-por-vencer`
   (10:05am Perú) y se quitó de `api/facturacion/index.js`.

---

## Resumen en una línea por rol

- **Socio** → su plan, su membresía, su cumpleaños, ofertas. Todo personal.
- **Trainer** → socios nuevos, objetivos, pedidos de carga/ayuda, rutinas por vencer. Operativo.
- **Admin** → leads sin atender (respaldo), aforo, mantenimiento, cumpleaños del día,
  y ayudas que ningún trainer tomó. Negocio/respaldo.
- **Vendedor (comunicador)** → todo el CRM de prospectos.
