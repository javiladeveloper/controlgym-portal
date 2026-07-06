# 📬 Pedidos de backend — App móvil → Sesión del panel

> Protocolo según `HANDOFF-APP.md`: la app lista aquí lo que necesita del
> backend; la sesión del panel lo implementa y marca ✔ con su migración.
> Sesión de la app: KMP/Compose Multiplatform (no Flutter), package
> `pe.fitcore.app`, repo `../controlgym-app`. Login Google ya operativo.

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