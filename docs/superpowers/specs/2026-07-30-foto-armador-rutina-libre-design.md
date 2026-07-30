# Ronda: fix foto socio + prediseñadas en wizard + armador de rutina propia — Diseño

**Fecha:** 2026-07-30
**Repos:** controlgym-app (app KMP) + ControlGym (backend Supabase)
**Regla operativa:** todo va SIN tag/release. El owner aprueba en el emulador.

## Contexto (verificado en código)

- **Foto socio**: la tarjeta `TarjetaMiFoto` (`PantallaPerfilSocio.kt:558-666`) se usa desde el Perfil del Home (`PantallaPerfilPersonal.kt:183-189`). La captura es expect/actual (`SelectorImagen.*`), cámara Android vía `PuenteCaptura.kt` (`TakePicture`). La compresión Android (`ComprimirImagen.android.kt:10-23`) NO lee EXIF ni rota. La subida (`FotoSocioRepositorio.subir`) va a Storage `branding` + RPC `subir_mi_foto`. La foto mostrada la sirve `PerfilPersonalViewModel` (`miPerfil()`), pero `subirFoto` vive en `SocioAppViewModel` → dos VMs distintos.
- **Rutina libre / wizard**: `WizardRutinaLibre.kt` tiene pasos nivel→días→equipo(→medidas). El equipo se elige en el paso 3 (`EquipoRutina.PESO_CORPORAL/MANCUERNAS/GYM_COMPLETO`). Los 2 botones "Rutinas listas / Explorar ejercicios" (`EntradasCatalogoGlobal`, `PantallaRutinaLibre.kt:160-163,251-270`) están arriba de todo (se ven feos/desordenados). `PantallaRutinasPredisenadas(onCerrar)` lista TODAS (VM hardcodea `cargar(null,null)`), pero el repo YA acepta `listar(categoria, equipo)`.
- **Armador**: NO existe ninguna RPC para agregar/quitar un ejercicio individual de una rutina libre — solo generación/clonación en bloque. Las tablas `rutina_libre/_dia/_ejercicio` tienen RLS por auth.uid() y grants de insert/update/delete a authenticated. `buscar_ejercicios_catalogo` + `EjercicioCatalogoItem` ya listan el catálogo.

## Decisiones del owner
- Prediseñadas aparecen SOLO al elegir "En casa (peso corporal)" en el wizard (no botones arriba).
- Biblioteca deja de ser solo-ver: el usuario puede **armar su propia rutina** (armador COMPLETO: varios días, agregar/quitar ejercicios, editar series/reps/descanso).
- Foto: loader en la tarjeta, sin salir del perfil, foto nueva aparece ahí mismo.
- jonathan.joan.avila ya quedó sin rutina activa (verificado: 0 activas; es modo libre puro).

---

## Parte 1 — Fix de foto (app, solo androidMain + perfil)

### 1a. Rotación EXIF (bug foto rotada)
`ComprimirImagen.android.kt`: antes de escalar/comprimir, leer la orientación EXIF de los bytes originales con `androidx.exifinterface.media.ExifInterface` sobre un `ByteArrayInputStream`, y aplicar `Matrix` (postRotate 90/180/270 + flip horizontal para el espejo de cámara frontal según `ORIENTATION_TRANSPOSE/TRANSVERSE/FLIP_*`). Luego escalar el bitmap ya rotado y comprimir. Añadir dependencia `androidx.exifinterface:exifinterface` si no está.

### 1b. Quedarse en el perfil + mostrar la foto nueva (bug rebote)
- Tras `subirFoto` con éxito, refrescar el ViewModel que pinta la foto: exponer un `refrescar()`/`recargarFoto()` en `PerfilPersonalViewModel` (recarga `miPerfil()`), e invocarlo desde el flujo de subida (bien vía callback `onFotoSubida`, bien haciendo que la tarjeta observe el `versionFoto` y dispare la recarga del perfil).
- El loader `subiendoFoto` (ya existe en `EstadoSocioApp`) se muestra en la tarjeta mientras sube. Al terminar, la nueva `fotoUrl` (con cache-buster `?v=versionFoto`) se pinta en la misma tarjeta.
- No forzar navegación al Home: el flujo de foto no debe llamar `recargar()`/`refrescarSilencioso()` del bootstrap completo (que dispara el splash). Solo refrescar el perfil.

**Nota:** el rebote por process-death al abrir la cámara (emulador) es del sistema; no se elimina por completo, pero al no rehacer el bootstrap desde `subirFoto` y refrescar solo el perfil, el caso normal (sin process-death) se queda en el perfil.

---

## Parte 2 — Prediseñadas dentro del wizard "en casa"

- Quitar la invocación de `EntradasCatalogoGlobal` de `PantallaRutinaLibre.kt:160-163` (los botones de arriba). Conservar el mecanismo `subPantalla` para navegar a las sub-pantallas desde el wizard.
- En `WizardRutinaLibre.kt`, cuando el usuario está en el paso de equipo y elige `PESO_CORPORAL`: mostrar un bloque/CTA "Ver rutinas listas para casa" que abre `PantallaRutinasPredisenadas` **filtrada por `equipo='peso_corporal'`**.
- `PredisenadasViewModel` + `PantallaRutinasPredisenadas`: agregar parámetro `equipoFiltro: String?` y pasarlo a `cargar(null, equipoFiltro)`. El repo ya lo soporta.
- El wizard mantiene su flujo normal (generar a medida) como alternativa; las prediseñadas son una opción adicional cuando es en casa.

---

## Parte 3 — Armador de rutina propia (COMPLETO, backend nuevo)

### 3a. Backend — RPCs nuevas (migración nueva)
Todas `security definer set search_path=public`, `revoke all from public` + `grant execute to authenticated`, aisladas por `auth.uid()`, respetando el índice único "una rutina libre activa por usuario".

- `crear_rutina_libre_vacia(p_nombre text) → jsonb` — desactiva/borra la activa anterior del usuario, crea una `rutina_libre` activa vacía con 1 `rutina_libre_dia` (dia_semana=1, foco 'Día 1'). Devuelve `_rutina_libre_detalle`.
- `agregar_dia_libre(p_rutina_libre_id uuid, p_foco text) → jsonb` — agrega un día al final (dia_semana = max+1). Valida que la rutina sea del usuario. Devuelve detalle.
- `quitar_dia_libre(p_dia_id uuid) → jsonb` — borra el día (cascade sus ejercicios). Valida propiedad. No permite quedar con 0 días. Devuelve detalle.
- `agregar_ejercicio_libre(p_dia_id uuid, p_catalogo_id uuid, p_series int, p_reps text, p_descanso text) → jsonb` — inserta en `rutina_libre_ejercicio` (nombre y media se derivan de `ejercicio_catalogo`), orden = max+1. Valida propiedad del día. Devuelve detalle.
- `quitar_ejercicio_libre(p_ejercicio_id uuid) → jsonb` — borra el ejercicio. Valida propiedad. Devuelve detalle.
- `editar_ejercicio_libre(p_ejercicio_id uuid, p_series int, p_reps text, p_descanso text) → jsonb` — actualiza series/reps/descanso. Valida propiedad. Devuelve detalle.

Validación de propiedad: cada RPC verifica vía join que `rutina_libre.usuario_id = auth.uid()`; si no, excepción.

### 3b. App — repositorio + ViewModel + UI
- `RutinaLibreRepositorio`: métodos `crearVacia(nombre)`, `agregarDia(rutinaId,foco)`, `quitarDia(diaId)`, `agregarEjercicio(diaId,catalogoId,series,reps,descanso)`, `quitarEjercicio(ejId)`, `editarEjercicio(ejId,series,reps,descanso)` → cada uno llama su RPC y devuelve `Rutina`.
- `ArmadorViewModel` (nuevo, ui/libre/): estado con la `Rutina` en construcción + flujo de agregar desde catálogo. Patrón estándar (viewModelScope + StateFlow).
- UI:
  - Entrada al armador: desde el wizard "en casa" (junto a prediseñadas: "Armar la mía") y/o como opción del modo libre. Decisión de ubicación fina en implementación, consistente con quitar los botones de arriba.
  - `PantallaArmador`: muestra los días (agregar/quitar día), y por día la lista de ejercicios agregados (editar series/reps/descanso, quitar, reordenar por orden). Botón "Agregar ejercicio" abre la biblioteca en modo selección.
  - `PantallaBiblioteca`: modo dual — "ver" (como hoy, GIF) y "agregar" (cuando viene del armador, cada fila tiene "+ Agregar" que llama `agregarEjercicio` al día activo). Reusa `buscar_ejercicios_catalogo`.

---

## Verificación
- **Backend**: migración de RPCs probada en transacción rollback contra prod (crear vacía → agregar día → agregar ejercicio → editar → quitar → quitar día), con sesión authenticated real (rol authenticated + jwt claim) para ejercitar auth.uid() y RLS. Aislamiento: un usuario no puede editar la rutina de otro. Luego aplicar a prod.
- **App**: `gradlew compileCommonMainKotlinMetadata` + `:composeApp:compileDebugKotlinAndroid` limpios.
- **Push SIN tag** a ambos repos. El owner prueba en emulador.

## Fuera de alcance
- No se toca el panel web (esto es app + backend).
- No se crea tag/release ni AAB en esta ronda.
- Reordenar ejercicios por drag&drop puede quedar como "subir/bajar" simple (botones) si drag&drop resulta caro; el orden se persiste por la columna `orden`.
