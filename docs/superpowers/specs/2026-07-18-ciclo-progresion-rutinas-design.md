# Ciclo de progresión de rutinas — diseño

## Problema

Hoy el trainer genera una plantilla automática (`generar_plantilla_rutina`) o
arma una rutina a mano, la asigna al socio, y ahí termina. No hay ciclo: la
rutina no vence, no se puede editar la plantilla generada (solo regenerarla
entera), y cuando llega el momento de cambiarle el plan al socio el trainer no
tiene a la vista su progreso.

El owner quiere un **ciclo de progresión**:
1. El trainer asigna una rutina con **vigencia** (ej. 2 meses).
2. El socio la sigue y **registra su avance** en la app (ejercicios completados,
   carga usada, asistencia, peso).
3. Cuando la rutina está **por vencer** (3 días antes), el trainer recibe aviso y
   la ve en una sección "por vencer".
4. El trainer entra, ve el **progreso del socio** (peso, asistencia, adherencia
   por ejercicio, carga), el sistema le **sugiere ajustes**, y le asigna la
   **siguiente rutina** ajustada — enlazada a la anterior como historial.

Tres capacidades nuevas, un solo ciclo: **editar plantillas**, **vigencia +
avisos**, **panel de progreso con sugerencias**.

## Decisiones tomadas con el owner

- La vigencia vive en **la rutina del socio**, no en la plantilla del gym. La
  plantilla es solo el molde inicial (genérico por objetivo); lo que vence y se
  renueva es la copia personal de cada socio.
- Al vencer, la rutina **NO se corta**: se extiende sola hasta que el trainer
  asigne otra. El socio nunca queda sin plan. El vencimiento es solo la señal.
- Aviso al trainer **3 días antes**.
- Adherencia **por ejercicio + carga** (lo más completo): se construye la tabla
  nueva y la app la consume (ya confirmado con el agente de la app, PREGUNTA 45).
- El sistema **sugiere ajustes** al armar la siguiente; el trainer decide.

## Arquitectura — 4 partes

Las partes son incrementales: cada una aporta valor sola. Orden sugerido de
implementación = orden de las partes.

### Parte A — Vigencia de la rutina del socio

**Cambios en la tabla `rutina`:**
- `vigencia_inicio date` — por defecto la fecha de asignación.
- `vigencia_fin date` — inicio + duración elegida.
- `duracion_semanas int` — la duración pactada (ej. 8 = 2 meses), para recordar
  el ciclo al renovar.
- `rutina_anterior_id uuid references rutina(id)` — enlaza a la rutina previa del
  socio; arma el historial de progresión (rutina 1 → 2 → 3…).
- `objetivo_id uuid references objetivo_entrenamiento(id)` — hoy `objetivo` es
  texto libre; el id permite evaluar progreso contra el objetivo correcto.

**Al asignar una rutina** (`agregar_membresia`/asignación de rutina y el flujo de
"Usar plantilla"): el trainer elige la duración (semanas), se calcula
`vigencia_fin`, y si el socio tenía una rutina activa previa se enlaza como
`rutina_anterior_id` y esa previa se marca `activa=false`.

**La vigencia no bloquea**: ningún RPC corta acceso por `vigencia_fin`. Una
rutina vencida sigue `activa=true` y visible en la app. Solo cambia que aparece
en "por vencer" y dispara el aviso.

**Rutinas ya existentes (sin vigencia):** las columnas nuevas son nullable. Una
rutina vieja sin `vigencia_fin` NUNCA aparece en "por vencer" (el filtro exige
`vigencia_fin is not null`) — no molesta. El trainer le pone vigencia cuando la
edite o al asignar la siguiente. No hay backfill automático: sería inventar
fechas que el gym no pactó.

### Parte B — Adherencia por ejercicio + carga

**Tabla nueva** `registro_entreno_ejercicio`:
```
socio_id uuid, rutina_ejercicio_id uuid, fecha date,
completado boolean, carga_usada numeric null, created_at
unique (socio_id, rutina_ejercicio_id, fecha)
```
- RLS: el socio escribe/lee lo suyo (`es su socio`); el staff del gym lee lo de
  sus socios (patrón de `registro_entreno`).
- **RPC** `marcar_entreno_ejercicio(rutina_ejercicio_id, completado, carga_usada)`
  — upsert por (socio, ejercicio, fecha), patrón de `marcar_entreno_libre`. La
  app la consume (cambia su check visual a persistido — ya está lista).
- Se conserva `registro_entreno` (por día) — son complementarios: día = vino y
  entrenó; ejercicio = qué hizo y con cuánto peso.

**Pedido a la app** (PEDIDO nuevo en APP-BACKEND-REQUESTS.md): la app ya marca el
✓ por ejercicio de forma visual; ahora lo persiste vía esta RPC, y agrega un
campo para que el socio anote la carga al marcar.

### Parte C — Sección "Plantillas por vencer" + aviso al trainer

**RPC** `rutinas_por_vencer(p_sede_id)` → socios cuya rutina activa vence en ≤ 3
días (o ya venció). Devuelve socio, rutina, `vigencia_fin`, días restantes,
objetivo. Filtrado por sede y por rol (el entrenador ve las suyas; el admin
todas).

**Panel:** una sección en Rutinas (o un badge en el dashboard) "Por vencer (N)"
que lista esos socios con acceso directo a armar su siguiente rutina.

**Aviso:** al trainer/admin. Reutiliza el `push_worker` que ya envía
recordatorios de vencimiento de membresía a los socios — mismo patrón, mismo
cron diario. Un RPC de encolado (`encolar_avisos_rutina_por_vencer`) corre en el
cron, encuentra las rutinas que entran en la ventana de 3 días y encola un aviso
al entrenador asignado (o al admin si no hay). Idempotente: se marca
`aviso_vencimiento_enviado_at` en la rutina para no repetir el aviso cada día.

### Parte D — Panel de progreso + sugerencias + editar y renovar

**RPC** `progreso_socio(p_socio_id)` → el resumen que el trainer ve antes de
renovar, combinando lo que YA existe + lo nuevo:
- **Peso**: serie de `medida_personal` en el periodo de la rutina (evolución +
  si acercó/alejó de `meta_peso`).
- **Asistencia**: nº de `checkin` de entrada en el periodo vs las semanas.
- **Adherencia por día**: `registro_entreno` completados vs los que tocaban.
- **Adherencia por ejercicio + carga**: de `registro_entreno_ejercicio` — qué
  ejercicios completó siempre / cuáles evita, y la progresión de carga.

**Sugerencias** (`sugerir_ajustes`, o dentro de `progreso_socio`): reglas simples
sobre esos datos, mostradas como recomendaciones que el trainer acepta o ignora:
- Alta adherencia + carga subiendo → "sube la intensidad / series".
- Objetivo bajar peso pero peso estancado → "más volumen/cardio".
- Baja asistencia → "rutina más corta / menos días para reenganchar".
- Ejercicios que el socio nunca completa → "reemplázalos".
El sistema informa y sugiere; **el trainer decide** (nunca renueva solo).

**Editar la plantilla/rutina** (la capacidad que hoy falta):
- Para la **rutina del socio**: ya existe el patrón (`useGuardarEjercicio`,
  `useEliminarEjercicio`, `useAgregarDia`). Se reutiliza — el trainer edita la
  rutina asignada ejercicio por ejercicio.
- Para la **plantilla del gym** (`plantilla_rutina_ejercicio`): se agrega el mismo
  patrón de edición (RPCs/mutations para agregar/quitar/cambiar ejercicio en la
  plantilla), para no depender de regenerarla entera. Reusa `BancoEjercicios`.

**Renovar**: botón "Asignar siguiente rutina" desde el panel de progreso. Parte de
la plantilla del objetivo (o de la rutina anterior como base), el trainer la
ajusta con las sugerencias a la vista, elige nueva duración, y al guardar se
enlaza `rutina_anterior_id` a la que vence.

## Lo que YA existe y se reutiliza (no rehacer)

- `registro_entreno` (adherencia por día), `medida_personal` (peso), `checkin`
  (asistencia), `meta_peso` (objetivo de peso). El panel de progreso los combina.
- Edición de ejercicios de rutina de socio (hooks en useRutinas.js).
- `generar_plantilla_rutina` (molde inicial), `BancoEjercicios`, catálogo.
- El cron diario para enganchar el aviso.

## Verificación

- **BD (psql/rollback)**: asignar rutina con vigencia → `vigencia_fin` correcta;
  vencer no corta acceso; `rutinas_por_vencer` lista solo las de ≤3 días de la
  sede; `progreso_socio` combina peso+asistencia+adherencia con datos reales de un
  socio; `marcar_entreno_ejercicio` upsert idempotente por (socio,ej,fecha);
  editar plantilla agrega/quita ejercicios.
- **Aislamiento**: un trainer solo ve las rutinas por vencer y el progreso de
  socios de SU sede; un gym no ve datos de otro.
- **Sugerencias**: casos — alta adherencia, peso estancado, baja asistencia →
  cada regla dispara su recomendación.
- **Panel (Playwright)**: sección "por vencer"; abrir progreso de un socio; editar
  un ejercicio de plantilla; renovar enlazando a la anterior. `npm test` + build.
- **App**: PEDIDO documentado — persistir check por ejercicio + carga vía la RPC
  nueva.

## Estado de implementación (2026-07-18)

Feature implementada y cerrada (A+B+C+D). Revisión final: el ciclo cierra
end-to-end (asignar con vigencia → por vencer → renovar; la rutina vieja se
desactiva, sale de "por vencer", el aviso se resetea). Decisiones tomadas al
construir:

- **La renovación desde el panel edita la rutina en el lugar**, no crea una nueva.
  El flujo de "usar plantilla" se bloquea cuando el socio ya tiene rutina activa,
  así que el botón "Asignar siguiente rutina" lleva a editar la rutina vigente y
  re-fija su vigencia. **Consecuencia:** `rutina_anterior_id` NO se enlaza — el
  historial R1→R2 que este spec describía no se guarda. El owner decidió dejarlo
  así (2026-07-18): hoy ningún panel muestra ese historial, así que no hay pérdida
  visible. **Follow-up** cuando se quiera exponer la progresión: cambiar la
  renovación para crear una rutina nueva (copiando la anterior) y enlazarla.
- **Adherencia por ejercicio + carga (Parte B)**: el backend está montado
  (`registro_entreno_ejercicio` + `marcar_entreno_ejercicio`), pero la app aún la
  consume (PEDIDO 46). Hasta entonces el panel degrada limpio: `adherencia_ejercicio`
  viene vacío y se muestra "aún sin registros por ejercicio".

Follow-ups menores no bloqueantes: guard contra división por cero en
`sugerenciasDeProgreso` (casos degenerados); UX del toast cuando falla solo la
vigencia; `useRenovarRutina` es código forward-looking sin uso; y las policies RLS
`USING(true)` de `plantilla_rutina_dia/ejercicio` (deuda preexistente, un gym puede
LEER plantillas de otro — las RPCs de edición sí validan empresa).

## Fuera de alcance

- **Sugerencias con IA/ML**: las sugerencias son reglas simples sobre los datos,
  no un modelo. Si se quiere algo más inteligente, es otra iteración.
- **Que el socio edite su propia rutina asignada**: sigue siendo del trainer; el
  socio solo registra avance. (La rutina libre, que sí arma el socio, es aparte.)
- **Vigencia de otras cosas** (dietas): este ciclo es de rutinas. Dietas podría
  seguir el mismo patrón después, no ahora.
