# Entrenamiento completo en la app: armador + progreso por ejercicio + cronómetro — Diseño

**Fecha:** 2026-07-30
**Repos:** controlgym-app (KMP) + ControlGym (backend Supabase)
**Regla operativa:** UN solo push al final, SIN tag/release. Owner aprueba en emulador.
**Principio rector:** UI/UX impecable — nada confuso, engorroso ni feo. Reusar componentes
que ya se ven bien; una pantalla = un propósito; jerarquía clara.

## Visión (owner)
La app debe RESOLVER el problema de quien va al gym y ayudarlo:
- El sistema recomienda/da rutinas por objetivo (ya existe), PERO además cada quien puede
  armar la suya: Día 1 Glúteos con los ejercicios que quiera, Día 2 otra cosa, etc.
- Mientras arma, el sistema SUGIERE ejercicios que encajan (ayuda, no ruido).
- Al marcar un ejercicio como hecho se lleva control por día; el progreso se muestra
  POR EJERCICIO y GENERAL. El historial de un ejercicio (p.ej. 20 registros) NO se pierde
  al cambiar ese ejercicio por otro ni al cambiar de rutina.
- Cronómetro de descanso dentro de la app: al terminar una serie, botón inicia la cuenta
  regresiva del descanso configurado; al llegar a 0 vibra y suena; botón para detener.
  El descanso es configurable por ejercicio al armar.

## Estado verificado (qué EXISTE vs qué falta)

**YA EXISTE (reusar, no recrear):**
- Cronómetro de descanso: `ui/entreno/TimerDescanso.kt` (`BarraDescanso`, `DescansoActivo`),
  parser `dominio/Descanso.kt` (`segundosDeDescanso`, testeado). Cableado SOLO en gym
  (`SocioAppViewModel.kt:630-646`, `PantallasSocio.kt:361-367`). Wake-lock `PantallaEncendida`.
- Vibración nativa: `ui/Vibracion.kt` (+.android/.ios), permiso VIBRATE en Manifest.
  DEFINIDA pero NUNCA invocada.
- Gráficas: `ui/componentes/GraficaLinea.kt`, `GraficaBarras.kt` (hoy solo peso corporal).
- Progresión por ejercicio (texto): `dominio/Progresion.kt`, `TarjetaProgresionFuerza`.
- Registro de entrenos con carga: `registro_entreno_libre` / `registro_entreno_ejercicio`
  (columnas `..._ejercicio_id` (SLOT), `fecha`, `completado`, `carga_usada`).
- RPCs: `marcar_entreno_libre/ejercicio`, `mi_progresion_libre/()`, `mi_adherencia_libre`,
  `analizar_progresion_socio` (serie cruda, solo staff), `progreso_socio`.
- Armador base ya diseñado (spec previo): tablas rutina_libre*, buscar_ejercicios_catalogo,
  EjercicioCatalogoItem, PantallaBiblioteca.
- Foto: bugs ya diagnosticados (EXIF + refresco de PerfilPersonalViewModel).

**HAY QUE CREAR / ARREGLAR (este proyecto):**
1. Historial por CATÁLOGO (el problema de los 20 registros).
2. RPCs del armador (crear vacía, +/- día, +/- ejercicio, editar, con descanso configurable).
3. Sugerencias mientras arma.
4. RPC de serie temporal por ejercicio (propia) + gráfico de evolución.
5. Cronómetro en rutina libre + conectar vibración + beep de fin.
6. Fix de foto (EXIF + no salir del perfil).

---

## BLOQUE 1 — Cimiento de datos: historial por catálogo (backend)

Problema: `registro_entreno_libre.rutina_libre_ejercicio_id` y
`registro_entreno_ejercicio.rutina_ejercicio_id` apuntan al SLOT; al regenerar/cambiar
rutina el slot se borra en cascada → historial perdido. El `catalogo_id` existe en las
tablas de slot pero NO se copia al registro.

**Solución (aditiva, no rompe lo actual):**
- `alter table registro_entreno_libre add column catalogo_id uuid references ejercicio_catalogo(id)`.
- `alter table registro_entreno_ejercicio add column catalogo_id uuid references ejercicio_catalogo(id)`.
  (En gym el ejercicio del slot es `ejercicio` con `ejercicio.catalogo_id`; se resuelve al marcar.)
- Backfill: poblar `catalogo_id` de los registros existentes cruzando por el slot mientras aún exista.
- `marcar_entreno_libre` y `marcar_entreno_ejercicio`: al hacer el upsert, resolver y guardar
  también `catalogo_id` (desde `rutina_libre_ejercicio.catalogo_id` / `ejercicio.catalogo_id`).
- El unique se mantiene por slot+fecha (el registro sigue anclado al día actual); el
  `catalogo_id` es el eje ESTABLE para el historial cruzando rutinas.
- Los registros SOBREVIVEN al cambiar de rutina (decisión del owner): cambiar el
  `on delete cascade` de la FK al slot por `on delete set null` (el registro persiste con su
  `catalogo_id` intacto, aunque el slot desaparezca). Así "todo lo que hice de Sentadilla" se
  reconstruye por catalogo_id para siempre, aunque la saque y la vuelva a poner en otra rutina.
- Registros sin catalogo_id (ejercicio manual fuera del catálogo): el owner eligió que TODOS los
  registros sobrevivan; los sin catalogo_id sobreviven igual (set null) pero no se cruzan entre
  rutinas (sin eje estable) — se muestran solo dentro de su rutina mientras exista.

## BLOQUE 2 — RPCs del armador de rutina propia (backend)

Todas security definer, aisladas por auth.uid(), respetando "1 activa por usuario".
- `crear_rutina_libre_vacia(p_nombre)` → rutina activa vacía + 1 día. Devuelve `_rutina_libre_detalle`.
- `agregar_dia_libre(p_rutina_id, p_foco)` → día al final (ej. "Día 2 — Glúteos"). Devuelve detalle.
- `quitar_dia_libre(p_dia_id)` → borra día (no permite 0 días). Devuelve detalle.
- `renombrar_dia_libre(p_dia_id, p_foco)` → cambia el foco del día ("Glúteos", "Pecho"…). Devuelve detalle.
- `agregar_ejercicio_libre(p_dia_id, p_catalogo_id, p_series, p_reps, p_descanso)` → inserta;
  nombre/media derivados del catálogo; orden = max+1. `p_descanso` es el tiempo configurable. Devuelve detalle.
- `quitar_ejercicio_libre(p_ejercicio_id)` → borra. Devuelve detalle.
- `editar_ejercicio_libre(p_ejercicio_id, p_series, p_reps, p_descanso)` → actualiza (incl. descanso). Devuelve detalle.
- `mover_ejercicio_libre(p_ejercicio_id, p_direccion)` → sube/baja orden (reordenar simple, no drag&drop). Devuelve detalle.
Validación de propiedad por join a rutina_libre.usuario_id = auth.uid() en cada una.

## BLOQUE 3 — Sugerencias mientras arma (backend + app)

- RPC `sugerir_ejercicios_para_dia(p_dia_id, p_limit)` → dado el foco/músculo del día y lo ya
  agregado, sugiere ejercicios del catálogo del mismo grupo muscular que faltan (excluye los ya
  puestos). Reusa la taxonomía target/body_part. Devuelve `[EjercicioCatalogoItem-like]`.
- Si el día tiene foco "Glúteos", sugiere ejercicios de glúteos; si está vacío, sugiere por el
  objetivo del usuario. UX: chips/carrusel "Sugeridos para este día" discretos, no intrusivos.

## BLOQUE 4 — Progreso por ejercicio (backend + app)

- RPC `mi_historial_ejercicio(p_catalogo_id)` → serie temporal del PROPIO usuario para ese
  ejercicio del catálogo, cruzando TODAS sus rutinas (libre y gym) vía `catalogo_id`:
  `{ ejercicio, sesiones:[{fecha, carga_usada, completado}], veces, carga_inicial, carga_actual, tendencia }`.
- RPC `mi_resumen_progreso()` → GENERAL, con los 4 elementos que pidió el owner:
  (a) racha/constancia (reusa TarjetaConstancia), (b) top ejercicios en progreso (donde más
  subió la carga, con tendencia), (c) volumen total movido (Σ series×reps×carga) en el tiempo,
  (d) peso corporal/medidas (reusa GraficaLinea de peso, ya existe).
- App: pantalla/sección de progreso que reusa `GraficaLinea` para dibujar la evolución de carga
  POR EJERCICIO (hoy solo se usa para peso corporal). Lista de ejercicios → toca uno → su gráfico
  + historial. Y un resumen general arriba. La rutina libre hoy NO tiene pantalla de progreso: se crea.
- "Por ejercicio Y por rutina": el gráfico por ejercicio es global (por catálogo); dentro de la
  rutina actual se muestra el avance del slot (lo que ya hace `TarjetaProgresionFuerza`).

## BLOQUE 5 — Cronómetro de descanso en rutina libre + vibración + beep (app)

- Reusar `BarraDescanso`/`DescansoActivo` (ya existe en gym) en la rutina libre:
  `RutinaLibreViewModel` gana estado `descansoActivo` y, al marcar un ejercicio como hecho,
  arranca el descanso con `segundosDeDescanso(ejercicio.descanso)`. Render con el mismo `BarraDescanso`.
- Conectar vibración: en `BarraDescanso`, cuando `restante <= 0`, invocar `recordarVibracion()`
  (existe, nunca se llama). Aplica tanto a gym como a libre.
- Beep de fin: crear `ui/SonidoFin.kt` expect/actual (Android `ToneGenerator`/`MediaPlayer`,
  iOS `AudioServicesPlaySystemSound`) siguiendo el patrón de `Vibracion.kt`. Sonar al llegar a 0.
- Botón para detener vibración/sonido: el `onTerminado`/cerrar del `BarraDescanso` corta ambos.
- Descanso configurable: ya viene del campo `descanso` del ejercicio (que el armador setea).

## BLOQUE 6 — Reubicar prediseñadas + limpiar UI (app)

- Quitar `EntradasCatalogoGlobal` (botones feos de arriba, `PantallaRutinaLibre.kt:160-163`).
- En el wizard, al elegir "En casa (peso corporal)": ofrecer prediseñadas de casa (filtro
  equipo='peso_corporal') Y la opción "Armar la mía" (→ armador). UX cuidada: una elección clara.
- `PredisenadasViewModel`/`PantallaRutinasPredisenadas`: parámetro `equipoFiltro`.

## BLOQUE 7 — Fix de foto (app)

- EXIF: `ComprimirImagen.android.kt` lee `ExifInterface(ORIENTATION)` de los bytes originales y
  aplica `Matrix` (rotación + flip frontal) antes de escalar/comprimir. Dep `androidx.exifinterface`.
- No salir del perfil: tras `subirFoto` OK, refrescar `PerfilPersonalViewModel` (recargar `miPerfil`)
  para pintar la foto nueva; loader `subiendoFoto` en la tarjeta; no llamar bootstrap completo.

---

## Verificación
- Backend: cada migración (bloques 1-4) probada en transacción rollback contra prod, con sesión
  authenticated real (rol authenticated + jwt claim) para RLS/auth.uid(). Aislamiento verificado.
  Historial: probar que tras "regenerar rutina" un registro con catalogo_id sobrevive.
- App: `compileCommonMainKotlinMetadata` + `:composeApp:compileDebugKotlinAndroid` limpios.
- UX: cada pantalla nueva se construye reusando componentes existentes y con jerarquía clara;
  usar frontend-design para las pantallas de armador y progreso.
- UN push a ambos repos SIN tag. Owner prueba en emulador.

## Fuera de alcance (por ahora)
- Drag&drop de ejercicios (se hace subir/bajar simple).
- Panel web (esto es app + backend).
- Compartir rutinas entre usuarios.
