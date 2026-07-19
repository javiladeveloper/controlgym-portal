# Sugerencias inteligentes de progresión (sobrecarga progresiva) — diseño

> **Estado:** en diseño. La sección "El algoritmo (cuándo/cuánto subir peso)"
> espera el reporte del deep-research sobre sobrecarga progresiva — ese hueco está
> marcado `⏳ PENDIENTE INVESTIGACIÓN`. El resto del diseño está cerrado con el owner.

## Problema

Hoy FitCore sugiere ajustes GENERALES por objetivo ("subí la intensidad", "más
cardio") mirando totales (adherencia global, peso, asistencia). El owner quiere
algo más fino: que la herramienta analice **cómo el socio realmente entrenó,
ejercicio por ejercicio**, y sugiera ajustes específicos.

Ejemplo del owner: un día de rutina tiene pecho + brazos; el socio completa el
pecho pero salta los de brazos → hay un indicio para ajustar. O: "Press banca
completado 8/8 con carga subiendo 60→70 → el cuerpo se adaptó, subí el peso o
cambiá el ejercicio". "Sentadilla 0/8 → lo evita, replanteá".

El "cuándo subir el peso" NO es un calendario fijo (el vencimiento de rutina es
opcional; no todos los gyms lo usan). Debe ser un **cálculo basado en constancia
+ sobrecarga progresiva**: cuando la persona completó consistentemente un
ejercicio con la carga actual durante suficiente tiempo, se sugiere subir.

## Decisiones tomadas con el owner

- **Cuatro señales por ejercicio**: adaptado (subir carga/cambiar), evitado
  (replantear), estancado (revisar esquema), y día entero abandonado.
- **Dos mundos, mismo cerebro**:
  - **A — socio con trainer** (rutina asignada): el sistema analiza → sugiere al
    trainer → él evalúa y **aprueba/edita** el ajuste.
  - **B — rutina libre sin gym** (el usuario se autogestiona): la app le pregunta
    **al propio usuario** ("ya dominás esto, ¿subimos el peso?") y aplica lo que
    acepte. La UI vive en la app.
- **UX del trainer (mundo A)**: la señal + sugerencia va **al lado de cada
  ejercicio** de la rutina; el trainer edita a mano con la sugerencia a la vista.
  El sistema informa, el humano ajusta (nada automático sin su OK).
- **Disparo**: NO atado al vencimiento (opcional). El análisis está disponible
  siempre; el sistema calcula solo el momento prudente para sugerir según
  constancia + sobrecarga progresiva.
- **Incentivo al socio**: en la app, un texto que le recuerde que marcar sus
  ejercicios sirve para que le ajusten la rutina.
- **Degradación**: sin datos de carga, el motor da evitado/abandonado (que solo
  necesitan completado sí/no); adaptado/estancado se suman cuando llega la carga.

## Arquitectura — un cerebro, dos consumidores

### El motor compartido `analizar_progresion`

Una sola lógica que, dada una rutina (los ejercicios asignados, con su carga
prescrita y su día) y el historial de registros (fecha, completado, carga_usada),
devuelve por cada ejercicio:

```
{
  ejercicio, dia_semana, grupo_muscular (si el ejercicio está enlazado al catálogo),
  veces_completado, veces_esperado,     -- cuántas veces tocaba vs cuántas hizo
  tasa: veces_completado / veces_esperado,
  carga_actual, tendencia_carga: [{semana, carga}],   -- evolución en el tiempo
  estado: 'adaptado' | 'evitado' | 'estancado' | 'normal',
  sugerencia: { tipo, texto, ... },     -- qué hacer y por qué
}
```
Y por día: `dia_abandonado` si la adherencia del día entero < umbral.

**Reglas de las señales** (el "cuánto/cuándo" de adaptado/estancado espera la
investigación; evitado/abandonado ya se pueden definir):
- **evitado**: por ausencia (`intentos/esperado < 0.30`) o por incompletitud
  (`completados/esperado < 0.30`). Ver el árbol de decisión de abajo para el orden.
- **día abandonado**: adherencia del día entero `< 0.20`, evaluada solo sobre los
  ejercicios del día que SÍ tienen datos (un día entero sin registros = sin datos,
  no abandonado).
- **adaptado**: ⏳ PENDIENTE INVESTIGACIÓN — regla de "cuándo el cuerpo se adaptó
  y toca subir" (double progression: completar el objetivo N sesiones seguidas).
- **estancado**: ⏳ PENDIENTE INVESTIGACIÓN — carga plana durante X tiempo pese a
  completar (plateau que amerita cambiar esquema/ejercicio).

**Por qué un motor genérico**: recibe datos abstractos (rutina + registros), así
que el MISMO código sirve para la rutina asignada (mundo A, lee de
`rutina_ejercicio` × `registro_entreno_ejercicio`) y para la libre (mundo B, lee
de `rutina_libre_ejercicio` × `registro_entreno_libre`). Se implementa una vez.

### El algoritmo (cuándo/cuánto subir peso) — sobrecarga progresiva

Fundamentado en la investigación (deep-research, jul 2026): **ACSM 2009 Position
Stand** (fuente primaria — la "regla 2-por-2"), StrongLifts 5x5, Starting
Strength (progresión lineal), y estudios de frecuencia/volumen (el **volumen
semanal** es el driver principal de la fuerza; la frecuencia ayuda sobre todo
porque acumula volumen). Los criterios convergen entre las fuentes, así que el
algoritmo los aplica con confianza.

> **Ancla autoritativa (ACSM, "regla 2-por-2"):** subir la carga **2-10%** cuando
> el socio logra el objetivo (idealmente 1-2 reps por encima) en **dos sesiones
> consecutivas**; el % escala con la masa muscular (menor para tren superior,
> mayor para tren inferior). Es el disparador con mejor respaldo primario para un
> sistema automático. Nuestro algoritmo lo implementa: N=2 sesiones como piso.

**Principio: double progression.** No se sube el peso por calendario, sino cuando
el socio **completa consistentemente el objetivo de series × reps** con la carga
actual. Ese es el disparo — coherente con lo que pidió el owner ("según la
constancia, el momento prudente para subir").

**1. ¿Cuándo sugerir subir? (umbral de "adaptado")**
Depende del nivel del socio, que se infiere de su historial (no se le pregunta):
- **Novato** (progresa lineal, recupera en 48-72h): completó el objetivo
  **2 sesiones consecutivas** del ejercicio → sugerir subir. (StrongLifts sube
  cada sesión completada; usamos 2 para tener señal, no ruido de una sola vez.)
- **Intermedio** (progreso más lento): completó el objetivo **3 sesiones
  consecutivas** (o ~3 semanas) → sugerir subir.
- **Inferir el nivel**: novato = lleva poco tiempo entrenando ese ejercicio / la
  carga venía subiendo cada pocas sesiones. Intermedio = ya lleva varios ciclos /
  la carga sube más lento. Heurística simple sobre `tendencia_carga`; si no hay
  historia suficiente, asumir novato (progresa más rápido, umbral más bajo).

**2. ¿Cuánto subir? (incremento por ejercicio)**
Depende del tamaño del músculo (más músculo = salto mayor). Del grupo muscular
del ejercicio (cuando está enlazado al catálogo) o del nombre:
- **Tren inferior** (sentadilla, peso muerto, prensa, femoral): **+2.5 a 5 kg**.
- **Tren superior compuesto** (press banca, press militar, remo, dominadas):
  **+1.25 a 2.5 kg**.
- **Aislados** (curl, extensión tríceps, elevaciones, aperturas): **+0.5 a 1 kg**
  (o el salto mínimo disponible).
- Por defecto usamos el extremo BAJO del rango (más sostenible; la investigación
  advierte que progresar muy rápido es insostenible). El texto sugiere el rango
  al trainer; en el mundo B la app propone el valor bajo.

**3. ¿Cuándo está estancado? (plateau)**
Regla convergente de StrongLifts/Starting Strength: **fallar el objetivo con la
misma carga 3 sesiones seguidas** = estancamiento real. Sugerencia:
- Primero, deload: bajar ~10% y volver a subir (romper la meseta).
- Si vuelve a estancar tras el deload, o si la carga está plana ≥4 semanas pese a
  completar (no puede subir): **cambiar el ejercicio** por otro del mismo grupo o
  cambiar el esquema (más series / variante). Es el "ya no progresa, replanteá".

**4. Modulación por constancia.**
La velocidad de progresión depende de cuán seguido entrena ese ejercicio (la
investigación: el volumen semanal real es el driver). Si la adherencia del
ejercicio es baja pero no nula (viene a veces), **no** se sugiere subir aunque
"complete" cuando viene — primero hay que mejorar la constancia. La señal ahí es
**evitado**, no adaptado. Solo se sugiere subir a quien viene con constancia
(tasa alta) y completa.

**Resumen del árbol de decisión por ejercicio** (en este orden — la evaluación
para en la primera que aplica):
```
sin ningún registro en el periodo         → NORMAL + sin_datos (la app aún no persiste; NO es evitar)
intentos/esperado < 0.30                   → EVITADO por ausencia (casi no viene → replantear/motivar)
constante + falla objetivo 3 seguidas      → ESTANCADO (deload; luego cambiar)  [antes que incompletitud]
completados/esperado < 0.30                → EVITADO por incompletitud (viene pero no termina → bajar exigencia)
constante + completa objetivo N seguidas   → ADAPTADO (subir carga, incremento por grupo)
resto                                      → NORMAL (seguir igual)
```
donde N = 2 (novato) o 3 (intermedio), inferido del historial de carga; "constante"
= tasa de intentos ≥ 0.5.

**Dos matices que salieron al implementar (revisión adversarial):**
- **`sin_datos` primero.** Un ejercicio sin ningún registro en el periodo NO es
  "evitado": es que la app aún no persiste (`registro_entreno_ejercicio` a 0 filas
  hoy). El motor lo marca `normal` + `sin_datos:true` y el panel degrada a "aún sin
  registros". Sin este corte, con la BD vacía TODO saldría en rojo — el bug opuesto
  a la degradación buscada.
- **Evitado tiene dos formas.** Ausencia (no viene: intentos bajos) e incompletitud
  (viene pero casi nunca termina: completados bajos). El estancado se evalúa entre
  ambas para no confundir una meseta real (racha de fallos con la misma carga) con
  "nunca completa".

## Los datos que faltan (dependencia dura)

El motor necesita **carga registrada en el tiempo**. Estado hoy:

| Mundo | Adherencia por ejercicio | Carga usada |
|---|---|---|
| A (asignada) | `registro_entreno_ejercicio` existe, 0 filas | columna `carga_usada` existe, sin datos |
| B (libre) | `registro_entreno_libre` existe y con datos | **falta columna de carga** |

- **Mundo A**: PEDIDO 46 (ya enviado) — la app persiste el check + carga.
- **Mundo B**: agregar `carga_usada` a `registro_entreno_libre` + **pedido nuevo**
  a la app para que la registre al marcar.

Sin carga: el panel/app muestran evitado + día abandonado, y avisan "activá el
registro de peso para sugerencias de progresión".

## Componentes

### Backend (compartido)
- Función SQL `analizar_progresion(p_rutina_id | p_rutina_libre_id)` (o dos RPCs
  delgadas que llaman al mismo cálculo) → el array de señales por ejercicio + por
  día. Reusa el periodo/adherencia que `progreso_socio` ya calcula; agrega el
  desglose por ejercicio con tendencia de carga.
- La lógica de las señales (umbrales) en una función pura testeable — igual que
  `sugerenciasDeProgreso` hoy, pero a nivel ejercicio.
- Migración: `registro_entreno_libre += carga_usada numeric`.

### Panel del trainer (mundo A)
- Enriquecer `ProgresoRenovarModal` (Rutinas.jsx): junto a cada ejercicio de la
  rutina, su señal (🟢 adaptado ↑ / 🔴 evitado / 🟡 estancado) + sugerencia. Aviso
  arriba si hay un día abandonado. El trainer edita con la edición ya existente
  (`useGuardarEjercicio`/`useEliminarEjercicio`).
- El aviso de vencimiento (donde exista) incluye un resumen del análisis.

### App (mundo B) — handoff
- La app llama la RPC del motor para la rutina libre del usuario; con las señales,
  le pregunta directamente ("ya dominás X, ¿subimos a Y kg?" / "saltás Z,
  ¿la cambiamos?") y aplica lo que acepte editando su rutina libre.
- PEDIDO nuevo en APP-BACKEND-REQUESTS.md, además de completar el 46 y registrar
  carga en la libre.

## Verificación
- **Motor (tests JS + BD)**: casos — ejercicio completado siempre con carga ↑ →
  adaptado; casi nunca → evitado; carga plana → estancado; día entero flojo →
  abandonado; sin datos de carga → solo evitado/abandonado, sin romper.
- **Aislamiento**: el trainer solo ve el análisis de socios de su sede; el usuario
  solo el de su propia rutina libre.
- **Panel (Playwright)**: las señales aparecen al lado de los ejercicios con datos
  reales; el trainer edita. Degradado limpio sin datos por ejercicio.
- **Umbrales**: los de la investigación, una vez definidos, con sus tests.

## Fuera de alcance
- **Aplicar el ajuste automáticamente** sin OK humano (mundo A) / sin preguntar
  (mundo B): siempre hay confirmación.
- **Nutrición/dieta**: este análisis es de entrenamiento.
- **Predicción de lesión / RPE / RIR** avanzados: si la investigación los sugiere,
  quedan como iteración futura; esta entrega usa completado + carga.
