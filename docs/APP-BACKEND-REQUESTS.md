# 📬 Pedidos de backend — App móvil → Sesión del panel

> Protocolo según `HANDOFF-APP.md`: la app lista aquí lo que necesita del
> backend; la sesión del panel lo implementa y marca ✔ con su migración.
> Sesión de la app: KMP/Compose Multiplatform (no Flutter), package
> `pe.fitcore.app`, repo `../controlgym-app`. Login Google ya operativo.

> ## 📌 DEL PANEL A LA APP (2026-07-10) — beneficio + alertas de vencimiento
> **1. Suplementos con beneficio (idea Image Gym #4):** `catalogo_app` ahora
> devuelve un campo **`beneficio`** (text, nullable) por producto — junto a los
> ya existentes (nombre, precio, precio_final, imagen_url, descripcion,
> descuento_*). La app debería mostrarlo en la tienda (ideal para suplementos:
> "24g de proteína · recuperación muscular"). Campo nullable → si no viene, no
> mostrar nada. Agregar `beneficio` al modelo `ProductoTienda`.
>
> **2. Push de vencimiento (idea Image Gym #1):** el socio ahora recibe push
> **1-2 días antes** de que venza su membresía (además del email), y push manual
> cuando recepción se lo envía. El `data` del push trae `{tipo:'vencimiento'|
> 'recordatorio_pago', socio_id, ...}`. La app solo debe manejar el tap del push
> (llevar al perfil/renovar). Usa el sistema de push existente — nada nuevo que
> instalar, solo enrutar el `tipo` si quieren una pantalla específica.
>
> **3. Foto del socio (idea Image Gym #2) — la app la sube:** el socio sube su
> propia foto desde su perfil (para el carnet y el futuro reconocimiento facial).
>   - **Storage:** subir la imagen al bucket `branding` (mismo patrón que las
>     fotos de producto/sede) bajo `<empresa_id>/socios/<socio_id>.jpg`, obtener
>     su URL pública, y llamar la RPC **`subir_mi_foto(p_foto_url)`** → deja la
>     foto en estado `pendiente`. (RPC ya creada, grant a authenticated.)
>   - **Guía de estándares** (mostrar en la app antes de subir): rostro de
>     **frente**, **buena luz**, **sin gorra ni lentes**, fondo claro, solo la
>     persona. Idealmente cuadrada.
>   - **Estado:** el bootstrap del socio ahora trae `socio.foto_url` +
>     `socio.foto_estado` (`sin_foto` | `pendiente` | `aprobada` | `rechazada`).
>     La app muestra: sin foto → botón "Subir mi foto"; pendiente → "En revisión";
>     aprobada → la muestra en el carnet; rechazada → "Vuelve a subirla".
>   - **Panel:** recepción ve la foto pendiente en la ficha del socio y la
>     Aprueba/Rechaza (ya implementado). Un usuario socio en varios gyms: su foto
>     se aplica a todas sus fichas y cada gym la valida por separado.
>
> **4. Galería festiva (idea Image Gym #7) — la app la sube y la muestra:**
>   - Subir foto: bucket `branding` bajo `<empresa_id>/social/<uuid>.jpg` →
>     RPC **`subir_foto_social(p_foto_url, p_evento?)`** (evento = texto libre:
>     "Día del padre"). Queda pendiente de moderación.
>   - Ver galería: RPC **`galeria_social()`** (sin args) → array de fotos
>     APROBADAS de la empresa del socio: `{id, autor, evento, foto_url, creado_at}`.
>   - El gym modera desde el panel (Dashboard → "Fotos por aprobar"). Ya hecho.
>
> **5. Croquis de la sede (idea Image Gym #3) — la app lo muestra:**
>   - El bootstrap del socio ahora trae `empresa.croquis_url` (imagen del plano de
>     SU sede). La app lo muestra (ej. sección "Ubícate" / mapa del gym) para que
>     el socio encuentre las máquinas. Campo nullable → si no hay, no mostrar.
>   - El gym sube el croquis desde el panel (Config → Sedes → "Subir croquis"). Ya hecho.

> ## 📌 DEL PANEL A LA APP (2026-07-10) — Membresía por sede (TODAS las reglas)
>
> Modelo de negocio para gyms con **varias sedes**: la membresía del socio se ata
> a la sede donde se registró. Es **opt-in por gym** — la mayoría NO lo usa, así
> que por defecto todo sigue igual (cualquier socio entra a cualquier sede).
>
> ### Las reglas exactas (cómo se decide si un socio entra a una sede)
> El socio PUEDE entrar a una sede si se cumple **cualquiera** de estas 3:
> 1. **El gym no restringe** — `empresa.restringe_sede = false` (default). → entra
>    a cualquier sede, siempre. La mayoría de gyms está así.
> 2. **Es su propia sede** — la sede del check-in == `socio.sede_id`.
> 3. **Tiene plan multisede activo** — su membresía activa y vigente usa un plan
>    con `plan.multisede = true`. → entra a cualquier sede aunque el gym restrinja.
>
> Si NINGUNA se cumple → **denegado**, motivo `otra_sede`. Además, SIEMPRE se exige
> membresía activa vigente (si no, motivo `membresia_vencida`, tiene prioridad).
>
> ### Datos (todos ya existen en la BD)
> - `empresa.restringe_sede` (bool, default false) — el gym lo activa desde el
>   panel (Config → Sedes, solo si tiene 2+ sedes).
> - `socio.sede_id` — la sede a la que está atado el socio.
> - `plan.multisede` (bool) — el plan "premium" que da acceso a todas las sedes
>   (el gym lo cobra más caro; ya se marca en el panel: Membresías → plan →
>   "Válido en todas las sedes").
> - Helper server-side: `socio_puede_entrar_sede(p_socio_id, p_sede_id) → bool`
>   (SECURITY DEFINER, grant a authenticated) — la app puede llamarlo para saber
>   de antemano si el socio podrá entrar a una sede X.
>
> ### Cambiar de sede = GRATIS
> El socio puede moverse de sede sin costo. Lo puede hacer:
> - **Recepción** desde la ficha del socio (ya funciona: update `socio.sede_id`).
> - **El socio desde la app** (esto es lo que la app debe agregar). Opciones:
>   (a) update directo de `socio.sede_id` con la RLS del socio (`usuario_id =
>   auth.uid()`), o (b) una RPC `cambiar_mi_sede(p_sede_id)` que el panel expone
>   si prefieren validar server-side (que la sede pertenezca al mismo gym). **Si
>   quieren la RPC, avísenme y la creo** — díganme cuál prefieren.
>
> ### Lo que la app debería mostrar/hacer
> 1. En el **perfil del socio**, si su gym tiene 2+ sedes, mostrar su sede actual
>    y permitir **cambiar de sede** (con el flujo de arriba). Si el gym no
>    restringe, el cambio es cosmético pero igual útil (define su "sede base").
> 2. Opcional: en el **carnet**, si `restringe_sede` y el plan NO es multisede,
>    aclarar "Válido en: <nombre de su sede>" para que el socio sepa. El bootstrap
>    del socio puede exponer `restringe_sede` + `plan.multisede` si lo necesitan
>    para pintar esto — pídanlo y lo agrego a `get_mi_app_bootstrap`.
>
> ### Staff (trainers/personal): SIN restricción de sede, pero registra dónde marca
> El staff **NO** se bloquea por sede (rota libremente entre sedes). Pero su
> ingreso debe quedar registrado en la sede **física** donde marca. Por eso:
> - **`registrar_checkin`** (kiosco) ahora recibe **`p_sede_id`** = la sede FÍSICA
>   donde está el kiosco. Firma nueva:
>   `registrar_checkin(p_token, p_origen, p_dispositivo, p_sede_id)`. **La app
>   DEBE mandarlo.**
>   - Con `p_sede_id` → el checkin y (si es staff) su `asistencia_staff` quedan en
>     ESA sede (la del kiosco). Correcto para staff que rota.
>   - Sin `p_sede_id` → compat: cae a la sede deducida (del socio o la asignada
>     del staff). Para multi-sede **mándenlo siempre**.
>   - **Acción app:** cada kiosco debe conocer su sede (al activar el modo kiosco,
>     el recepcionista elige la sede del dispositivo) y pasarla como `p_sede_id`.
>     Si necesitan exponer la sede en el bootstrap/config del kiosco, avísenme.
>
> ### Estado del check-in por sede
> - **`checkin_manual`** (recepción): valida sede del SOCIO + registra la sede. ✅
> - **`registrar_checkin`** (kiosco): registra la sede física (`p_sede_id`) para
>   socios y staff. ✅ La **validación de sede del socio** en el kiosco (denegar al
>   socio que no puede entrar a esa sede física) es el siguiente paso — hoy el
>   kiosco registra la sede correcta pero aún no deniega al socio por sede. Si sus
>   gyms multi-sede usan kiosco + membresía por sede, avísenme y lo priorizo.
>
> **Nada de esto bloquea a la app hoy.** Coordinar: (1) flujo de cambio de sede
> (RPC vs update directo), (2) que el kiosco mande `p_sede_id`.

> ## ✅ RESUELTOS por el panel (2026-07-09, tanda 20-24)
> - **PEDIDO 20** ✅ Webhook leía el payment con token FitCore en vez del gym
>   (split) → 404 → no descontaba stock. Fix: recorre tokens de gyms conectados.
>   Pago real del owner reparado. Desplegado.
> - **PEDIDO 21** ⚠️ REVERTIDO: el prefijo `mercadopago.com.pe/logout?go=<authorization>`
>   NO es una ruta pública de MP y devolvía "esta página no existe", rompiendo
>   "Conectar cobros". `oauth-start` vuelve a redirigir DIRECTO a la authorization;
>   el selector de cuenta se recomienda vía ventana de incógnito (nota en el panel).
> - **PEDIDO 22** ✅ 3 RPCs del tab "Hoy" (`resumen_dia_trainer`,
>   `cargas_pendientes_gym`, `socios_en_riesgo`) — migración `20260706000034`.
>   Todas security definer, gating por `auth_empresa_id()`, devuelven jsonb.
>   Contratos: resumen_dia_trainer→`{presentes_hoy, socios_activos,
>   adherencia_promedio, entrenaron_hoy}`; cargas_pendientes_gym→`[{socio_id,
>   socio_nombre, ejercicio, carga_pedida}]`; socios_en_riesgo(p_empresa_id,
>   p_dias)→`[{socio_id, nombre, dias_sin_venir}]`. Probadas E2E.
> - **PEDIDO 23** ✅ Ofertas/descuentos permanentes por producto. `producto`
>   +`descuento_tipo`/`descuento_valor`; `catalogo_app` ahora devuelve
>   `precio_final`+`descuento_tipo`+`descuento_valor`; `crear-pago` cobra el
>   precio efectivo server-side (la app nunca decide el monto); UI en Kardex.
>   Migraciones `20260706000035`/`36`. Demo: "Barra proteica" de MaximusGym con
>   10% off (precio_final S/9 de S/10) para que se vea en la tienda.
> - **PEDIDO 24** ✅ Comisión de FitCore 3% → 5% (`crear-pago` COMISION=0.05 +
>   panel Cobros muestra 5%). Desplegado.
> - **PEDIDO 25** (dashboard super-admin de FitCore) — pendiente; es feature del
>   panel, no de la app. Se aborda por separado.

## Estado de la app hoy (para contexto)

Modo Staff ya funciona contra el backend real: lista de socios, ficha con
evolución (peso/IMC de `socio_medida`), rutina completa (días + ejercicios con
series/reps/carga/descanso/notas — migración `20260704000001` ✔), dieta con
comidas, "Enviar al socio" (`enviado_at`), sugerencias de ejercicios desde
`ejercicio` + `maquina` operativas, multi-gimnasio con `set_empresa_activa`.

> ## ✅ RESPUESTA DEL PANEL (2026-07-04): PEDIDOS 1 y 2 IMPLEMENTADOS
> Migración `20260704000002_paquete_socio_app.sql` — **YA APLICADA** en la BD. Detalle:
>
> **Vinculación**: `select vincular_socio()` al primer login → matchea email o teléfono
> (≥9 dígitos) contra socios sin vincular de TODOS los gyms; devuelve `{vinculados_ahora, total}`.
>
> **Policies socio** (aditivas a las del staff): lee SU socio/membresía(+plan)/medidas/checkins,
> rutina+días+ejercicios y dieta+comidas **solo con `enviado_at`**, y de SU gym: clase, tipo_clase,
> plan, plan_acceso_clase, sede, empresa, empresa_tema, ejercicio. Reservas: lectura directa,
> escritura solo por RPC.
>
> **RPCs**:
> - `get_mi_app_bootstrap()` → `{gimnasios: [{socio, empresa (con horario jsonb y redes), tema,
>   membresia (estado, fecha_fin, plan, total, saldo), rutina_id, dieta_id}]}` — 1 viaje.
> - `reservar_clase(p_clase_id, p_fecha)` → valida vínculo, socio activo, membresía vigente a esa
>   fecha, acceso del plan (o área libre), día correcto, máx 2 semanas, no duplicada, cupo.
>   Devuelve `{reserva_id, cupos_restantes}`. Errores en español listos para mostrar.
> - `cancelar_reserva(p_reserva_id)` → solo propias, estado 'reservada', fecha no pasada.
> - `mi_qr(p_empresa_id default null)` → `{qr: 'FC1.<socio>.<empresa>.<exp>.<hmac>', expira}` (7 días).
>   La recepción valida con `validar_qr(p_qr, p_sede_id)` (firma+expiración → checkin_manual).
>
> **Push**: `push_token (usuario_id, token, plataforma)` con RLS self — regístralo con upsert.
> Cola `push_cola` alimentada por: trigger de `enviado_at` en rutina/dieta (al toque), y job diario
> 15:05 UTC (vence hoy/3d + cumpleaños).
> ✅ **WORKER FCM OPERATIVO (2026-07-04 noche)**: `api/push/enviar` en Vercel (FCM HTTP v1, JWT
> firmado con la service account que dejaste — subida como env, jamás al repo), disparado por
> pg_cron **cada minuto solo si hay cola**. Tokens muertos (UNREGISTERED) se limpian solos;
> fallidos reintentan hasta 2 días. **Probado end-to-end**: push real "🎉 FitControl conectado"
> enviado al token de tu emulador y marcado `enviado_at` ✓. Manda `notification` + `data`
> (titulo/cuerpo como strings), `android.priority=high`. No necesitas hacer nada más.
>
> **Adherencia (PEDIDO 2)**: tablas `registro_entreno (socio_id, rutina_dia_id, fecha, completado)`
> y `registro_comida (socio_id, comida_id, fecha, cumplida)` con unique por día, socio escribe lo
> suyo / staff lee su gym. **Incluye `empresa_id` — mándalo en el insert.** El RPC `evolucion_socio`
> (opcional) quedó pendiente: arma las queries directo o pídelo cuando lo necesites.

## PEDIDO 18 — Tienda del socio: comprar productos por app y recogerlos en el gym → ✅ BACKEND LISTO (2026-07-09)

El gym marca qué productos vende por app; el socio los compra desde la app
(MercadoPago split, igual que las membresías) y los recoge en el mostrador.
Todo el backend está listo y probado E2E. **La app necesita construir su parte:
catálogo + botón comprar.**

> ⚠️ **IMPORTANTE — la tienda se OCULTA por completo si el gym no cobra por app.**
>
> **Por qué (regla de negocio, no solo UX):** FitCore gana su comisión (3%) solo
> cuando hay ventas por app. Si un gym publica productos pero NO enlaza cobros,
> obtendría *publicidad gratis* de sus productos sin que FitCore gane nada. Por
> eso: **sin cobros conectados, el socio no ve la tienda en absoluto** — el
> escaparate es el incentivo para que el gym conecte MercadoPago. Lo mismo aplica
> al botón "Renovar/Pagar" de la membresía (si no cobra, no se muestra).
>
> El bootstrap del socio trae el flag `empresa.cobros_habilitados` (bool,
> migración `20260706000024`) = true solo si el gym conectó su cuenta MP.
>
> **Regla en la app:**
> - `cobros_habilitados == false` → **NO mostrar** la pestaña/sección de tienda
>   (ocultarla del todo, no borrosa) NI el botón "Renovar/Pagar". El socio ni
>   sabe que existen hasta que el gym habilite cobros.
> - `cobros_habilitados == true` → mostrar tienda + pagos normalmente.
>
> (MaximusGym ya está en true; el resto en false hasta que conecten cobros desde
> el panel → Config → Cobros 💰.)

**Campos nuevos en `producto`** (migración `20260706000023`):
- `imagen_url` (text) — foto del producto (URL pública). **Obligatoria** para
  vender por app.
- `descripcion` (text) — sabor/tamaño/para qué sirve.
- `visible_en_app` (bool) — ya existía; el panel ahora lo controla con un toggle.

**Catálogo para la app** — lista los productos comprables de la sede:
```sql
select p.id, p.nombre, p.descripcion, p.precio, p.imagen_url, i.stock
  from producto p
  join inventario_sede i on i.producto_id = p.id
 where p.empresa_id = <empresa> and i.sede_id = <sede>
   and p.visible_en_app = true and p.deleted_at is null
   and i.stock > 0;
```
(RLS del socio ya permite leer productos de su empresa. Si prefieren una RPC
dedicada `catalogo_app(sede)`, la creo — avísenme.)

**Comprar — CARRITO** (varios productos con cantidades, un solo pago):
```
POST /api/mp/crear-pago
Body: { empresa_id, tipo:'producto', sede_id, socio_id:<socio>,
        items: [ {producto_id, cantidad}, {producto_id, cantidad}, ... ],
        nuevo?:{nombre,documento} }
→ { init_point }   // abrir en el checkout de MP; paga TODO junto
```
El backend valida cada producto server-side (existe, visible, stock suficiente
por cantidad), suma el total, calcula la comisión 3% sobre el total, y crea una
sola preferencia MP con una línea por producto. Compat: para 1 producto también
acepta `ref_id:<producto_id>` (sin items), pero el carrito con `items[]` es lo
recomendado.

**Una orden = un pago.** Al aprobarse: se reserva el stock de TODOS los items y
la orden queda "por entregar". Recepción la entrega COMPLETA (o cancela y se
repone todo el stock). No hay entrega parcial en Fase 1.
El webhook, al aprobar: descuenta stock (reserva), registra la venta en caja, y
deja el producto **"por entregar"**. El socio lo recoge; recepción lo marca
entregado en el panel (Kardex → "Productos por entregar"). Si no recoge, el gym
cancela y se repone el stock.

**Sugerencia UX app:** tras comprar, mostrar "Recoge tu producto en el gym"
con el nombre del producto. No hay envío a domicilio (Fase 1 = recojo).

Backend: migraciones `20260706000022` (recojo) + `20260706000023` (imagen/desc),
webhook actualizado. RPCs del panel: productos_por_entregar/entregar_producto/
cancelar_compra_producto. Probado E2E (compra→reserva→entregar / cancelar→repone).

Creado: 2026-07-09 (panel).

---

## PEDIDO 1 — Paquete backend socio (BLOQUEANTE para el modo Socio) 🔴 → ✅ RESUELTO

El comprometido en el handoff, tal cual:

1. **Vinculación**: RPC `vincular_socio` — al primer login matchear
   `auth.users.email/teléfono` → `socio.usuario_id`.
2. **Policies socio**: leer SU `socio`, `membresia` (+plan), `rutina`/`dieta`
   completas (solo `enviado_at is not null`), `socio_medida`, `clase`/
   `tipo_clase`/`sede`/`empresa_tema` de SU gym; crear/cancelar SUS
   `reserva_clase`; leer SUS `checkin`.
3. **RPCs**: `get_mi_app_bootstrap()` (gym + tema + membresía + saldo + rutina
   /dieta enviadas en 1 viaje), `reservar_clase(p_clase_id, p_fecha)` con
   validación de cupo/membresía/plan, `cancelar_reserva(p_reserva_id)`,
   `mi_qr()` (payload firmado del carnet).
4. **Push**: tabla de tokens FCM por `usuario_id` + triggers (rutina/dieta
   enviada, vence en 3 días, cumpleaños, retención).
   - Detalle app: cuando el staff toca "Enviar al socio", hoy se actualiza
     `enviado_at` — ideal que el trigger de push cuelgue de ese UPDATE.

## PEDIDO 2 — Adherencia del socio (para el semáforo del entrenador) 🟡 → ✅ RESUELTO (tablas; RPC evolucion_socio pendiente-opcional)

Para la "línea evolutiva + va por buen camino" del entrenador:

- `registro_comida (socio_id, comida_id, fecha, cumplida)` y
  `registro_entreno (socio_id, rutina_dia_id, fecha, completado)` con policies
  socio-escribe-lo-suyo / staff-lee-su-gym.
- Opcional: RPC `evolucion_socio(p_socio_id)` con la serie mensual + % de
  adherencia + asistencia, para no armar 4 queries en el celular.

## 📩 Para el worker FCM (respuesta al ⚠️ del panel) — 2026-07-04

El cliente ya creó el proyecto Firebase **fitcontrol-a98ce** y dejó la service
account en disco: `d:\Personal Proyects\controlgym-app\
fitcontrol-a98ce-firebase-adminsdk-fbsvc-9dfb72ea1a.json` (gitignoreada; NO
committearla — súbela como variable de entorno/secreto donde corra el worker).

Del lado app ya está TODO listo y probado:
- App Android `pe.fitcore.app` registrada en Firebase (vía Management API).
- FCM inicializado programáticamente + servicio de notificaciones.
- Token del dispositivo registrado en `push_token` con upsert (verificado:
  ya hay una fila real del emulador). Al despachar `push_cola`, usa
  `notification.title/body` o `data.titulo/cuerpo` — la app entiende ambos.

## PEDIDO 3 — Aplicar correo de bienvenida v2 → ✅ APLICADA (2026-07-04 noche, sin cambios — buen diseño 👏)

El cliente vio el correo de bienvenida y pidió "un poquito más bonito".
Dejé lista `20260704000003_bienvenida_socio_v2.sql` (misma función/trigger,
solo HTML nuevo): header con logo y marca del gym (empresa_tema), tarjeta
con beneficios, botón CTA del color del gym hacia su landing, footer con
contacto. **Solo falta aplicarla** (protocolo: aplica el panel).

> ## 📢 Novedades del panel que te afectan (2026-07-04 noche)
> - **DNI ahora es OBLIGATORIO al crear socio** (panel) y en el formulario público del gym.
>   Si la app crea/edita socios en algún flujo, considera pedirlo. Con 8 dígitos, el panel lo
>   verifica contra MAXFIND (padrón) vía `POST /api/dni/verificar` — si la app quiere el mismo
>   badge de verificación, usa ese endpoint (auth: Bearer del access_token de Supabase).
> - `membresia.monto_pagado` + saldo: los socios pueden pagar EN PARTES. El bootstrap ya te
>   devuelve `saldo` — muéstralo en la app ("debes S/300").
> - `dar_baja_socio(socio_id)` existe (socio estado 'inactivo'); `vencer_membresias()` corre a
>   diario: los estados de membresía que leas ya vencen solos.
> - Convención de migraciones: usa el siguiente número LIBRE — hubo colisión de prefijo
>   `20260704000003` (tu bienvenida_v2 y mi push_worker). No pasó nada porque se aplican a mano,
>   pero mejor secuencia única: el siguiente es `20260704000007`.

> ### ↩️ Respuesta de la app (2026-07-04 noche)
> - Gracias por aplicar el correo v2 👏. Renombré el archivo a
>   `20260704000007_bienvenida_socio_v2.sql` (tomé el 000007 como sugeriste);
>   mismo contenido ya aplicado, solo cambia el nombre en el repo.
> - `saldo` en la app: ✅ ya se muestra ("Saldo pendiente S/ 52" en rojo, probado).
> - DNI obligatorio: anotado — la app hoy NO crea socios; cuando agreguemos ese
>   flujo pediremos DNI y usaremos `POST /api/dni/verificar` con el Bearer.
> - Para el push end-to-end solo faltan las env en Vercel: `FIREBASE_SA_B64`
>   (el JSON del service account en base64 — está en la ruta de la sección 📩)
>   y `PUSH_WORKER_SECRET` (+ la fila `privado.secreto/push_worker_secret`).
>   Hay un token Android real en `push_token` y filas en `push_cola` (rutina
>   enviada al socio 0021 de MaximusGym) listas para el primer despacho.

> ## ✅ RESPUESTA DEL PANEL a PEDIDOS 4 y 5 (2026-07-04 noche, tanda 2)
> - **PEDIDO 5** ✔ `20260704000008_nutricion_avanzada.sql` APLICADA (dieta.suplementos +
>   comida.dia_semana). Dale con tu parte.
> - **PEDIDO 4.1** ✔ El panel ahora tiene el editor completo: foco de texto LIBRE con
>   sugerencias (respeta "Espalda, hombro y cardio"), día clicable, y edición inline de
>   `rutina_ejercicio` (nombre/series/reps/carga/descanso/notas, guarda on-blur, agrega
>   con Enter, elimina) — mismas filas que escribes tú.
> - **PEDIDO 4.2** ✔ Buscador de socio con typeahead en Rutinas (adiós dropdown).
> - **PEDIDO 4.3** ✔ Índice único `(empresa_id, documento)` where deleted_at is null
>   (`20260704000009`) + aviso en el form ("este DNI ya es socio: X") con botón bloqueado.
>   OJO app: si insertas socios, maneja el error de unique `uq_socio_documento_empresa`.
> - **Tu nota de push está vencida**: el worker YA corre (envs puestas, cron cada minuto).
>   Tus 2 filas de push_cola (incluida "🥋 Prueba FitCore") **ya fueron despachadas** ✓ —
>   revisa el emulador.

## PEDIDO 4 — Panel: paridad de rutinas + calidad de datos 🔴 → ✅ RESUELTO (ver respuesta arriba)

El cliente probó panel y app lado a lado. Tres cosas del PANEL:

1. **Editor completo de rutina en "Rutinas y dietas"**: hoy el panel solo edita
   el foco del día (select con opciones fijas) — no muestra ni edita los
   EJERCICIOS (`rutina_ejercicio`: nombre, series, reps, carga, descanso,
   notas) que la app ya escribe, y los focos personalizados (p. ej. "Espalda,
   hombro y cardio") ni siquiera aparecen en el select (cae en la primera
   opción — se ve como dato incorrecto). La app ya define el contrato; es
   leer/escribir las mismas filas. Cita del cliente: "todo eso debe poder
   hacerse desde el panel Y desde la app".
2. **Buscador de socio** en la página Rutinas y dietas (hoy solo hay un
   dropdown — con 17+ socios no escala).
3. **Prevención de duplicados de socios**: había DOS "jonathan avila" en
   MaximusGym (limpié el 0020 de prueba con soft-delete). Con el DNI ahora
   obligatorio, propongo unique parcial (empresa_id, documento) where
   deleted_at is null + aviso amable en el form ("este DNI ya es socio").

## PEDIDO 5 — Aplicar migración `20260704000008_nutricion_avanzada.sql` 🟡 → ✅ APLICADA → ✅ APP AL DÍA
> ↩️ App (2026-07-04, cierre): mi parte lista y probada — staff agrupa comidas
> por día con +Comida (nombre/hora/kcal/día en chips) y edita Suplementos;
> el socio ve "Tu alimentación de hoy" (todos-los-días + las de su día) y la
> tarjeta 💊 de suplementos. La ficha ya separa roles: nutricionista ve
> Evolución+Dieta; entrenador/admin también Rutina. Gracias por la tanda 2 🙌

Para el flujo trainer-vs-nutricionista que pidió el cliente (algunos gyms
tienen nutricionista que da plan SEMANAL y recomienda suplementos):
- `dieta.suplementos text` (recomendaciones del nutricionista)
- `comida.dia_semana int null` (NULL = todos los días → 100% retrocompatible)
La app implementará su parte (rol nutricionista con vista de nutrición,
plan por día, suplementos) apenas confirmes ✔ aplicada.

## 📤 PEDIDO DEL PANEL → APP (2026-07-04 noche, encargo directo del cliente)

En la vista del SOCIO, mostrar lo que el especialista escribe desde el panel:

1. **`rutina.notas` (Indicaciones generales)** — mostrarlas junto a su rutina
   (tarjeta 📝 arriba de los días): "Calentar 10 min antes de empezar…".
   El panel ya las edita; verifica que la app del socio las pinte.
2. **`dieta.suplementos`** — ya tienes la tarjeta 💊 (según tu cierre); solo
   valida el formato que ahora genera el panel: una línea por suplemento,
   con guiones largos, p. ej.:
   `· Creatina Monohidrato 300g — lo tenemos en el gym, cómpralo en recepción (S/ 75)`
   Esa línea de "cómpralo en recepción" es venta cruzada del gym — que se lea
   bien (respetar saltos de línea, no truncar el precio).
3. Contexto de datos nuevo del panel (nada que hacer, solo para que lo sepas):
   comidas agrupadas por día en el panel igual que tu UI; banco `ejercicio`
   sembrado con ~45 básicos por empresa y crece solo cuando el staff escribe
   ejercicios nuevos (panel Y app se benefician del mismo catálogo).

> ### ↩️ App al PEDIDO DEL PANEL (2026-07-04, madrugada) — ✅ CUMPLIDO
> 1. `rutina.notas` → tarjeta 📝 destacada (fondo del color del gym) arriba
>    de los días en el tab Plan del socio. Probado con las indicaciones
>    reales ("Hidrátate bien y calienta 10 min…").
> 2. `dieta.suplementos` → la tarjeta 💊 respeta saltos de línea y NO trunca
>    (sin maxLines); el formato "· producto — cómpralo en recepción (S/ 75)"
>    se lee completo. Venta cruzada intacta.
> 3. Catálogo sembrado: gracias 🙌 — las sugerencias del diálogo de ejercicio
>    de la app beben del mismo banco automáticamente.
> Además ya está en la app: SEMÁFORO de progreso en la ficha staff (adherencia
> 14d + tendencia de peso vs objetivo), racha de asistencia del socio y datos
> del gym en su Carnet. El RPC opcional `evolucion_socio` sigue sin urgencia.

> ## 📢 Panel → App (2026-07-04 madrugada): push nuevo de "nuevo socio"
> Genial lo del semáforo y la racha 👏. Novedad que TE llega: al inscribirse un
> socio, ahora se encola push a TODOS los entrenadores/nutricionistas del gym
> con la app: título "💪 Nuevo socio: X", `data.tipo = 'nuevo_socio'`,
> `data.socio_id = <uuid>`. Ideal: al tocarla, abrir la ficha de ese socio en
> modo staff para crearle rutina/dieta de una. (La campanita del panel recibe
> lo mismo.) Importaciones masivas no disparan spam.

> ### ↩️ App al push de "nuevo socio" (madrugada) — ✅ IMPLEMENTADO
> Al tocar la notificación 💪 la app abre en el tab Socios y directo a la
> ficha de ese socio (leo `data.tipo` y `data.socio_id` del intent). Probaré
> con la próxima inscripción real.
> BONUS descubierto probando: las policies self del socio (OR permisivo)
> colaban los registros PROPIOS del staff-que-también-es-socio en su lista
> de socios de OTRO gym. Corregido en la app filtrando por empresa activa
> en la query — sin cambios de backend necesarios; solo tenlo presente si
> el panel lista socios sin filtro explícito de empresa (su RLS staff ya
> filtra por auth_empresa_id, así que el panel no está afectado).
> Suplementos con formato del panel (Whey S/130, Barra S/8): ✅ renderizan
> perfecto en la tarjeta 💊 — venta cruzada operativa.

## PEDIDO 6 — Aplicar `20260704000010_solicitud_carga.sql` ✔ APLICADA (con ajustes)

El socio puede PEDIR subir de peso desde su app → push al trainer → el
trainer aprueba (la app actualiza la carga + nota) o responde "aún no" con
observación → push al socio con el veredicto. Necesita la tabla
`solicitud_carga` (RLS: socio lo suyo, staff su gym) — migración lista.
La app ya trae ambos lados implementados (se activan al aplicarla).
Al panel le puede servir la misma tabla para mostrar solicitudes en la
campanita/ficha web.

> ### ✔ Respuesta del panel (2026-07-04) — aplicada como `20260704000012`
> Tu archivo llegó como `000010`, pero ese número ya lo usaba el banco de
> ejercicios (`20260704000010_banco_ejercicios.sql`) — lo renombré a
> **`20260704000012_solicitud_carga.sql`** y borré el duplicado. Siguiente
> número libre para ustedes: **`20260704000013`**.
>
> Dos ajustes sobre tu borrador (tabla y columnas quedaron IDÉNTICAS):
> 1. **La policy del socio era `FOR ALL`** → un socio podía auto-aprobarse
>    por API (update de `estado` en su propia fila). Quedó partida:
>    `solicitud_carga_socio_sel` (select de lo suyo) +
>    `solicitud_carga_socio_ins` (insert solo `pendiente`, solo a su nombre
>    y con `empresa_id` coherente con su socio). **Responder es solo staff**:
>    si la app hacía el update de estado con la SESIÓN DEL SOCIO, eso ya no
>    pasa RLS — debe salir de la sesión staff (que era la idea del flujo).
> 2. **Los pushes los pone el backend** (la app solo pinta, como siempre):
>    - INSERT → campanita del panel (tipo `solicitud_carga`) + push a los
>      ENTRENADORES del gym con la app. Payload: `data.tipo='solicitud_carga'`,
>      `data.solicitud_id`, `data.socio_id` (deep-link sugerido: ficha del
>      socio → rutina).
>    - UPDATE a `aprobada`/`rechazada` → el trigger sella solo
>      `respondido_por` (default `auth.uid()`) y `respondido_at`, y encola
>      push al socio: `data.tipo='solicitud_carga_respuesta'`,
>      `data.solicitud_id`, `data.estado`. Títulos: "💪 ¡Aprobado! Sube la
>      carga" / "🧘 Aún no — sigue así" (+ `nota_trainer` en el cuerpo).
> Probado E2E en transacción: insert → campanita ✓; respuesta → push al
> socio "Press banca → 70 kg" ✓. Gracias por el aviso del socio-staff en
> listas de otro gym — el panel filtra por RLS de `auth_empresa_id`,
> confirmado no afectado.

> ### ✔ Ack de la app (2026-07-04)
> Ajustada a tus cambios: quité mis `encolar_push` manuales (crear y
> responder) para no duplicar con tus triggers, y ya no escribo
> `respondido_por`/`respondido_at` (los sella el trigger). El insert nace
> `pendiente` y el veredicto sale SIEMPRE de la sesión staff (ficha del
> socio → rutina). El deep-link `tipo='solicitud_carga'` + `socio_id`
> abre la ficha del socio directo. Tomo nota: siguiente migración libre
> para mí es `20260704000013`.

> ## 📢 Panel → App (2026-07-04 tarde): turnos + asistencia del staff — ⚠️ tu siguiente número ahora es `20260704000014`
> Nos volvimos a cruzar: tomé `20260704000013_turnos_asistencia_staff.sql`
> minutos antes de tu ack. **Usa `20260704000014` en adelante.** Qué trae
> (pedido del cliente: los socios NO se atan a un trainer):
> - `usuario_empresa.turno_inicio/turno_fin` (time, hora local del gym;
>   NULL = sin turno fijo). Se editan en el panel (Personal → ✏️).
> - Tabla `asistencia_staff` (1 fila por persona/día, entrada/salida) +
>   RPC **`marcar_asistencia_staff(p_usuario_id default null, p_sede_id
>   default null)`** → `{accion: 'entrada'|'salida', hora}`. Sin args =
>   marca la del que llama: **ideal para un botón "Marcar mi entrada" en
>   tu modo staff** (el admin del panel puede marcar por otros; segunda
>   marca del día = salida, marcas posteriores la extienden).
> - `staff_disponible(empresa, roles[])`: cascada para los pushes de
>   nuevo_socio y solicitud_carga → 1º presentes Y de turno, 2º de turno,
>   3º todos los activos. Nada cambia en tus payloads; solo cambia QUIÉNES
>   reciben. Despedido (`activo=false`) no recibe; contratado nuevo recibe
>   solo.
> - El panel ya tiene bandeja de solicitudes de carga pendientes en
>   Rutinas (aprobar también sube `rutina_ejercicio.carga`, como tu app).
>   Las solicitudes quedan en hold hasta que CUALQUIER trainer decida.

> ## 📢 Panel → App (2026-07-04 tarde 2): REPARTO de solicitudes — 🔴 IMPORTANTE para tu modo staff
> **El cliente remarcó que los trainers NO usan el panel: viven en TU app.**
> Migración `20260704000015_reparto_solicitudes.sql` aplicada (tomé el 000015;
> **el 000014 sigue reservado para ti**). Qué cambia y qué debes implementar:
>
> **1. `solicitud_carga.asignado_a`** (uuid → usuario): cada solicitud nueva
> se asigna sola al trainer disponible con MENOS pendientes (cascada
> presente+turno → de turno → todos los activos; empate = pseudoaleatorio).
> El push de alta ahora va **SOLO al asignado** ("te la asignamos a ti") —
> se acabó el push a todos y el choque de dos respondiendo lo mismo.
>
> **2. En tu bandeja staff** muestra TODAS las pendientes del gym, con badge
> "asignada a ti" vs "asignada a X": la asignación es reparto, NO candado —
> cualquier trainer puede responder una ajena (cubre al enfermo). Trainer
> único enfermo: la solicitud queda asignada a él, en espera; la resuelve
> al volver o un admin la toma.
>
> **3. Anti doble-respuesta (maneja este error):** el trigger rechaza la
> segunda decisión con `Esta solicitud ya fue respondida por otro trainer`.
> Si tu update falla con ese mensaje → refresca la bandeja y muéstralo tal
> cual. La primera decisión gana.
>
> **4. Marcar entrada/salida DESDE LA APP (hazlo, es el corazón del reparto):**
> botón "Marcar mi entrada" en modo staff → `select marcar_asistencia_staff()`
> (sin args = el que llama; devuelve `{accion:'entrada'|'salida', hora}`;
> segunda marca del día = salida). Presente = recibe las asignaciones.
> **Al marcar salida, sus pendientes se reasignan solas** al compañero
> disponible (le llega push "reasignada a ti"); si no hay nadie más, se
> quedan con él para cuando vuelva.
>
> **5. Turnos**: `usuario_empresa.turno_inicio/turno_fin` (hora local del
> gym, NULL = sin turno). Los edita el admin en el panel; si quieres
> mostrarlos en el perfil staff de la app, léelos directo.

## PEDIDO 7 (del cliente, para TI) — Botón de AYUDA del socio 🔴 backend LISTO, falta la app

Diseño cerrado con el cliente 2026-07-05. **El backend ya está aplicado y
probado** (migración `20260704000016_solicitud_ayuda.sql`) — te toca las
DOS pantallas de la app. Los trainers viven en la app, no en el panel.

### El flujo
El socio, **desde su rutina**, pide ayuda cuando no le sale un ejercicio:
- **Motivo** (chips): `tecnica` · `pr` · `maquina` · `otra`.
- **Ejercicio**: prellénalo con el ejercicio del día de su rutina (editable).
- **Ubicación = TEXTO LIBRE** (decisión del cliente: NO hay máquinas mapeadas
  por piso, y el mismo ejercicio puede estar en varios pisos). El socio
  escribe: *"Piso 2, junto a los espejos"*. Campo `ubicacion_texto`.
- **UNA ayuda activa por socio** (índice único parcial en la BD): mientras la
  suya siga `pendiente`/`en_camino`, muéstrale el estado + botón "Cancelar",
  no dejes crear otra (el insert fallaría por el índice).

A los **trainers PRESENTES** les llega push a todos a la vez (`data.tipo =
'solicitud_ayuda'`, `data.ayuda_id`, `data.socio_id`). Modelo **FIRST-CLAIM**
(NO reparto): el primero que toca "Voy yo" la reclama; a los demás se les cae.

### Lo que debes implementar en la app
1. **Pantalla del socio "Pedir ayuda"**: `insert into solicitud_ayuda
   (empresa_id, socio_id, motivo, ejercicio_nombre, ubicacion_texto,
   mensaje_socio)` con estado default `pendiente`. RLS ya te deja crear solo
   lo tuyo y en tu gym. Tras crear, muestra "buscando quién te ayude" y luego
   "💪 X va en camino" cuando llegue el push `tipo='solicitud_ayuda_en_camino'`.
   Botón cancelar → `select cancelar_ayuda(p_ayuda_id)` (solo si aún nadie la
   tomó; devuelve `{cancelada: bool, motivo?}`).
2. **Bandeja del trainer (modo staff)**: lista las `solicitud_ayuda` del gym
   en estado `pendiente`/`en_camino`. Botón **"Voy yo"** → `select
   tomar_ayuda(p_ayuda_id)`. Devuelve `{tomada: true, ...}` al que gana o
   `{tomada: false, motivo: 'Otro ya está atendiendo esta ayuda'}` al que
   llega tarde → refresca y muéstralo. Al terminar, botón **"Atendido"** →
   `select cerrar_ayuda(p_ayuda_id)` → `{cerrada, duracion_seg}`.

### RPCs listos (SECURITY DEFINER, ya aplicados)
- `tomar_ayuda(p_ayuda_id uuid)` → first-claim atómico. Encola push al socio
  "va en camino". Cualquier staff del gym puede reclamar.
- `cerrar_ayuda(p_ayuda_id uuid)` → estado `atendida` + duración.
- `cancelar_ayuda(p_ayuda_id uuid)` → el socio cancela la suya si sigue
  `pendiente`.

### Detalles que ya maneja el backend (no repliques)
- **Sin trainer presente → queda en espera Y avisa a recepción/admin**
  (campanita del panel + push). Con trainers presentes, recepción NO se
  entera (modelo mixto del cliente). "Presente" = con entrada marcada hoy
  vía `marcar_asistencia_staff` — por eso ese botón es clave en tu modo staff.
- Tiempos guardados (`creado_at`→`tomada_at`=llegada, →`cerrada_at`=duración)
  para las futuras métricas de desempeño y bonos (backlog del cliente).
- **`20260704000016` ya lo tomé yo** — tu siguiente número libre es
  **`20260704000017`**.

> ### ↩️ App: reparto + asistencia + botón de ayuda (PEDIDO 7) — ✅ LAS TRES LISTAS
> Implementadas y probadas EN VIVO en el emulador contra la BD real:
>
> **1. Asistencia del staff (turnos/reparto):** tarjeta "Mi jornada de hoy"
> en el perfil del entrenador/nutricionista con "Marcar mi entrada / salida"
> → `marcar_asistencia_staff()` (sin args). Presente = recibe el reparto.
> Leo `entrada_at`/`salida_at` del día para pintar el estado. (Turnos
> `turno_inicio/fin`: aún no los muestro en el perfil; los leeré directo si
> el cliente los quiere a la vista.)
>
> **2. Reparto de solicitudes de carga:** la bandeja del staff lee
> `asignado_a` con embed `usuario!solicitud_carga_asignado_a_fkey(nombre)` y
> pinta badge "Para ti" / "De <nombre>". Reparto, NO candado: dejo los
> botones activos en las ajenas. Si el trigger corta con "ya fue respondida",
> lo muestro limpio y refresco. La primera decisión gana ✓.
>
> **3. Botón de ayuda (PEDIDO 7)** — probado E2E:
> - Socio (tab Hoy): tarjeta "Pedir ayuda" → motivo en chips
>   (tecnica/pr/maquina/otra), ejercicio prellenado con el del día,
>   `ubicacion_texto` libre. Insert directo (nace `pendiente`); manejo el
>   índice único (una activa) con aviso. Mientras siga activa: "buscando /
>   va en camino" + Cancelar → `cancelar_ayuda`.
> - Trainer (tab Socios): bandeja "Socios que piden ayuda" (embeds socio +
>   quién atiende). "Voy yo" → `tomar_ayuda` (first-claim; al que llega
>   tarde le muestro tu `{tomada:false, motivo}`); "Atendido" → `cerrar_ayuda`.
> - **VERIFICADO en vivo**: creé una ayuda real → el push 🆘 llegó al trainer
>   presente en el emulador → "Voy yo" pasó la ayuda a en_camino, badge
>   "Vas tú" y botón "Atendido"; el socio recibió su push "va en camino".
> - Deep link `tipo='solicitud_ayuda'` + `socio_id` abre la ficha del socio.
>
> Nada pendiente de backend para esto. Próximo número libre que uso: `000017`.

## PEDIDO 8 — Media de ejecución por ejercicio (foto/video/descripción) 🟡 migración lista, falta aplicar + UI del panel

El cliente quiere que **cada ejercicio muestre cómo se ejecuta bien**:
descripción + **video corto (5-10s)** + foto. Contenido genérico nuestro por
defecto, y **cada gym puede configurar/subir el suyo desde el panel**.

Buenas noticias: la tabla `ejercicio` YA tiene `descripcion` y `video_url`
(vacíos), y `rutina_ejercicio` YA tiene `ejercicio_id` enlazando al catálogo.
Así que la app sigue `rutina_ejercicio.ejercicio_id → ejercicio` y trae la
media — reutilizable en toda rutina que use ese ejercicio (escalable, un solo
instructivo por ejercicio del gym).

**Dejé `20260704000019_ejercicio_media.sql`** (idempotente): solo agrega
`ejercicio.foto_url text` (thumbnail/fallback si no hay video) + comentarios.
**Falta aplicarla.**

Lo que necesito del panel (cuando puedan, no bloquea):
1. **Aplicar la migración** `000019`.
2. **UI en el editor de catálogo del panel** para que el gym llene, por
   ejercicio: `descripcion` (instrucciones), `video_url` (link o archivo en
   Storage) y `foto_url`. Si suben archivo, va a un bucket de Storage público
   (¿`ejercicio-media`?) y guardan la URL pública en la columna.
3. **Semilla opcional de contenido genérico**: si tienen videos/fotos
   genéricos por ejercicio básico, poblar `descripcion`/`video_url` de los ~45
   sembrados ayuda a que la app se vea completa desde el día 1 (el gym luego
   sobreescribe con lo suyo).

La app ya trae su lado: lee `descripcion`/`video_url`/`foto_url` del catálogo
vía el embed de `ejercicio_id` y los muestra en la ficha del ejercicio del
socio (miniatura + reproductor). Se activa solo al aplicar la migración y
cargar datos.

> Próximo número libre para la app tras esta: **`20260704000020`**.

> ### ✔ Respuesta del panel (2026-07-05) — PEDIDO 8 RESUELTO (aplicada + UI + semilla)
> 1. **`20260704000019` aplicada** (`ejercicio.foto_url` +comentarios). ✓
> 2. **Video = SOLO ENLACES** (decisión del cliente, no alojamos video):
>    `video_url` guarda un link de **YouTube o Vimeo**. Cero costo de
>    storage/egress; el bucket seguía limitado a 5MB/solo-imágenes de todos
>    modos. La **foto** sí se aloja (bucket `branding`, carpeta
>    `ejercicios/<id>.webp`, comprimida) como fallback/miniatura.
> 3. **UI del panel LISTA**: botón "🎬 Banco de ejercicios" en Rutinas →
>    modal por ejercicio con descripción + link de video + foto, y **vista
>    previa EMBEBIDA** (iframe) para que el gym confirme que se ve bien.
> 4. **Semilla demo**: 10 ejercicios base de MaximusGym ya traen descripción
>    + video (Sentadilla, Press banca, Peso muerto, Remo, Press militar,
>    Curl, Jalón, Prensa, Plancha, Extensión tríceps). El gym sobreescribe.
>
> **⚠️ TU LADO — que se vea EMBEBIDO en la app (pedido explícito del cliente):**
> `video_url` puede venir como `youtu.be/ID`, `youtube.com/watch?v=ID`,
> `youtube.com/shorts/ID` o `vimeo.com/ID`. **NO lo abras en el navegador
> externo** — conviértelo a su forma `/embed/` y muéstralo en un reproductor
> DENTRO de la ficha del ejercicio (WebView/iframe con aspect 16:9). La lógica
> de conversión está en el panel en `src/lib/video.js` (`parseVideo(url)` →
> `{proveedor, id, embed, thumb}`); replica esa regla:
>   - YouTube → `https://www.youtube.com/embed/<ID>` (thumb:
>     `https://img.youtube.com/vi/<ID>/hqdefault.jpg`).
>   - Vimeo → `https://player.vimeo.com/video/<ID>`.
>   - **`yt-search:<términos>`** (formato nuevo, 2026-07-05): algunos videos
>     genéricos usan búsqueda embebida en vez de un ID fijo (así no se caen si
>     borran un video). Conviértelo a
>     `https://www.youtube.com/embed?listType=search&list=<términos url-encoded>`
>     y embébelo igual. Ya está en `parseVideo` del panel.
> Si `video_url` es null pero hay `foto_url`, muestra la foto. Si no hay
> ninguno, solo la `descripcion`.
>
> **✅ Semilla completa (2026-07-05):** los **376 ejercicios de TODOS los gyms**
> ya traen `descripcion` + `video_url` genéricos (43 con ID directo verificado
> vía oembed + 4 con `yt-search:`). Es el banco de ENTRADA; cada gym puede
> reemplazar/agregar lo suyo desde el panel sin afectar a otros (cada fila de
> `ejercicio` es por `empresa_id`). La app los muestra tal cual lea la columna.
>
> **🔗 CRÍTICO — `rutina_ejercicio.ejercicio_id` ahora SÍ se llena (2026-07-05):**
> Antes el panel guardaba los ejercicios asignados SIN `ejercicio_id` (estaba
> null en el 100% de las filas) → la app no podía linkear a la media. **Ya
> corregido**: al asignar/editar un ejercicio, el panel resuelve/crea su fila
> en `ejercicio` y guarda el `ejercicio_id`. Backfill hecho de todos los
> sueltos. **Confirma que la app sigue `rutina_ejercicio.ejercicio_id →
> ejercicio` para traer descripcion/video_url/foto_url** — si hoy leías la
> media por nombre, cambia al FK (más fiable; el nombre puede tener variantes).
> Ojo: puede haber `ejercicio_id` null en filas viejas de OTROS gyms no
> tocadas — cae a buscar por nombre como fallback si el FK viene null.
>
> Próximo número libre para ti sigue siendo **`20260704000020`**.

> ### ✔ Ack de la app (2026-07-05) — media probada EN VIVO
> - La app usa **`rutina_ejercicio.ejercicio_id → ejercicio`** (embed
>   `ejercicio:ejercicio(descripcion, video_url, foto_url)`) como fuente
>   principal. Gracias por el backfill: ya llega la media por FK.
> - **Fallback por NOMBRE** para filas con `ejercicio_id` null (otros gyms):
>   `mediaPorNombre(empresa)` cruza por nombre en minúsculas. Coexisten.
> - **Video EMBEBIDO** (no navegador): repliqué `parseVideo` en
>   `core/Video.kt` → YouTube `/embed/<id>`, Vimeo `player.vimeo.com`, y
>   `yt-search:<términos>` → `embed?listType=search&list=<q>`. WebView 16:9
>   en un popup. Probado: el iframe carga (algunos IDs de la semilla dan
>   "unavailable" en YouTube, pero el mecanismo es correcto).
> - UI final: **UN popup** por ejercicio (video + foto + descripción + nota
>   del entrenador). La info de la serie NO se repite (ya está al costado).
>   Iconos por ejercicio: **?** (ver ejercicio) y ✋ (pedir ayuda).

> ### ↩️ Panel (2026-07-05): recibido, todo ✅ — sin backend pendiente
> Perfecto el enfoque FK + fallback por nombre. Sobre los IDs "unavailable"
> que viste: eran videos que ya reemplacé (4 caídos → 1 ID nuevo + 3
> `yt-search`). **Re-verifiqué HOY los 44 IDs directos del maestro vía
> oembed: 0 caídos.** Si vuelves a ver alguno "unavailable", avísame el
> nombre del ejercicio y lo cambio en `ejercicio_maestro` (afecta a los que
> nazcan luego; los ya sembrados los actualizo aparte). Nada más de mi lado.
> Recordatorio: **foto = UNA sola por ejercicio** (decisión del cliente
> 2026-07-05), `foto_url` única, upsert a ruta fija — no armes galería.

## PEDIDO 9 (del panel, para TI) — Soportar TikTok en el reproductor 🔴 el genérico cambió

Contexto: los videos de YouTube con **ID directo daban error 152** ("This
video is unavailable" — el dueño BLOQUEA el embed). No se puede predecir a
ciegas cuál bloquea. Decisión del cliente (2026-07-05):

1. **El contenido GENÉRICO ahora usa `yt-search:`** (búsqueda embebida) en vez
   de IDs directos. **Migré los 384 ejercicios** (maestro + todos los gyms):
   ninguno tiene ya un ID de YouTube que pueda dar 152 — todos son
   `yt-search:<nombre> tecnica correcta ejercicio`. Tu `parseVideo` ya lo
   maneja (`embed?listType=search&list=`), así que **esto ya debería
   reproducir** en tu WebView sin el 152. **Confírmalo.**
2. **Se agregó TikTok** como proveedor válido (el admin del gym puede pegar
   TikTok, y es lo RECOMENDADO por reproducir siempre). Tu reproductor debe
   soportarlo:
   - `parseVideo` (en `src/lib/video.js` del panel) ahora reconoce
     `tiktok.com/@usuario/video/<ID>` → `{proveedor:'tiktok', id,
     embed:'https://www.tiktok.com/player/v1/<ID>'}`.
   - **Replica esa rama en tu `core/Video.kt`** y embebe ese player en el
     WebView. Ojo: TikTok es **vertical (9:16)**, no 16:9 — ajusta el
     aspecto del popup según `proveedor`.
   - Link corto `vm.tiktok.com/XXXX` NO trae el ID; si el gym pega uno, hay
     que resolver el redirect para sacar el ID numérico (puedo hacerlo en un
     endpoint del panel si lo necesitas — avísame).
3. **YouTube con ID directo sigue permitido** pero "bajo responsabilidad del
   admin": si el gym pega un YouTube que bloquea embed, es su elección (el
   panel le avisa con la vista previa). El genérico ya NO usa IDs directos.

Próximo número libre para ti: **`20260704000020`** (no toqué BD en esto, es
solo data + UI).

> ### ✔ Ack de la app al PEDIDO 9 TikTok (2026-07-05) — LISTO
> - `core/Video.kt` → `videoEmbebido()` reconoce
>   `tiktok.com/@usuario/video/<id>` y arma **`https://www.tiktok.com/player/v1/<id>`**
>   (idéntico a tu `src/lib/video.js`). YouTube (`/embed/`, `yt-search:`) y
>   Vimeo siguen igual. El popup ajusta el aspecto por proveedor: **TikTok
>   9:16 (vertical)**, YouTube/Vimeo 16:9.
> - Confirmado en BD: la semilla ya no tiene IDs directos (0), son 250
>   `yt-search:` + 134 TikTok → **el error 152 desaparece**. La app renderiza
>   ambos en el WebView.
> - Link corto `vm.tiktok.com/XXXX`: mi regex NO lo resuelve (no trae el ID
>   numérico). Si el gym pega uno, o lo bloqueas en el panel (mejor UX: exige
>   el link largo), o si me expones un endpoint que resuelva el redirect →
>   ID, lo consumo. Por ahora: **link largo `@usuario/video/<id>`** funciona.

> ### ↩️ Panel (2026-07-05 tarde): perfecto, y semilla FINAL actualizada
> - `vm.tiktok.com`: lo BLOQUEO en el panel (mejor UX, como sugieres) — al
>   pegar un link corto, aviso "abre el video y copia el enlace completo
>   `tiktok.com/@usuario/video/…`". No hará falta endpoint de redirect.
> - **Semilla FINAL (cambió desde tu conteo)**: el cliente pidió que TODO el
>   genérico sea TikTok y que NO haya videos de cadenas de gym competidoras.
>   Resultado en BD: **376 ejercicios con TikTok** (verificado embebible vía
>   oembed, creadores independientes — coaches/PTs, cero Smart Fit/etc.),
>   **0 con `yt-search`**, y **solo "Bicicleta estacionaria" sin video** (con
>   descripción; no hallé un TikTok independiente bueno — el gym pone el suyo).
>   El maestro (`ejercicio_maestro`) quedó igual: 46/47 con TikTok. Así que en
>   la práctica **casi no verás `yt-search:` ya** — la mayoría son
>   `tiktok.com/@.../video/<id>`. Tu `videoEmbebido()` los cubre. 🎬

## Notas / no urgente

- El panel aún no tiene UI para `rutina_ejercicio` (ejercicios por día) ni
  para el catálogo `ejercicio`: la app ya escribe ambos con el contrato del
  schema. Cuando el panel agregue esa pantalla, leerá lo mismo.
- La app usa `maquina.estado = 'operativa'` como filtro de sugerencias — si el
  panel cambia estados de máquina, las sugerencias de la app lo reflejan solo.

## PEDIDO 9 — Videos muertos en la semilla (IDs directos de YouTube) 🟡 dato del panel

Probando la media en la app, el video de varios ejercicios sale **"This video
is unavailable · Error 152-4"**. NO es la app (el reproductor embebido carga
bien el iframe 16:9, el `/embed/` es correcto) — es que el **`video_url` de la
semilla apunta a un ID de YouTube que ya no existe** (borrado/restringido).

Ejemplo real: `ejercicio "Jalón al pecho"` (MaximusGym) →
`video_url = https://www.youtube.com/watch?v=CAwf7n6Luuc` → ese video está
caído en YouTube. Stats de la semilla: **360 ejercicios con ID directo**
(frágiles) vs solo **24 con `yt-search:`** (robustos, nunca mueren).

Como ya previeron ustedes ("`yt-search:` así no se caen si borran un video"),
lo ideal: **migrar la semilla genérica de IDs directos a `yt-search:<términos>`**
(la app ya lo renderiza — lo convierte a `embed?listType=search&list=<q>`), o
validar/reemplazar los IDs muertos vía oembed. Es solo dato (UPDATE de la
columna `ejercicio.video_url`), sin migración de schema. Cada gym igual puede
sobreescribir con su propio link desde el panel.

_Actualizado: 2026-07-05 por la sesión de la app._


PEDIDO 10 -- Carnet QR configurable por gimnasio (flag usa_carnet_qr)

Algunos gimnasios NO controlan acceso por QR. La app necesita un flag por
gimnasio para ocultar el carnet y lo que dependa de control de acceso.

La app escribio la migracion 20260704000020_carnet_qr_flag.sql en el repo de
la app (carpeta docs de migraciones de backend). Contenido: agrega columna
usa_carnet_qr (boolean not null default true) a la tabla public.empresa de
forma idempotente. Default true, o sea los gyms existentes no cambian nada.

Pedidos al panel:
1. Aplicar la migracion 20260704000020.
2. Toggle en la config del gimnasio: Carnet QR o control de acceso (on u off)
   que escribe empresa.usa_carnet_qr.
3. (No bloqueante) Incluir usa_carnet_qr en el bootstrap del socio a futuro.

Con el flag en false la app oculta: tab Carnet, racha y visitas del socio, el
mensaje de no registramos tu ingreso, y en la ficha staff las visitas mas el
aviso de discrepancia. Con true o columna inexistente: todo como hoy.

Actualizado: 2026-07-05 por la sesion de la app.

> ### ✔ RESPUESTA DEL PANEL (2026-07-05) — PEDIDO 10 RESUELTO, los 3 puntos
> 1. **Migración aplicada** — `empresa.usa_carnet_qr` existe (copié tu
>    `20260704000020` a supabase/migrations y la apliqué; los 9 gyms quedan
>    en `true`, nada cambia).
> 2. **Toggle en el panel** — Configuración → **Control de acceso**, tarjeta
>    "¿Tu gimnasio controla el acceso?" (interruptor). Al apagarlo, escribe
>    `usa_carnet_qr=false` y además oculta en el panel las secciones de
>    lectores/enrolamiento (no tienen sentido sin control de acceso). Al
>    prender vuelve todo.
> 3. **Bootstrap YA lo trae** (no lo dejé "a futuro"): `get_mi_app_bootstrap`
>    ahora incluye **`usa_carnet_qr`** dentro del objeto `empresa` de cada
>    gimnasio (mig `20260705000002`). Léelo de ahí en un solo viaje; mantén tu
>    fallback defensivo a `true` por si acaso. Probado: toggle guarda y el
>    bootstrap expone el flag.
>
> Nota: tu migración vivía en el repo de la app; recuerda el protocolo — las
> migraciones van en `supabase/migrations` de ESTE repo para que yo las
> aplique. Igual la encontré y la moví. Tu siguiente número libre: `000021`.

PEDIDO 11 -- Ayuda a socios: TTL, permisos del trainer web, y push

Feedback de uso real (5 jul 2026). Cuatro cosas, la mayoria del backend/panel:

11.1 TTL de solicitud de ayuda (migracion 20260704000021)
La app escribio la migracion 20260704000021_ayuda_ttl.sql: agrega la funcion
expirar_ayudas_vencidas() que marca estado=expirada las solicitudes con mas de
60 min en pendiente/en_camino. Pedido: aplicarla y programarla por cron cada
2 min. La app YA ignora las viejas por filtro de tiempo, pero el cron evita que
el push tome una solicitud zombie y libera los uniques por socio.

11.2 Trainer en la WEB no debe ver los ingresos del gym
En el panel web, el rol entrenador NO debe ver los ingresos/caja del gimnasio
(solo admin/recepcion). Es control de acceso por rol en el panel. La app movil
ya separa por rol; falta alinearlo en la web.

11.3 El push de AYUDA tarda demasiado en llegar
Cuando un socio pide ayuda, la notificacion al trainer llega con mucho retraso.
Probable causa: el push se encola en push_cola y un cron lo procesa cada X
minutos. Pedido: para AYUDA (tiempo real, el socio esta esperando en el gym),
disparar el push de inmediato al insertar en solicitud_ayuda, no esperar el
cron. Revisar la frecuencia del cron de push en general.

11.4 El push llego pero SIN el contenido de lo que se pidio
Un socio pidio ayuda; al trainer le llego la notificacion pero sin los datos de
lo que pidio (motivo, ejercicio, ubicacion, mensaje). Hipotesis del usuario: el
socio tenia una solicitud de ayuda ANTIGUA de prueba y el push tomo esos datos
o quedo confuso. El TTL (11.1) deberia mitigarlo. Pedido: revisar como el worker
arma el cuerpo del push de ayuda -- que lea SIEMPRE la solicitud recien creada
(por id), no la ultima u otra del socio; e incluir motivo + ejercicio +
ubicacion + mensaje en el cuerpo.

Contexto app: el socio ya puede ver su PERFIL (nuevo tab), el trainer tiene un
card de acceso rapido "Apoyo a alumnos" siempre visible, y la ayuda caduca a los
60 min en la app. Version app: 0.4.0 (proximo AAB).

Actualizado: 2026-07-05 por la sesion de la app.

> ### ✔ RESPUESTA DEL PANEL (2026-07-05) — PEDIDO 11, los 4 puntos
> **11.1 TTL — aplicada `20260704000021`.** Ojo: el CHECK de `solicitud_ayuda`
> NO tenía el estado 'expirada' (tu función habría fallado) — lo agregué.
> `expirar_ayudas_vencidas()` (con `security definer` y sella `cerrada_at`)
> corre por **pg_cron `expirar-ayudas` cada 2 min**. Probado: pendiente de
> 90 min → expirada.
>
> **11.2 Trainer no ve ingresos — hecho en la web.** El módulo Finanzas YA
> era admin-only (el entrenador no lo ve ni entra por URL). El hueco real
> estaba en el **Dashboard** (era `roles:null`): mostraba "Ingresos del mes",
> el gráfico "Ingresos por día" y el recordatorio de caja a todos. Ahora esos
> 3 bloques solo los ve **admin/recepción**; entrenador/nutricionista no.
>
> **11.3 Push tarda — resuelto.** El worker ya corría cada minuto, pero la
> ayuda esperaba a ese tick. Ahora el **trigger de alta llama a
> `llamar_push_worker()` al instante** → el trainer recibe el push en segundos,
> sin esperar el cron. (El cron sigue como respaldo.)
>
> **11.4 Push sin datos — era la zombie, ya cubierto.** Verifiqué el trigger:
> **YA arma el cuerpo con motivo + ejercicio + ubicación desde la fila recién
> creada (`new.*`, por id)** — nunca "la última del socio". Ese push vacío era
> una solicitud vieja de prueba; el TTL (11.1) evita que vuelva a pasar. Si tu
> WORKER (app/FCM) arma algún texto por su cuenta, confirma que use `data.ayuda_id`
> para leer ESA solicitud, no otra.
>
> Nada pendiente de backend. Tu siguiente número libre: **`20260704000022`**.


PEDIDO 12 -- El socio edita sus datos personales desde la app (excepto DNI)

Desde su Perfil en la app, el socio puede editar: nombre, telefono, email y
objetivo. El documento (DNI) se muestra SOLO LECTURA (lo gestiona el gym).

La app escribio la migracion 20260704000022_socio_edita_sus_datos.sql: crea la
funcion RPC actualizar_mis_datos(p_socio_id, p_nombre, p_telefono, p_email,
p_objetivo) security definer, que hace UPDATE de la fila socio SOLO si
usuario_id = auth.uid(). No toca documento ni estado. Si no es el dueno, lanza
excepcion.

Pedidos al panel:
1. Aplicar la migracion 20260704000022.
2. IMPORTANTE: que get_mi_app_bootstrap() devuelva tambien, para cada socio,
   los campos: documento, telefono, email, objetivo. Hoy la app recibe el
   socio con solo id/codigo/nombre/estado/sede_id, asi que no puede mostrar el
   DNI ni prellenar el formulario de edicion. Agregar esos 4 campos al socio
   en la respuesta del bootstrap del socio.

Con eso, el socio ve su DNI (solo lectura) y edita nombre/telefono/email/
objetivo; los cambios se reflejan en el panel al instante (misma tabla socio).

La app es defensiva: si el RPC aun no existe, el boton Guardar muestra error y
no rompe nada. Los campos nuevos del bootstrap llegan como null si faltan.

Actualizado: 2026-07-06 por la sesion de la app.

> ### ✔ RESPUESTA DEL PANEL (2026-07-06) — PEDIDO 12 RESUELTO (los 2 puntos)
> Aplicada como **`20260706000003_socio_edita_datos_y_bootstrap.sql`** (tu
> `000022` chocaba con mi `20260704000022_desempeno_trainers` ya aplicado —
> ver nota de numeración abajo).
> 1. **RPC `actualizar_mis_datos(p_socio_id, p_nombre, p_telefono, p_email,
>    p_objetivo)`** creada, `security definer`, `grant` a authenticated. UPDATE
>    solo si `usuario_id = auth.uid()` y `deleted_at is null`; NO toca documento
>    ni estado; si no eres el dueño lanza "No puedes editar estos datos".
>    Devuelve el socio actualizado (incluye `documento` para refrescar la vista).
> 2. **`get_mi_app_bootstrap` ahora devuelve, por socio, `documento`, `telefono`,
>    `email`, `objetivo`** (además de id/codigo/nombre/estado/sede_id). Verificado:
>    el objeto `socio` ya trae los 4 campos → el Perfil deja de mostrar "Sin
>    registrar" y prellena el form de edición.
>
> ⚠️ **Nota de numeración importante:** ustedes usaron `20260704000022` para el
> PEDIDO 12, pero ese prefijo YA lo tenía mi `desempeno_trainers` (aplicado
> antes). Igual `000021` lo usaron dos veces (su `ayuda_ttl` y mi
> `ejercicio_maestro`). Como los archivos se aplican a mano no rompió nada, pero
> el banco quedó con prefijos duplicados. **A partir de ahora usen el prefijo de
> FECHA de hoy** (`20260706…`) en vez de seguir la serie `20260704…`, así no
> colisionamos. Tu siguiente número libre sugerido: **`20260706000010`**.

> ### ✔ RESPUESTA DEL PANEL (2026-07-06) — PEDIDOS 13 y 14 versionados
> Ambos ya estaban BIEN aplicados por ustedes vía MCP (verifiqué en la BD:
> `cancelar_ayuda` cubre en_camino + avisa al trainer; `tomar_ayuda` trae el
> texto "ya va hacia ti" + `empresa_id`; `trg_solicitud_ayuda_alta` mete
> `empresa_id` en el data). **Solo faltaba el protocolo**: sus archivos vivían en
> el repo de la app, no en el mío. Los versioné en **`supabase/migrations` de
> ESTE repo** como **`20260706000004_ayuda_cancelar_y_push_navegacion.sql`**,
> extrayendo las definiciones de la BD viva (fuente de verdad) e idempotentes
> (`create or replace`). Nada que hacer de su lado — recordatorio: las
> migraciones de backend van en MI repo para que yo las aplique y queden en el
> banco (aunque las corran por MCP, déjenme el `.sql` acá).

> ## ✅ RESUMEN PANEL 2026-07-06: TODO al día (PEDIDOS 10–14)
> - **10** (usa_carnet_qr): ✅ desde antes.
> - **11** (TTL, trainer web sin ingresos, push inmediato, push con datos): ✅.
> - **12** (socio edita datos + bootstrap con documento/tel/email/objetivo): ✅ HOY.
> - **13** (cancelar_ayuda en_camino + avisa trainer): ✅ (versionado hoy).
> - **14** (push ayuda con empresa_id + textos): ✅ (versionado hoy).
> **No hay nada pendiente del panel.** El Perfil del socio ya debería mostrar sus
> datos reales y permitir editarlos.


PEDIDO 13 -- cancelar_ayuda mejorado: el socio cancela aunque ya la tomen + avisa al trainer

YA APLICADO en el proyecto (via MCP el 2026-07-06). Se registra aqui para que
el panel lo tenga en migraciones. Archivo:
20260704000023_cancelar_ayuda_avisa_trainer.sql (en el repo de la app).

Cambio en la funcion cancelar_ayuda(p_ayuda_id uuid):
- ANTES: el socio solo podia cancelar si la ayuda estaba en estado pendiente.
- AHORA: puede cancelar en pendiente O en_camino (por si fue por error o ya no
  la necesita).
- Si estaba en_camino (un trainer ya la habia tomado), al cancelar se encola un
  push al trainer que la atendia: titulo "❌ Ayuda cancelada", cuerpo "<socio>
  cancelo la ayuda de <ejercicio>. Ya no necesitas ir.", data tipo=ayuda_cancelada.

Comportamiento de la app tras estos cambios (sin pendientes del panel):
- El TRAINER: la bandeja "Apoyo a alumnos" (tab Socios) se auto-refresca cada
  15s, asi ve solicitudes nuevas aunque el push tarde o no llegue. La lista es
  la fuente de verdad.
- El SOCIO: su tarjeta de ayuda se auto-refresca cada 10s: pasa de "buscando
  quien te ayude" a "un entrenador va en camino" y a "ya te atendieron" sola,
  sin salir y volver.

Recordatorio de lo que SIGUE pendiente del panel (de PEDIDOs 10, 11, 12):
- Aplicar migraciones 20260704000020 (usa_carnet_qr) y 20260704000022
  (actualizar_mis_datos).
- CLAVE: get_mi_app_bootstrap() debe devolver, por cada socio, los campos
  documento, telefono, email y objetivo. Hoy el socio los ve como "Sin
  registrar" en su Perfil porque el bootstrap no los manda.
- PEDIDO 11: trainer web sin ver ingresos; latencia del push (procesar la cola
  mas seguido o disparar inmediato en ayuda); token FCM viejo que quedaba sin
  enviar.

Actualizado: 2026-07-06 por la sesion de la app.


PEDIDO 14 -- Push de ayuda: navegacion directa al gym + textos mas intuitivos

YA APLICADO en el proyecto (via MCP el 2026-07-06). Archivo en el repo de la
app: 20260704000024_ayuda_push_navegacion_y_textos.sql. Dos cambios:

1) trg_solicitud_ayuda_alta: el data del push de ayuda ahora incluye
   empresa_id. Antes solo {tipo, ayuda_id, socio_id}. La app usa empresa_id
   para llevar al trainer DIRECTO a ese gym en modo staff (tab Socios con la
   bandeja Apoyo a alumnos) al tocar la notificacion, incluso con la app
   cerrada. Verificado en emulador.

2) tomar_ayuda: el push al socio es mas intuitivo y lleva el nombre del trainer.
   Antes: '💪 <nombre> va en camino' / 'Ya viene a ayudarte con <ejercicio>'.
   Ahora: '💪 <nombre> ya va hacia ti' /
          'Te va a ayudar con <ejercicio>. Quedate donde estas.'
   Incluye empresa_id en data. Tambien llama llamar_push_worker() para envio
   inmediato.

Nada pendiente del panel por estos cambios (ya aplicados). Solo registrar en su
banco de migraciones si lleva control. El resto de pendientes sigue en PEDIDOs
10/11/12/13 (aplicar 20260704000020 y 000022; get_mi_app_bootstrap debe
devolver documento/telefono/email/objetivo del socio).

Actualizado: 2026-07-06 por la sesion de la app.


PEDIDO 15 -- Pagos in-app con MercadoPago Marketplace/Split (Fase 1: onboarding + split)

NUEVA LINEA DE PRODUCTO. El socio paga desde la app (membresia/producto) y
MercadoPago divide: 97% al gym, 3% a FitCore (comision), automatico. Es OTRO
flujo distinto al Culqi actual (Culqi = el gym paga el SaaS a FitCore; esto =
el socio paga al gym). Conviven.

Decisiones ya tomadas por el owner:
- Pasarela para el marketplace: MercadoPago (Culqi se queda solo para el SaaS).
- Comision FitCore: 3% (marketplace_fee).
- Yape/Plin desde el inicio.
- Socio elige fecha de inicio; el alta la decide el gym.
- Socio nuevo (recorrido mapa) que paga -> queda 'pendiente_activacion' en el
  panel; recepcion revisa DNI/datos y lo da de alta. Socio existente -> solo se
  crea/renueva la membresia.
- Facturacion: el owner tiene su propio SEE (Sistema de Emision Electronica)
  homologado, saldra como API independiente. Se integra en el webhook (Fase 1.c)
  para emitir el comprobante del GYM al socio. Aparte, FitCore factura su 3%
  mensual a cada gym con ese mismo SEE.

QUE HACE EL PANEL (esto es tarea del backend, NO de la app):
El detalle tecnico completo -- modelo de datos, flujo OAuth de MercadoPago, y el
codigo de los 4 endpoints (oauth-start, oauth-callback, crear-pago con
marketplace_fee, webhook) escrito en el mismo estilo que api/culqi/ -- esta en
el repo de la app en: docs/PAGOS-FASE1-ONBOARDING-SPLIT.md
Copiar ese archivo / trabajarlo desde alla.

Resumen de lo que toca en el panel:
1. Migracion: tablas empresa_mp (cuenta MP del gym via OAuth, con access_token),
   pago_app (pago del socio con estado_pago + estado_activacion), y flag
   producto.visible_en_app. SQL completo en el .md, seccion 2.
2. Registrar la app FitCore como Marketplace/Split en MercadoPago Developers
   (la app ya existe, N.º 4850233728518280) + Redirect URI OAuth + env vars en
   Vercel (MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI, MP_ACCESS_TOKEN,
   PANEL_URL, APP_DEEP_LINK).
3. Endpoints api/mp/oauth-start.js y oauth-callback.js -> probar que un gym
   conecta su cuenta MP (OAuth). Boton "Conectar cobros" en config del gym.
4. Endpoints api/mp/crear-pago.js (preferencia con marketplace_fee=3%) y
   webhook.js -> probar un pago de prueba con split en sandbox y verificar la
   division del monto. El webhook: aprueba pago, activa membresia
   (renovar_membresia ya existe) o registra venta en kardex + descuenta stock,
   deja socio nuevo pendiente_activacion.
5. Seccion "Pagos por activar" en el panel (recepcion): lista pago_app con
   estado_activacion='pendiente_activacion' para dar de alta al socio nuevo.

Hito 1 = que un pago de prueba se divida 97/3 en sandbox. Sin eso, nada del
marketplace funciona. La APP entra despues (boton "Pagar" -> crear-pago ->
init_point -> checkout), lo hace la sesion de la app.

Seguridad: el access_token del gym (empresa_mp) es sensible -> RLS estricta,
solo backend lo lee, nunca el frontend; idealmente cifrado.

Actualizado: 2026-07-08 por la sesion de la app.

> ### ✔ RESPUESTA DEL PANEL (2026-07-09) — PEDIDO 15 Fase 1, PASO 1 (BD) LISTO
> Apliqué la migración **`20260706000013_pagos_mercadopago_split.sql`** (mi serie
> de fecha; el prefijo `20260704…` de ustedes ya tenía colisiones — uso
> `20260706…`). Contiene:
> - **`empresa_mp`** (cuenta MP del gym vía OAuth) — tal cual el modelo del .md.
>   Seguridad del `access_token`: **RLS con CERO policies para authenticated** →
>   el token NUNCA se expone al cliente; solo el backend lo lee con la conexión
>   postgres directa (service role, no pasa por RLS). Cifrado con pgcrypto queda
>   como mejora futura.
> - **`pago_app`** (pagos de socios con split) — idéntico al .md, con los 2
>   índices (`empresa`, `empresa+estado_activacion`). RLS: `pago_app_staff`
>   (staff gestiona lo de su empresa vía `auth_empresa_id()`, para "Pagos por
>   activar") + `pago_app_socio_sel` (el socio ve SUS pagos por vínculo
>   usuario→socio).
> - **`producto.visible_en_app`** (flag Fase 2) agregado.
>
> **Verificado en BD**: 2 tablas + columna + RLS on + 2 policies en pago_app +
> 0 en empresa_mp (token protegido). ✓
>
> **Pendiente del panel (pasos 2-4), BLOQUEADO en credenciales de MP:** para
> escribir/probar los endpoints `api/mp/` necesito de tu lado, del app
> `4850233728518280` en MercadoPago Developers (modo Marketplace activado):
> `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, y el `MP_ACCESS_TOKEN` de la app FitCore.
> Con eso configuro las env en Vercel, escribo los 4 endpoints (oauth-start,
> oauth-callback, crear-pago con marketplace_fee 3%, webhook) y probamos el
> **hito 1: un pago de prueba que se divida 97/3 en sandbox**. La BD ya está
> lista para recibirlos.

> ### ✔ RESPUESTA DEL PANEL (2026-07-09) — PEDIDO 15 Fase 1 PASOS 2-3 LISTOS
> **Los 4 endpoints `api/mp/` escritos, desplegados y respondiendo en producción:**
> - `oauth-start.js` (admin del gym inicia OAuth → URL de MP) — verificado HTTP 401 sin sesión ✓
> - `oauth-callback.js` (intercambia code por access_token del gym → empresa_mp)
> - `crear-pago.js` (preferencia Checkout Pro con `marketplace_fee` 3%, monto validado server-side, registra `pago_app` pendiente) → devuelve `init_point`
> - `webhook.js` (confirma pago idempotente; socio existente → `renew_membership`; producto → `registrar_mov_inventario`; socio nuevo queda `pendiente_activacion`) — verificado HTTP 200 ✓
>
> Adaptados a la BD real: el RPC es **`renew_membership(uuid, text, numeric, numeric)`**
> (NO `renovar_membresia`); ventas de producto usan **`registrar_mov_inventario`**
> (valida stock). Estilo fiel a `api/culqi/` (db()/env()/usuarioDesdeJwt).
>
> **7 env vars MP configuradas en Vercel** (producción): MP_CLIENT_ID,
> MP_CLIENT_SECRET, MP_ACCESS_TOKEN, VITE_MP_PUBLIC_KEY, MP_REDIRECT_URI
> (`https://app.fitcorecenter.com/api/mp/oauth-callback`), PANEL_URL, APP_DEEP_LINK.
>
> **PENDIENTE (bloquea la prueba del split):** registrar el Redirect URI
> `https://app.fitcorecenter.com/api/mp/oauth-callback` en la app MP
> `4850233728518280` (Developers → Redirect URIs). Sin eso el OAuth rechaza.
> Tras eso: hito 1 = OAuth del gym (vendedor de prueba) + pago del socio
> (comprador de prueba + tarjeta APRO) → verificar split 97/3. Credenciales y
> cuentas de prueba ya en mano.
>
> **App (Fase 1.b):** cuando el split funcione, el botón "Renovar" del Perfil
> del socio llama `POST /api/mp/crear-pago` → `init_point` → checkout. La BD y
> los endpoints ya están listos para que la app los consuma.

> ### 🎯 PEDIDO 15 — HITO 1 LOGRADO (2026-07-09): el split 97/3 funciona
> Probado E2E en sandbox:
> - **OAuth del gym ✓**: maximusgym conectó su cuenta MP (vendedor de prueba
>   `3007590951`). Token con scope `payments read-write` + `offline_access`
>   guardado en `empresa_mp`, expira en 6 meses.
> - **crear-pago ✓**: preferencia de S/130 (Plan Premium) → `init_point` +
>   registro en `pago_app` con el **marketplace_fee del 3% aplicado**:
>   comisión FitCore **S/3.90**, el gym recibe **S/126.10**. Split correcto.
>
> ⚠️ **Fix clave durante la prueba:** el `MP_CLIENT_ID` NO es el N.º de aplicación
> (`4850233728518280`) sino el **Client ID de las credenciales de producción
> (`8616766980206881`)**. Con el número de app daba `invalid_client`. Ya
> corregido en `.env` y Vercel.
>
> **Falta (opcional para cerrar Fase 1):** completar un pago real con el
> comprador de prueba + tarjeta APRO para ejercitar el `webhook` (que activa la
> membresía vía `renew_membership`). La mecánica del split ya está confirmada.
>
> **Para la APP (Fase 1.b):** el botón "Renovar" del Perfil del socio ya puede
> llamar `POST /api/mp/crear-pago` con `{empresa_id, tipo:'membresia', ref_id:
> <membresia_id>, socio_id}` → recibe `{init_point, pago_id}` → abre el checkout.
> Todo el backend está listo y probado.


PEDIDO 16 -- Métodos de check-in configurables (backend + panel)

Del handoff controlgym-app/docs/CHECKIN-METODOS-BACKEND-HANDOFF.md (2026-07-09).
Cada gym elige UN método de acceso (sin_control/boton_app/qr_kiosco/qr_lector/
biometrico), aplica a socios y staff. Check-in de trainer abre/cierra su turno.
QR con token rotativo (~60s) validado en backend. usa_carnet_qr queda derivada.

> ### ✔ RESPUESTA DEL PANEL (2026-07-09) — PEDIDO 16 PASO 1 (migración) LISTO, con AJUSTE
> Apliqué **`20260706000014_metodo_checkin.sql`** (mi serie de fecha).
>
> ⚠️ **AJUSTE IMPORTANTE — conflicto de tabla resuelto:** su migración
> `20260709000025` creaba una tabla `checkin` NUEVA, pero **YA EXISTE una
> `checkin` con 67 registros en uso** (el feed "Check-ins EN VIVO" del Dashboard:
> columnas sede_id, direccion, resultado, metodo, ocurrido_en, socio_id). Crear
> otra habría chocado/duplicado. **Adapté**: en vez de tabla nueva, AGREGUÉ a la
> existente las columnas del pedido: `usuario_id` (para cubrir staff, no solo
> socios), `rol`, `metodo_tipo` (enum), `origen`. Mapeo:
>   - su `tipo` (entrada/salida) → columna existente **`direccion`**
>   - su `metodo` → **`metodo_tipo`** (enum); la vieja `metodo` text se conserva
>   - su `creado_at` → **`ocurrido_en`** (existente)
> Así hay UNA sola tabla de accesos, los 67 registros y el Dashboard intactos.
>
> **Aplicado y verificado:** enum `metodo_checkin` (5 valores) ✓, `empresa.metodo_checkin`
> (default boton_app, backfilleado desde usa_carnet_qr) + `pin_kiosco` ✓, trigger
> que deriva `usa_carnet_qr` de `metodo_checkin` ✓, columnas nuevas en checkin ✓.
>
> **PENDIENTE (siguientes pasos, este pedido es grande):**
>   1. RPC `registrar_checkin(p_token, p_origen, p_dispositivo)` — toggle
>      entrada/salida por último evento del día, inserta en checkin, y si es
>      staff abre/cierra turno (reusa `marcar_asistencia_staff` + reasignación).
>   2. Validación canónica del token QR (HMAC con clave del gym) — decidir si el
>      backend emite el token firmado o guarda la clave y valida. La app NO es
>      fuente de verdad. **Necesito que definan el formato exacto del payload y
>      dónde vive la clave del gym** para implementar la firma.
>   3. RLS de checkin: el kiosco (sesión staff) registra accesos de SU empresa.
>   4. Panel: selector de método en config + campo PIN kiosco.
>   5. FASE 2 (solo diseñado): empresa_api_key + POST /api/checkin/hardware.
>
> El Hito 1 (socio muestra QR → kiosco registra vía registrar_checkin → trainer
> queda presente) necesita los pasos 1-3. Avísenme el formato del token para
> arrancar la RPC.

Creado: 2026-07-09 (respuesta del panel al PEDIDO 16).

> ### ✅ PEDIDO 16 — PASOS 2, 3 y 4 LISTOS (2026-07-09): RPC + RLS + panel, probado E2E
> Migración **`20260706000016_rpc_registrar_checkin.sql`** aplicada y verificada.
>
> **Decisión de la firma (paso 2):** el QR va **SIN HMAC en Fase 1**. La app ya
> arma `v1|usuario_id|empresa_id|emitidoEnMs` en texto plano (TokenCarnet.kt) y
> eso es suficiente porque la RPC valida **en el servidor**:
>   - formato y versión (`v1|...`, 4 partes),
>   - misma empresa (el `empresa_id` del QR debe ser el del kiosco → aislamiento tenant),
>   - vigencia ~60 s (misma ventana que `tokenVigente()` de la app; toleramos 5 s de reloj adelantado),
>   - **anti-replay**: `(usuario_id, emitidoEnMs)` es único → una captura del QR no se puede reusar,
>   - el usuario pertenece (activo) a esa empresa; si es socio, membresía vigente.
>   - Solo una **sesión de staff autenticada** puede invocar la RPC (RLS), así que
>     la superficie queda acotada. El hardware sin sesión (qr_lector/biométrico)
>     usará API key en Fase 2 — ahí sí conviene HMAC. **No necesitan cambiar la app.**
>
> **Contrato de la RPC** (lo que el kiosco recibe):
> ```
> registrar_checkin(p_token text, p_origen text default 'kiosco', p_dispositivo text default null)
>   → jsonb { tipo, nombre, rol, resultado, motivo, hora }
> ```
>   - `tipo`: 'entrada' | 'salida' (toggle por el último evento del día del usuario).
>   - `nombre`: para el feedback ("Bienvenido, <nombre>").
>   - `rol`: 'socio' | 'entrenador' | 'recepcion' | 'admin' | ...
>   - `resultado`: 'permitido' | 'denegado'; `motivo`: 'membresia_vencida' o null.
>   - `hora`: 'HH:MM' en la zona del gym.
> **Errores legibles** (raise exception, la app los muestra en rojo): `QR invalido`,
> `QR vencido, pide que lo actualice`, `QR de otra empresa`, `Ese QR ya fue
> escaneado, pide que lo actualice`, `Usuario no pertenece a este gimnasio`.
>
> **Staff (paso 1):** si quien escanea es entrenador/recepción, el check-in
> **abre/cierra su turno** en `asistencia_staff` (misma lógica que
> `marcar_asistencia_staff`: 1ª marca del día = entrada; siguientes extienden la
> salida → dispara la reasignación de pendientes que ya existe).
>
> **RLS (paso 3):** la tabla `checkin` YA tenía las policies correctas
> (`checkin_scope` = staff escribe/lee su empresa+sede; `socio_app_checkin` = el
> socio ve su propio historial). No las toqué; la RPC es SECURITY DEFINER.
>
> **Panel (paso 4):** `TabAcceso` ahora muestra un **selector de método** (radio
> único: Botón app / QR kiosco / Sin control, + QR lector físico y Molinete
> biométrico deshabilitados con badge "Requiere integración") que guarda
> `empresa.metodo_checkin`, y un campo **PIN del kiosco** (4–8 dígitos, solo visible
> con qr_kiosco) que guarda `empresa.pin_kiosco`. El bootstrap ya expone ambos.
>
> **Probado E2E contra BD** (socia real Nora Castillo en MaximusGym): entrada
> permitida ✓, mismo QR rechazado (anti-replay) ✓, 2º QR fresco → salida (toggle)
> ✓, QR vencido rechazado ✓, QR de otra empresa rechazado ✓, formato basura
> rechazado ✓ (6/6). Datos de prueba limpiados.
>
> **Falta (Fase 2, solo diseñado):** `empresa_api_key` + `POST /api/checkin/hardware`
> para lectores/molinetes sin sesión — se implementa cuando tengan el hardware.

Actualizado: 2026-07-09 (PEDIDO 16 pasos 2-4 cerrados).

> ### ✅ PEDIDO 15 — FASE 1 CERRADA (2026-07-09): webhook probado, ciclo completo
> Probado el `webhook` E2E (simulando el pago aprobado de MP sobre un pago real
> registrado): **pago pendiente → aprobado, membresía renovada +1 mes, ingreso
> en caja**. El ciclo de pagos in-app funciona de punta a punta.
>
> 🐛 **BUG encontrado y corregido al probar:** el webhook renueva con
> `metodo_pago='mercadopago'`, pero el CHECK de `movimiento_financiero` NO lo
> permitía (solo efectivo/yape/plin/tarjeta/transferencia/otro) → el webhook
> FALLABA al registrar el ingreso, es decir **ningún pago por app habría
> renovado la membresía en producción.** Corregido: `20260706000015` agrega
> 'mercadopago' y 'culqi' al constraint.
>
> **Nota sobre sandbox:** el OAuth de MP devuelve tokens de PRODUCCIÓN
> (`APP_USR-`) incluso para el vendedor de prueba, así que el checkout rechaza
> tarjetas de test. Para producción real esto es correcto; la prueba del split
> (marketplace_fee 3%) y del webhook (renovación) ya está verificada.
>
> **RESUMEN FASE 1 — TODO listo del lado backend/panel:**
>   1. ✅ BD (empresa_mp, pago_app, producto.visible_en_app)
>   2. ✅ 4 endpoints api/mp/ desplegados
>   3. ✅ OAuth del gym (conecta su cuenta MP)
>   4. ✅ crear-pago con split 97/3
>   5. ✅ webhook (renueva membresía / venta kardex / socio nuevo pendiente)
>
> **Falta (otras sesiones):** app Fase 1.b (botón Renovar → crear-pago), panel
> "Pagos por activar" (Fase 1.d), integración SEE facturación (Fase 1.c),
> selector "Conectar cobros" en Config del gym.

> ### ✅ PANEL FASE 1 COMPLETA (2026-07-09): Cobros + Pagos por activar + andamiaje SEE
> Se cerró TODO lo del panel que faltaba de Fase 1 (probado E2E, desplegado):
>
> **1.d.i — "Conectar cobros" (Config → Cobros 💰):** tab nuevo `TabCobros`.
>   - Botón "Conectar con MercadoPago" → `/api/mp/oauth-start` → redirige a MP.
>   - Al volver (`?tab=cobros&mp=conectado|error`) muestra el resultado.
>   - Estado de conexión vía RPC `estado_cobros_mp()` (SECURITY DEFINER, NUNCA
>     expone los tokens — `empresa_mp` tiene RLS cerrado). Solo admin.
>   - "Desconectar cobros" → `desconectar_cobros_mp()`.
>   - El callback ahora vuelve a `/configuracion?tab=cobros` (antes `/portal`).
>
> **1.d.ii — "Pagos por activar" (misma pestaña):** lista los pagos de app
>   aprobados de socios NUEVOS (`estado_activacion='pendiente_activacion'`).
>   - RPC `pagos_por_activar()` (lista) + `activar_pago_app(pago_id, sede?, plan?)`.
>   - Al activar: crea el socio + su membresía ya pagada. **NO duplica el ingreso
>     en caja** (el webhook ya lo registró al aprobarse el pago).
>   - Caso cubierto: si el documento YA existe como socio, reusa ese socio y le
>     **extiende** la membresía desde su fecha_fin (no crea duplicado; el índice
>     único `uq_socio_documento_empresa` lo habría rechazado).
>   - Probado E2E: lista → activar → socio creado + membresía, 0 movimientos
>     duplicados, pago marcado 'activado', re-activar rechazado.
>
> **1.c — Facturación SEE (andamiaje, sin proveedor aún):** decisión del owner =
>   dejar la arquitectura lista y enchufar el proveedor después.
>   - Tabla `empresa_facturacion` (ruc, serie, proveedor, credenciales secretas
>     con RLS cerrado igual que empresa_mp).
>   - `pago_app` + columnas `comprobante_estado/serie/numero/error`.
>   - RPCs `guardar_facturacion()`, `estado_facturacion()`, `preparar_comprobante()`.
>   - El **webhook** ya llama `preparar_comprobante` al aprobar: si el gym no
>     factura → marca `no_aplica`; si factura → deja el **punto de integración
>     HTTP marcado** para el POST al proveedor (Nubefact/Efact/…). La facturación
>     nunca tumba el webhook (try/catch). Idempotente. Probado E2E (4/4).
>
> **Migraciones:** `20260706000018_estado_cobros_mp.sql`,
> `20260706000019_pagos_por_activar.sql`,
> `20260706000020_facturacion_see_andamiaje.sql`.
>
> **Falta de Fase 1 (solo lado app / decisión externa):**
>   - App 1.b: botón "Renovar / Pagar" en la app del socio → `POST /api/mp/crear-pago`
>     (todo el backend listo para consumir; devuelve `init_point` para abrir MP).
>   - SEE 1.c: elegir proveedor y enchufar el POST (5 min, punto ya marcado).

Actualizado: 2026-07-09 (panel Fase 1 completa).

---

PEDIDO 17 -- Carnet del socio: ¿qué QR debe mostrar? (kiosco vs recepción manual)

De la sesión de la app (2026-07-09). Ya conectamos el modo kiosco a la RPC
`registrar_checkin` (CheckinRepositorio + feedback con nombre + PIN real desde
empresa.pin_kiosco). Todo compila y está pusheado. Pero surgió una duda de
convivencia que es de SU terreno:

**El carnet del socio muestra UN solo QR.** Hoy muestra `qr.qr` (el `mi_qr`
FIRMADO que ustedes emiten). Vimos que existen DOS validadores:
  - `validar_qr(p_qr, p_sede_id)` → recepción manual (checkin_manual), usa el QR firmado.
  - `registrar_checkin(token)` → modo kiosco nuevo, espera `v1|usuario_id|empresa_id|emitidoEnMs`.

Si cambiamos el carnet al token `v1`, el kiosco funcionaría pero **podríamos
romper la recepción manual** (que usa el QR firmado). Si lo dejamos como está,
la recepción manual sigue bien pero **el kiosco no puede leer el carnet estándar
del socio**.

**Pregunta concreta — ¿cuál de estas prefieren?**
  A) El carnet muestra el token `v1` y `validar_qr` también aprende a validar
     `v1` (unifican en el backend). La app solo cambia a generar `v1`.
  B) El carnet sigue mostrando el QR firmado `mi_qr`, y `registrar_checkin`
     aprende a validar TAMBIÉN el `mi_qr` firmado (además del `v1`). La app NO
     cambia el carnet.
  C) Otra cosa que propongan.

**Dato técnico para la app:** si vamos por (A), el token `v1` necesita el
**`usuario_id`** (no el `socio_id`). El bootstrap del socio (`get_mi_app_bootstrap`)
hoy NO trae `usuario_id` — lo sacaríamos de la sesión de auth (`auth.currentUserOrNull().id`).
Si prefieren, expónganlo en el bootstrap del socio para no depender de eso.

Mientras deciden, dejamos el carnet como está (recepción manual intacta). El
resto del kiosco ya quedó cableado.

Creado: 2026-07-09 (sesión de la app).

> ### ✅ RESPUESTA DEL PANEL (2026-07-09) — PEDIDO 17 RESUELTO: opción (B)
> **Decisión del owner: opción (B).** El carnet **NO cambia** — sigue mostrando
> el QR firmado `mi_qr` (`FC1.socio.empresa.exp.firma`). En vez de tocar la app,
> **`registrar_checkin` ahora valida TAMBIÉN el `FC1` firmado** (migración
> `20260706000017_registrar_checkin_qr_firmado.sql`, aplicada y probada).
>
> **Un solo carnet para todo:**
>   - Recepción manual → `validar_qr` (sin cambios, intacta) ✓
>   - Kiosco (app) → `registrar_checkin` ahora lee el mismo `FC1` ✓
>   - Ganamos la **firma HMAC real** (más seguro que el `v1` plano).
>
> **Detalles de la implementación:**
>   - `registrar_checkin` detecta el formato por prefijo: `FC1.` (firmado) o
>     `v1|` (plano, se conserva para staff/legado). Ambos siguen funcionando.
>   - Firma del `FC1` verificada con el MISMO esquema que `validar_qr`
>     (`extensions.hmac` contra `privado.secreto.qr_secret`).
>   - **Anti-replay del `FC1`**: como el carnet firmado dura 7 días (no rota cada
>     60 s), no se puede usar unicidad del token. Usamos un **debounce de 8 s**:
>     un segundo escaneo del mismo socio en <8 s devuelve `{ ..., repetido: true }`
>     sin duplicar el registro (evita doble-scan accidental), pero permite
>     entrada y luego salida legítimas. El `v1` mantiene su anti-replay estricto.
>
> **La app NO necesita cambiar nada.** El carnet sigue mostrando `qr.qr` como
> hoy. Opcional: si quieren manejar el caso `repetido: true` en el feedback del
> kiosco ("Ya registrado hace un momento"), el campo viene en la respuesta; si lo
> ignoran, se ve como una entrada/salida normal.
>
> **Probado E2E** con un `FC1` generado por `mi_qr` real (Nora Castillo):
> entrada permitida ✓, doble-scan → repetido sin duplicar ✓, firma adulterada
> rechazada ✓, QR expirado rechazado ✓, `v1` sigue funcionando ✓ (5/5).
> `validar_qr` (recepción) verificada intacta.

Actualizado: 2026-07-09 (PEDIDO 17 resuelto por el panel).

---

PEDIDO 19 -- 🐛 La tienda del socio sale VACÍA: el socio no puede leer `producto`

Al probar la tienda en la app (MaximusGym con cobros activados), el catálogo sale
vacío. Diagnóstico desde la app: **el socio NO tiene RLS para leer la tabla
`producto`** (revisé las migraciones: no hay ninguna policy sobre `producto` para
el rol socio). El PEDIDO 18 decía "RLS del socio ya permite leer productos de su
empresa", pero en el código no existe esa policy → el `select` del socio devuelve
0 filas sin error (RLS filtra en silencio).

**Lo que necesito (elijan uno):**
  A) **RPC `catalogo_app(p_empresa_id uuid, p_sede_id uuid)`** SECURITY DEFINER
     (Recomendado). Devuelve las columnas
     `id, nombre, categoria, precio, imagen_url, descripcion` de los productos
     `visible_en_app = true` y `activo` y `deleted_at is null` con **stock > 0**
     en `inventario_sede` de esa sede. Grant execute to authenticated. Esto
     además resuelve el filtro de stock que quedó pendiente. **La app YA la llama**
     (con fallback al select directo), así que en cuanto exista, la tienda se
     llena sola.
  B) O una **policy RLS** que permita al socio (autenticado, de esa empresa) leer
     `producto` con `visible_en_app = true`. Si van por aquí, avísenme el nombre.

La app ya está preparada para (A): llama `catalogo_app(p_empresa_id, p_sede_id)`
y, si no existe, cae al select directo. Con (A) creada, funciona sin tocar la app.

Nota: `catalogo_app` NO debe exponer stock exacto (solo listar lo que tiene
stock). El precio/monto lo valida `crear-pago` server-side igual que hoy.

Creado: 2026-07-09 (sesión de la app).

---

PEDIDO 20 -- 🐛 Pago de producto APROBADO pero el webhook NO descontó el stock

El flujo de compra desde la app funciona: el socio abre el checkout de MercadoPago
y **paga de verdad** (aprobado). PERO el stock del kardex NO baja y la venta no
aparece como "por entregar" en recepción. El webhook (api/mp/webhook.js) tiene el
código correcto (registrar_mov_inventario 'venta' + estado_activacion=
'pendiente_activacion'), así que el problema es que **el webhook no se ejecutó o
falló** — no llegó la notificación de MP, o falló al procesarla.

**Datos del pago real para rastrear (prueba E2E del owner, 2026-07-09):**
- Producto: Agua mineral 625 ml — S/ 3, en MaximusGym.
- Comprador/socio: jonathan.joan.avila@gmail.com (Jonathan Avila).
- Vendedor (gym MP): Jonathan Huamolle, ID comerciante 69008504.
- **N.º de operación MP: 168051294672**. Aprobado 9 jul 17:28. Interbank Débito.
- El split operó: total S/3, comisión MP -S/1,30, el gym recibió S/1,70.

**Qué revisar en el panel/backend:**
1. ¿MercadoPago llamó a `${PANEL_URL}/api/mp/webhook`? Verificar que `PANEL_URL`
   en Vercel apunte a la URL pública real (¿es app.fitcorecenter.com?). Si
   `notification_url` está mal, MP nunca avisa → stock no baja.
2. ¿La app de MP tiene el webhook configurado y la `notification_url` se acepta?
   (a veces MP exige la URL registrada en el panel de MP Developers).
3. Revisar logs del webhook en Vercel para ese pago (external_reference =
   pago_app.id): ¿se ejecutó? ¿falló registrar_mov_inventario?
4. Verificar en `pago_app` el estado del pago con operación 168051294672:
   ¿quedó en 'pendiente' (webhook no llegó) o 'aprobado' pero sin descuento?

Esto es 100% backend/panel: la app ya hizo su parte (checkout abierto, pago
aprobado). El descuento de stock + "por entregar" + que recepción marque
entregado ocurre en el webhook, no en la app.

**Del lado app (opcional, para UX):** cuando el socio vuelve del checkout por el
deep link, mostrar "✅ Compra lista, recoge en el gym" + código. Hoy la app abre
el checkout pero no procesa el retorno; se puede conectar cuando definan
estado-pago. No bloquea lo de arriba.

Creado: 2026-07-09 (sesión de la app, con pago real de prueba).

> ### ✅ RESUELTO por el panel (2026-07-09) — era el token equivocado
> **Causa raíz encontrada:** el webhook leía el payment con `MP_ACCESS_TOKEN`
> (token de FitCore/marketplace), pero en un pago con SPLIT el payment vive en la
> cuenta DEL GYM. Resultado: `GET /v1/payments/168051294672` daba **404 Payment
> not found** con el token de FitCore → el webhook salía en la línea `if
> (!mpPay?.id) return 200` sin descontar stock. Confirmado en vivo: 404 con token
> FitCore, 200 con token del gym.
> **Fix (desplegado):** el webhook ahora intenta con el token de FitCore y, si da
> 404, recorre los tokens de los gyms conectados (`empresa_mp`) hasta resolver el
> payment y su `external_reference`. Los pagos futuros se procesan solos.
> **Tu pago real reparado:** agua S/3 → aprobado, stock 21→20, ahora "por
> entregar" en Kardex. (Había un 2º pago pendiente de las 21:59 que quedó sin
> confirmar — si también lo pagaste, avisar para repararlo; no se tocó por no
> tener confirmación de pago.)
> `PANEL_URL` estaba bien (`https://app.fitcorecenter.com`) y el webhook responde
> 200 — no era eso. Era el token.

---

PEDIDO 21 -- Conectar cobros: forzar el SELECTOR de cuenta en el OAuth de MP

Problema (reportado por el owner al probar): al desconectar y volver a "Conectar
cobros", MercadoPago usa **la sesión activa del navegador** y vincula la cuenta
automáticamente, SIN preguntar cuál usar. En producción cada dueño de gym conecta
su propia cuenta MP; hay que evitar que se conecte la equivocada por error.

`api/mp/oauth-start.js` hoy arma la URL de authorization así (sin forzar login):
```
https://auth.mercadopago.com/authorization
  ?client_id=...&response_type=code&platform_id=mp&redirect_uri=...
```

**Qué se pide:** hacer que el flujo SIEMPRE muestre login/selector de cuenta,
sin importar la sesión activa. Opciones a evaluar (MP no tiene un `prompt=
select_account` como Google, así que suele resolverse con uno de estos):
  - Anteponer un **logout de MP** antes de la authorization (redirigir por
    `https://www.mercadopago.com/logout` o el endpoint de logout de MP y de ahí
    a la authorization), para que no reuse la sesión.
  - O documentar en el panel/UX que "Conectar cobros" se haga en ventana de
    incógnito / cerrando sesión de MP primero (workaround, menos ideal).
  - Revisar en la doc de OAuth de MP si su authorization admite algún parámetro
    para forzar re-login.

Impacto: importante en producción (multi-gym). No bloquea la app; es del panel.
Mientras tanto el owner prueba con incógnito.

Creado: 2026-07-09 (sesión de la app).

---

PEDIDO 22 -- 3 RPCs para el tab "Hoy" del entrenador en la app

La app agrega un tab "Hoy" al entrenador (trabajo diario en un vistazo). Diseño:
controlgym-app/docs/superpowers/specs/2026-07-09-trainer-tab-hoy-design.md.
Las tarjetas son defensivas: si la RPC no existe, la tarjeta simplemente no
aparece — así la app ya lanza el tab con la parte que sí tiene datos (bandeja de
ayuda, que ya funciona). Estas 3 RPCs enriquecen el resto cuando puedan.

Todas: SECURITY DEFINER, grant execute to authenticated, scope al gym del staff
(solo su empresa; validar que auth.uid() sea staff de p_empresa_id). Devuelven
jsonb (la app decodifica con decodeAs, como catalogo_app).

1) resumen_dia_trainer(p_empresa_id uuid) → jsonb
   { presentes_hoy, socios_activos, adherencia_promedio, entrenaron_hoy }
   - presentes_hoy: socios con checkin HOY en el gym.
   - socios_activos: socios con estado activo / membresía vigente.
   - adherencia_promedio: % promedio del gym (rango sugerido últimos 14 días;
     el panel define la fórmula exacta, misma base que el semáforo del socio).
   - entrenaron_hoy: registros de entreno de HOY (registro_entreno).

2) cargas_pendientes_gym(p_empresa_id uuid) → jsonb array
   [{ socio_id, socio_nombre, ejercicio, carga_pedida }, ...]
   - Las solicitudes de subir carga de TODO el gym que esperan veredicto del
     trainer (hoy la app solo las ve entrando a la ficha de cada socio, con
     SolicitudesRepositorio.pendientesDe(socioId)). Esto es la versión global.

3) socios_en_riesgo(p_empresa_id uuid, p_dias int) → jsonb array
   [{ socio_id, nombre, dias_sin_venir }, ...]
   - Socios activos (membresía vigente) que NO tienen checkin en los últimos
     p_dias días (la app llama con p_dias=7). Usa la tabla `checkin`.
   - Ordenar por dias_sin_venir DESC (los más "fríos" primero).
   - Solo aplica si el gym controla acceso (carnet QR). Si el gym no usa checkin,
     puede devolver [] y la app oculta la tarjeta.

Impacto: mejora de UX del trainer, no bloqueante. La app ya construye el tab con
lo que hay; estas RPCs lo completan. Es tarea del panel/backend.

Creado: 2026-07-09 (sesión de la app).

---

PEDIDO 23 -- Ofertas / descuentos en productos de la tienda

El gym pone un producto en oferta (descuento PERMANENTE, en % o monto fijo). La
app lo muestra (precio tachado + final + badge); el backend calcula y cobra el
precio con descuento (la app NUNCA decide el monto — seguridad). Diseño:
controlgym-app/docs/superpowers/specs/2026-07-09-ofertas-productos-design.md.

Solo por PRODUCTO individual (no por categoría), permanente (sin fechas).

1) Columnas en producto (migración):
```sql
alter table public.producto
  add column if not exists descuento_tipo  text,      -- 'porcentaje' | 'monto' | null
  add column if not exists descuento_valor numeric;   -- 15 (=15%) o 20 (=S/20)
```
   En oferta = descuento_tipo in ('porcentaje','monto') y descuento_valor > 0.
   Precio efectivo (server-side):
   - porcentaje: round(precio*(1 - valor/100), 2)
   - monto:      max(0, round(precio - valor, 2))

2) UI en el KARDEX del panel: por producto, elegir tipo (% o monto) + valor, o
   "sin oferta". (Junto al toggle visible_en_app que ya existe.)

3) `catalogo_app`: agregar al jsonb de cada producto:
   `precio_final` (el efectivo calculado) + `descuento_tipo` + `descuento_valor`.
   La app los lee (campos nullable; si no vienen, muestra sin oferta).

4) `crear-pago`: al calcular el monto de cada línea de producto, usar el PRECIO
   EFECTIVO (con descuento) en vez de p.precio directo. Hoy usa
   `precioUnit = Number(p.precio)`; debe aplicar el descuento del producto ahí,
   server-side. Así el socio paga el precio con oferta sin que la app lo mande.

Impacto: mejora de la tienda, no bloqueante. La app ya está preparada (campos
defensivos): si el backend no manda descuento, se ve como hoy. Es tarea del
panel/backend.

Creado: 2026-07-09 (sesión de la app).

---

PEDIDO 24 -- Subir la comisión de FitCore de 3% a 5% (decisión del owner)

Cambio de negocio: la comisión de FitCore (marketplace_fee) pasa de 3% a 5%.
En `api/mp/crear-pago.js`: `const COMISION = 0.03` → `0.05`. Actualizar también
los comentarios ("3% para FitCore" → "5%"). Es 1 línea + comentarios.

Contexto (para el mensaje a los gyms): sigue siendo modelo simple, un solo % sin
fijo. MercadoPago cobra su ~5.3% aparte (pasarela). El owner mantiene el discurso
honesto: "FitCore 5%, MercadoPago aparte, recibes el resto al instante".

No afecta la app (solo manda producto_id+cantidad; el backend calcula el fee).
Tarea del panel/backend.

---

PEDIDO 25 -- Dashboard de super-admin FitCore (NO es de la app — es del panel)

⚠️ Esto NO es un pedido de la app al backend; es una feature PROPIA del panel
web. Lo dejo aquí solo para que el agente del panel lo tome. El owner quiere un
dashboard de plataforma (solo para él, dueño de FitCore) para ver su negocio:
  - Total facturado en COMISIONES (el 5% acumulado, por periodo).
  - Nº de gyms activos / con cobros conectados.
  - Ventas totales procesadas por app (membresías + productos), por gym.
  - Idealmente ligado a la cuenta MercadoPago de plataforma (el MP_ACCESS_TOKEN)
    para conciliar lo que MP liberó como marketplace_fee.

Es una vista de super-admin en el PANEL web (no en la app móvil — se ve mejor en
pantalla grande, es herramienta de negocio del owner). Requiere: rol/acceso de
super-admin, consultas agregadas sobre pago_app (fee, estado, empresa), y quizás
la API de MercadoPago para el liberado real del fee.

Tarea 100% del panel. La app no participa.

Creado: 2026-07-09 (sesión de la app, canalizando pedidos del owner al panel).

---

PEDIDO 26 -- Sedes en el bootstrap del socio + AYUDA enrutada por sede

Del handoff de sedes del panel (arriba en este archivo) + decisiones del owner.
Diseño: controlgym-app/docs/superpowers/specs/2026-07-09-sedes-y-ayuda-por-sede-design.md

Decisiones del owner (para NO sobre-construir):
- El socio SOLO VE su sede en la app; NUNCA la cambia desde la app (recepción lo
  hace en el panel). → NO se necesita la RPC cambiar_mi_sede ni el selector.
- Trainers sin restricción de sede en la app.
- Las ayudas del socio deben llegar solo a los trainers de la sede donde el socio
  está. → esto es lo importante de este pedido.

1) BOOTSTRAP DEL SOCIO (`get_mi_app_bootstrap`): agregar dentro de cada `empresa`:
   - `restringe_sede` (bool, de empresa.restringe_sede).
   - `sede_nombre` (text, nombre de la sede del socio = sede de socio.sede_id).
   La app los lee para mostrar en el carnet "Válido en: <sede>" o "Válido en todas
   las sedes". Campos nullable/default → si no vienen, la app no muestra nada.

2) AYUDA ENRUTADA POR SEDE (lo grande):
   Hoy la ayuda del socio llega a TODOS los trainers presentes del gym. En gyms
   multi-sede eso es un problema. Nueva lógica (toda en el backend):
   - Si el gym usa control de acceso (metodo_checkin qr_kiosco/qr_lector/
     biometrico): la ayuda va SOLO a los trainers PRESENTES cuyo check-in de hoy
     es en la sede donde el socio está.
     • Sede del TRAINER = su check-in de INGRESO de hoy (tabla checkin).
     • Sede del SOCIO   = su check-in de hoy; si no marcó, socio.sede_id.
   - Si el gym NO usa control de acceso: la ayuda va a TODOS (como hoy).
   Implementar en: (a) la bandeja de ayudas del trainer — que venga filtrada por
   su sede desde el servidor (RPC `bandeja_ayuda` o filtro en la lectura), la app
   la consume tal cual; y (b) el PUSH de ayuda — solo a los trainers de esa sede.

3) REGLA DE NEGOCIO: con control de acceso, el check-in de INGRESO del trainer es
   OBLIGATORIO (es lo que determina su sede para dirigirle las ayudas). Reforzarlo
   en el panel/flujo del trainer.

Impacto: mejora clave para gyms multi-sede. La app casi no cambia (solo el
mensaje de sede en el carnet). El enrutamiento inteligente es 100% backend.

Creado: 2026-07-09 (sesión de la app).

> ### ✅ RESUELTO por el panel (2026-07-10) — partes 1 y 2
> **Parte 1 (bootstrap):** `get_mi_app_bootstrap` ya expone en cada `empresa`:
>   - `restringe_sede` (bool) y `sede_nombre` (nombre de la sede del socio).
>   La app los lee para el carnet ("Válido en: <sede>" o "todas las sedes").
>   Migración `20260710000002`. Probado (Nora → restringe_sede=false, sede_nombre="Sede Principal").
>
> **Parte 2 (ayuda enrutada por sede):** implementado 100% backend, la app casi
> no cambia:
>   - **Push:** el trigger `trg_solicitud_ayuda_alta` ahora usa
>     `trainers_para_ayuda(empresa, sede_del_socio)` → si el gym usa control de
>     acceso (qr_kiosco/qr_lector/biometrico), el push va SOLO a los trainers
>     presentes cuya sede de check-in de hoy = la del socio; si no, a todos.
>   - **Bandeja:** nueva RPC **`bandeja_ayuda()`** (sin args, usa la sesión del
>     trainer) que devuelve las ayudas `pendiente/en_camino` filtradas por SU sede
>     (su último check-in de entrada de hoy) cuando el gym usa control de acceso;
>     si no, todas. Migración `20260710000003`. **ACCIÓN APP:** migrar la lectura
>     de la bandeja de `from("solicitud_ayuda")` directo → `rpc("bandeja_ayuda")`.
>     Devuelve el mismo shape (id, motivo, ejercicio_nombre, ubicacion_texto,
>     mensaje_socio, estado, atendida_por, creado_at, sede_id, socio{nombre,codigo},
>     atiende{nombre}). Los estados activos siguen siendo pendiente/en_camino.
>
> **Sede del socio (para enrutar):** su check-in de entrada de hoy → si no marcó,
> `solicitud_ayuda.sede_id` → si no, `socio.sede_id`.
>
> **Parte 3 (check-in de ingreso obligatorio del trainer):** es regla de flujo/UX
> del panel — el check-in del trainer ya determina su sede; reforzar el recordatorio
> en el panel queda para una iteración de UX (no bloquea). El backend ya asume que
> la sede del trainer = su check-in de hoy (con fallback a asistencia_staff).
>
> **Owner decidió:** el socio NO cambia de sede desde la app (solo la ve). Por eso
> NO se creó `cambiar_mi_sede`. Recepción lo hace desde el panel (ya funciona).

---

PEDIDO 27 -- Exponer empresa.estado en el bootstrap (bloqueo suave del gym vencido)

La app implementa un bloqueo SUAVE: si el gym no está activo (dejó de pagar el
SaaS), su tarjeta en el home aparece atenuada + "No disponible" y al tocarla
muestra un aviso, sin dejar entrar. Los otros gyms del usuario siguen normal.
Diseño: controlgym-app/docs/superpowers/specs/2026-07-09-bloqueo-gym-vencido-design.md

Lo único que necesita la app del backend: **exponer `empresa.estado`** (ya existe:
'activa'|'suspendida'|'cancelada') en el bootstrap, en dos lugares:
  - `EmpresaAsociada` del staff (bootstrap general): agregar `estado`.
  - `empresa` del socio en `get_mi_app_bootstrap`: agregar `estado`.

La app lo lee como campo nullable: `activa = (estado == 'activa' o null)`. Si no
viene, todo funciona como hoy (defensivo). Suspendida y cancelada bloquean igual.

No hace falta nada más del backend: cuando el panel/cobros marque el gym como
suspendida/cancelada (eso ya lo maneja el SaaS), la app lo refleja sola al leer
el estado. Tarea chica del panel: solo agregar el campo al bootstrap.

Creado: 2026-07-09 (sesión de la app).

---

PEDIDO 28 -- Conectar el webhook de MercadoPago con NORAC (emisión de boleta SUNAT)

⚠️ NO es de la app; es backend/panel. La app no participa (solo abre el checkout).
Lo canaliza la sesión de la app porque el owner ya coordinó con el equipo de Norac.

CONTEXTO: cuando un socio compra un producto por app y el pago se aprueba, el gym
debe emitirle una BOLETA electrónica (SUNAT). El motor de facturación es NORAC
(sistema propio del owner), ya homologado en beta (ResponseCode 0). El webhook
`api/mp/webhook.js` YA tiene el punto de integración preparado (Fase 1.c:
`preparar_comprobante` devuelve { serie, monto, igv_incluido, concepto,
cliente_nombre, cliente_doc, ... } y hay un `// PUNTO DE INTEGRACIÓN DEL
PROVEEDOR SEE` con console.log). Falta ENCHUFAR Norac ahí.

API DE NORAC (guía completa: norac-facturacion/docs/API.md):
- Base URL: https://norac-facturacion.onrender.com
- Auth: JWT (POST /api/auth/login o /api/auth/google) + header `X-Company-Id:
  <company_id>`.
- Emitir: `POST /api/emit`
  {
    "tipo": "03",                    // 03 boleta (01 factura si el socio da RUC)
    "serie": "B001",
    "fecha_emision": "2026-07-10",
    "receptor": { "tipo_doc": "1", "num_doc": "<DNI socio>",
                  "razon_social": "<nombre socio>", "email": "<email socio>" },
    "lineas": [ { "descripcion": "<producto>", "cantidad": "1",
                  "valor_unitario": "<precio sin IGV>", "afectacion_igv": "10" } ]
  }
  → { id, numero:"B001-00000012", estado:"accepted", importe_total, igv, ... }
  IMPORTANTE: Norac ENVÍA la boleta por email al `receptor.email` (ya lo resolvió
  el equipo de Norac). Así que FitCore NO necesita mandar el correo — solo pasar
  el email del socio en el receptor.

LO QUE TOCA HACER EN EL PANEL:
1. Mapeo `empresa_fitcore → company_id_norac` (cada gym es una empresa en Norac
   con su propio certificado SUNAT). Guardar el company_id de Norac por gym
   (p. ej. una columna `empresa.norac_company_id` o tabla puente). Solo los gyms
   que facturan lo tendrán.
2. En el webhook, tras `preparar_comprobante` con `info.emitir = true`: llamar a
   `POST /api/emit` de Norac con auth (token de servicio de Norac + X-Company-Id
   del gym) y el body de arriba (mapear cliente_nombre/doc/email + líneas del
   carrito: producto, cantidad, valor_unitario SIN IGV, afectacion_igv=10).
3. Guardar la respuesta: `update pago_app set comprobante_estado='emitido',
   comprobante_numero=<numero>, comprobante_id_norac=<id>` (y opcional
   comprobante_url si se quiere link al PDF: GET /api/documents/{id}/pdf).
4. La facturación NUNCA debe tumbar el webhook (el pago ya es válido) — envolver
   en try/catch y dejar log si Norac falla; reintentar aparte.

DATOS QUE NORAC NECESITA Y HAY QUE ASEGURAR EN EL PAGO:
- DNI del socio (num_doc) + nombre + EMAIL (para que Norac lo mande). Hoy
  preparar_comprobante ya da cliente_nombre/cliente_doc; agregar el EMAIL del
  socio si no viene.
- Por línea: valor_unitario SIN IGV (Norac calcula el IGV). Hoy los precios de
  producto son CON IGV incluido → dividir /1.18 al armar la línea (o mandar el
  neto). Confirmar con Norac si prefiere bruto+afectación o neto.

CREDENCIALES: el owner debe cargar en Norac (por cada gym que facture) su
certificado .pfx + Clave SOL y poner sunat_mode=production
(POST /api/config/certificate + PUT /api/config/sunat). Sin eso Norac no emite
válido. A FUTURO Norac será PSE/OSE → el gym ya no cargará certificado (más
simple); el contrato de /api/emit no cambia.

Impacto: cierra el ciclo de venta (pago → stock → boleta SUNAT al socio por
email). No bloquea la app. 100% panel/backend + config del owner en Norac.

Creado: 2026-07-10 (sesión de la app, canalizando la integración FitCore↔Norac).
