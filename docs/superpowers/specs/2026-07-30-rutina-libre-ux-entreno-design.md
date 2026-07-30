# Rutina libre — UX de entrenamiento (pestañas por día + series + descanso) — Diseño

**Fecha:** 2026-07-30 · **Repo:** controlgym-app (KMP) · Solo RUTINA LIBRE (luego se replica a gym).
**Regla:** sin tag/release; el owner prueba en emulador. **Principio:** UI/UX impecable, reusar componentes.

## Contexto (verificado)
- Formato de series/reps ya arreglado en `EjercicioRutina.detalle` (Planes.kt) → "2 series · 14-18 reps · descanso 60s".
- `BarraDescanso` + `DescansoActivo(ejercicioId, segundos, nombreSiguiente)` en `ui/entreno/TimerDescanso.kt`; cuenta con LaunchedEffect+delay, vibra+suena a 0. Hoy se renderiza EN MEDIO del scroll (PantallaRutinaLibre.kt:216, PantallasSocio.kt:359).
- Marcado BINARIO (Set<String>) en `RutinaLibreViewModel.alternarMarcado` (~123-153). NO hay conteo de series ni "serie actual". `EjercicioRutina` tiene `series:Int?`, `reps`, `descanso`, `carga` — sin campo de serie actual.
- `PantallaRutinaLibre.kt` dibuja TODOS los días apilados vía `ListaDiasRutina` → se ve bultoso.
- Parser `segundosDeDescanso`/`formatoCronometro` en `dominio/Descanso.kt`.
- Descanso editable solo en el armador (DialogoEditarEjercicioArmador), no en la rutina activa.
- El registro de series hechas hoy: `mi_adherencia_libre(fecha)` marca ejercicio completo; `marcar_entreno_libre` es por ejercicio+fecha (binario). El conteo de series es estado de UI; el ejercicio se marca "completado" (persiste) al terminar la última serie.

## Mejora 1 — Layout "Mi rutina" con pestañas por día
- En `PantallaRutinaLibre.kt` (vista rutina activa), reemplazar el apilado de todos los días por:
  - Una fila de chips/pestañas arriba: "Día 1", "Día 2"... (usar el `foco` si existe: "Día 1 · Glúteos"). Scroll horizontal si hay muchos.
  - Debajo, SOLO el día seleccionado (sus ejercicios). Reusar el render de ejercicios existente (una sola `TarjetaDiaRutina`/día, no la lista completa).
  - **Día inicial = primer día sin completar**: calcular en el ViewModel con la adherencia de hoy (los ejercicios marcados). El primer día cuyos ejercicios no están todos completados es el activo; si todos completos, el último. Estado `diaActivoIndex` en EstadoRutinaLibre.
  - Chip del día completado con un check/color Exito discreto.
- Estética: chips con ColoresFitCore (seleccionado = Primario/PrimarioFondo; resto = Tarjeta/Linea). Limpio, una pantalla = el día de hoy.

## Mejora 2 — Cronómetro entre series (contador de series)
- `DescansoActivo` gana 2 campos: `serieActual: Int? = null`, `totalSeries: Int? = null` (para "Descanso · Serie 2 de 3"). `BarraDescanso` los muestra si están presentes.
- Estado nuevo en EstadoRutinaLibre: `seriesHechas: Map<String, Int>` (ejercicioId → nº de series completadas hoy). Arranca en 0.
- Por cada ejercicio (en su Column de `TarjetaDiaRutina` / vista libre), NUEVO:
  - Texto "Serie {hechas+1} de {series}" (si series != null y hechas < series).
  - Botón "Serie hecha" (primario, discreto). Al tocar:
    - incrementa `seriesHechas[ej.id]`.
    - Si NO es la última serie → arranca `DescansoActivo(ejercicioId, segundos=segundosDeDescanso(descanso) ?: default, serieActual=hechas+1, totalSeries=series)` → barra fija arriba.
    - Si ES la última serie → NO arranca descanso; marca el ejercicio como completado (marcarEntrenoLibre completado=true) y muestra el check.
  - Si el ejercicio no tiene `series` definidas → cae al comportamiento binario actual (un solo "Marcar hecho").
- **Barra fija arriba**: sacar `BarraDescanso` del flujo scrollable y ponerla en un slot fijo en el tope de `PantallaRutinaLibre` (sobre el contenido, ej. en un Column raíz con la barra antes del contenido scrollable, o un Box con la barra alineada arriba). No debe scrollear.
- Reusar la lógica de vibración/beep que ya dispara BarraDescanso a 0.

## Mejora 3 — Editar descanso en vivo (por ejercicio)
- En la vista activa (no solo el armador), el descanso del ejercicio es tocable → abre un selector.
- Selector de descanso: opciones fijas de 30 en 30 → **30s, 60s, 90s, 120s (2 min), 150s (2:30)**. (Un `AlertDialog` o bottom sheet con esos 5 valores + el actual resaltado.)
- Al elegir, persistir con `editar_ejercicio_libre(ej.id, series, reps, nuevoDescanso)` (RPC ya existe) y refrescar. Aplica a ese ejercicio; el próximo descanso usa el nuevo valor.
- Reutilizable: el mismo selector puede usarse en el armador (reemplaza/complementa el campo libre de descanso), pero mínimamente: en esta ronda basta con la rutina activa.

## Verificación
- `compileCommonMainKotlinMetadata` + `:composeApp:compileDebugKotlinAndroid` limpios.
- Reusar ColoresFitCore, Tarjeta, EstadoVacio, BarraDescanso, segundosDeDescanso. Sin estilos inventados.
- Sin tag. El owner prueba en emulador.

## Fuera de alcance
- Replicar a la rutina de gym (después, cuando el owner apruebe la libre).
- Descanso tras la última serie (decisión: NO hay descanso al terminar el ejercicio).
