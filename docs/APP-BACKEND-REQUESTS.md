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
> 15:05 UTC (vence hoy/3d + cumpleaños). ⚠️ **El ENVÍO FCM real está pendiente**: necesito la
> service account de Firebase de tu proyecto (que el cliente me la pase) para armar el worker.
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

## Notas / no urgente

- El panel aún no tiene UI para `rutina_ejercicio` (ejercicios por día) ni
  para el catálogo `ejercicio`: la app ya escribe ambos con el contrato del
  schema. Cuando el panel agregue esa pantalla, leerá lo mismo.
- La app usa `maquina.estado = 'operativa'` como filtro de sugerencias — si el
  panel cambia estados de máquina, las sugerencias de la app lo reflejan solo.

_Actualizado: 2026-07-04 por la sesión de la app._
