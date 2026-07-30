# Vinculación segura al gym + rutina portable + historial para el trainer — Diseño

**Fecha:** 2026-07-30 · **Repos:** ControlGym (backend + panel) y controlgym-app (KMP)
**Regla:** sin tag/release; el owner prueba en emulador.

## Contexto verificado
- `vincular_socio()` (versión vigente `20260717100005_vincular_socio_gate_y_objetivo.sql:25-31`) es el ÚNICO escritor de `socio.usuario_id`. Matchea por **email** (lower) o **teléfono** normalizado (≥9 dígitos), gateado por `sede_con_app(sede_id)`. Idempotente y multi-gym. Se llama sola al abrir la app (`SocioAppViewModel.recargar()`).
- Si no matchea: `get_mi_app_bootstrap` devuelve `gimnasios: []` → la app trata al usuario como libre, **sin ningún aviso**. No hay match por documento ni forma manual de reparar.
- `usuario.documento` existe y se propaga al socio, pero NO participa del match.
- Rutina portable: `adoptar_rutina_del_gym()`, `llevar_rutina_del_gym()`, `importar_mi_rutina_al_gym(empresa)` existen COMPLETAS con grants (`20260721111000_rutina_portable.sql`) pero **cero llamadas** desde app o panel.
- Historial: `mi_historial_ejercicio`/`mi_resumen_progreso` (20260730130000) YA unen libre+gym por `catalogo_id` para el propio usuario. Pero `progreso_socio` y `analizar_progresion_socio` (las del trainer) leen SOLO `registro_entreno_ejercicio` — el trainer no ve el periodo libre.
- Prediseñadas: con rutina activa no hay acceso directo a la galería; solo vía rehacer → wizard → "En casa" (que además filtra a peso corporal).

## Decisiones del owner
- (a) Vincular por DNI **con aprobación del gym**. El owner señaló el riesgo real: si bastara el DNI, cualquiera podría poner el DNI de un socio sin app y suplantarlo. Por eso: solicitud pendiente → recepción aprueba/rechaza.
- (b) El usuario ELIGE su rutina, con aviso claro.
- (c) El trainer ve el historial completo del socio, incluido el previo (es su gym).
- (d) Acceso directo a prediseñadas con rutina activa.

---

## BLOQUE A — Vinculación por DNI con aprobación del gym

### A1. Backend
Tabla nueva `solicitud_vinculacion`:
- `id, usuario_id (auth.uid), socio_id, empresa_id, documento_usado text, estado ('pendiente'|'aprobada'|'rechazada'), creado_at, resuelto_at, resuelto_por`
- Unique parcial: una solicitud `pendiente` por (usuario_id, socio_id).
- RLS: el usuario ve/crea las suyas; el staff de la empresa ve/resuelve las de su empresa.

RPCs:
- `solicitar_vinculacion_por_documento(p_documento text) → jsonb`
  - Normaliza el documento; busca `socio` con ese documento, `usuario_id is null`, `deleted_at is null`, en sede con app.
  - **NO vincula**: crea `solicitud_vinculacion` en estado `pendiente` y devuelve `{ok:true, estado:'pendiente', gym:<nombre>}`.
  - Si no hay socio con ese documento → `{ok:false, motivo:'no_encontrado'}` (mensaje neutro, sin revelar si el documento existe — evita enumeración).
  - Si ya hay solicitud pendiente → devuelve la existente (idempotente).
  - Guarda el documento en `usuario.documento` (para futuros matches automáticos legítimos).
- `solicitudes_vinculacion_pendientes() → jsonb` (staff): lista las de su empresa con datos del socio y del solicitante (nombre, email del usuario) para que recepción decida.
- `resolver_vinculacion(p_solicitud_id uuid, p_aprobar boolean) → jsonb` (staff, valida `auth_empresa_id()`): si aprueba, setea `socio.usuario_id = solicitud.usuario_id` (solo si sigue null) y marca la solicitud; si rechaza, solo marca. Registra `resuelto_por`.

Seguridad: `solicitar_*` es del usuario; `solicitudes_*`/`resolver_*` solo staff de esa empresa. Nunca se vincula sin aprobación humana.

### A2. App
- Perfil: campo **documento (DNI)** con nota clara: "Si tu gimnasio te registró, agrega tu DNI para vincular tu cuenta."
- Si `gimnasios` viene vacío Y el usuario tiene documento: mostrar un aviso/tarjeta "¿Te inscribiste en un gimnasio? Pide vincular tu cuenta" → botón que llama `solicitar_vinculacion_por_documento`.
- Estado pendiente visible: "Solicitud enviada a <gym>. Te avisaremos cuando la aprueben."
- Si no tiene documento: el aviso pide llenarlo primero.

### A3. Panel
- Vista/sección "Solicitudes de vinculación" (donde encaje con Clientes/Socios): lista de pendientes con nombre del socio, documento, y datos de la cuenta que solicita (nombre/email) para que recepción compare. Botones Aprobar / Rechazar → `resolver_vinculacion`.
- Badge/contador si hay pendientes.

---

## BLOQUE B — Rutina portable con elección del usuario

Backend ya listo (las 3 RPCs). Falta cliente:
- `RutinaLibreRepositorio` (o repo del socio): métodos `adoptarRutinaDelGym()`, `llevarRutinaDelGym()`, `importarMiRutinaAlGym(empresaId)`.
- **Aviso al detectar las dos**: cuando el usuario tiene rutina libre activa Y su gym le asignó una, mostrar una tarjeta clara (no un diálogo intrusivo) con 3 acciones:
  - "Usar la rutina de <gym>" → `llevar_rutina_del_gym()` (reemplaza la libre por la del gym)
  - "Seguir con la mía" → descarta el aviso (no hace nada)
  - "Llevar la mía al gym" → `importar_mi_rutina_al_gym(empresa)` (el trainer la ve y puede ajustarla)
- Etiquetar de dónde viene cada rutina ("Mi rutina" vs "Rutina de <gym>") para que nunca haya ambigüedad.
- `importar_mi_rutina_al_gym` devuelve `sugerencias_carga` — mostrarlas si vienen (informativas).

---

## BLOQUE C — El trainer ve el historial completo

- `progreso_socio(p_socio_id)`: añadir la fuente `registro_entreno_libre` del `usuario_id` del socio (vía `socio.usuario_id`), unida por `catalogo_id`, para adherencia y carga por ejercicio. Solo si el socio está vinculado (tiene `usuario_id`).
- `analizar_progresion_socio(p_socio_id)`: hoy se ata a `rutina_ejercicio_id` de la rutina activa; ampliar para que cruce por `catalogo_id` e incluya el historial libre. **Bonus verificado**: como las FK al slot ahora son `on delete set null`, los registros de rutinas viejas del gym quedaban invisibles — cruzar por `catalogo_id` también los recupera.
- Mantener el gate por `auth_empresa_id()` (el trainer solo ve socios de su empresa).
- El panel no necesita cambios de UI: las mismas pantallas mostrarán más datos.

---

## BLOQUE D — Acceso directo a prediseñadas

- En `PantallaRutinaLibre` con rutina activa, agregar una entrada a la galería de prediseñadas (junto a "Editar mis días" / "Cambiar objetivo"), SIN pasar por rehacer el wizard.
- `PantallaRutinasPredisenadas` ya acepta `equipoFiltro`: al entrar desde aquí, no forzar peso corporal — mostrar todas (o filtrar por el equipo de la rutina actual, que ya se persiste).
- Adoptar una prediseñada reemplaza la rutina activa (ya lo hace `adoptar_rutina_predisenada`); avisar al usuario antes.

---

## Verificación
- Backend: cada migración probada en transacción rollback contra prod con sesión authenticated real; verificar aislamiento (un usuario no resuelve solicitudes de otra empresa; no se vincula sin aprobación).
- **Prueba de seguridad explícita**: `solicitar_vinculacion_por_documento` NO debe vincular directamente; comprobar que `socio.usuario_id` sigue null hasta que un staff aprueba.
- App: `compileCommonMainKotlinMetadata` + `:composeApp:compileDebugKotlinAndroid`.
- Panel: `npm test` + `npm run build`.
- Sin tag. Owner prueba en emulador.

## Fuera de alcance
- Vinculación por código generado por el gym (se eligió aprobación de solicitud).
- Subida de archivos de video (se mantiene pegar links).
