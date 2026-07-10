# Plan automático de entrenamiento + nutrición por objetivo e IMC

**Fecha:** 2026-07-09
**Contexto:** pedido de cliente en entrevista. Al inscribir un socio, asignarle
automáticamente una rutina + dieta según su **objetivo** y su **IMC**, editable
después. Diferenciador comercial fuerte para la demo.

## Problema

Hoy `inscribir_socio` NO asigna plan. El socio tiene `objetivo` (texto libre, 23
valores caóticos), `talla_m` y `peso_kg` (para IMC), pero nadie le arma rutina ni
dieta automáticamente. El cliente quiere que exista un plan por defecto por cada
objetivo/caso de IMC, que se asigne al inscribir y sea editable.

## Decisiones (del brainstorming)

1. **Catálogo amplio de objetivos** (8), estandarizado. Los objetivos raros
   (Karate, Jiu-Jitsu) quedan como "Otro" sin plan automático.
2. **Una plantilla base por objetivo; el IMC la MODULA** con reglas (no 64
   plantillas). Basado en la clasificación IMC de la OMS.
3. **Semilla de calidad que yo creo + editor en el panel** para que el gym las
   personalice.
4. **Asignación automática al inscribir, con aviso.** Editable después en la ficha.

## Sección 1 — Catálogo de objetivos

Tabla `objetivo_entrenamiento` (catálogo global, con `codigo` estable):

| codigo | nombre | enfoque |
|---|---|---|
| `bajar_peso` | Bajar de peso | déficit + cardio + fullbody |
| `ganar_masa` | Ganar masa muscular | superávit + hipertrofia + split |
| `tonificar` | Tonificar | mantenimiento + circuitos |
| `fuerza` | Fuerza | cargas altas, pocas reps |
| `resistencia` | Resistencia / cardio | alto volumen, poco descanso |
| `salud_general` | Salud general | equilibrado, moderado |
| `rehabilitacion` | Rehabilitación | bajo impacto, movilidad |
| `prep_deportiva` | Preparación deportiva | funcional, potencia |

`socio.objetivo` (texto) se conserva; se agrega `socio.objetivo_id` (FK opcional
al catálogo). Al inscribir, si el objetivo elegido mapea a un código con
plantilla → se asigna plan. "Otro"/null → sin plan auto.

## Sección 2 — Modulación por IMC (tabla OMS)

Categorías IMC (OMS): delgadez severa <16, moderada 16-17, leve 17-18.5,
**normal 18.5-25**, sobrepeso 25-30, obesidad I 30-35, II 35-40, III ≥40.

**Dieta (calorías base de la plantilla, ajustadas):**
- Bajo peso (<18.5): **superávit** +300..+500 kcal.
- Normal (18.5-25): según objetivo (déficit si baja, superávit si gana masa,
  mantenimiento si tonificar/salud).
- Sobrepeso (25-30): **déficit moderado** −300..−500 kcal.
- Obesidad I-III (30+): **déficit mayor** −500..−750 kcal.

El ajuste se aplica como un factor sobre las `kcal` de cada comida de la
plantilla, y se recalcula el total del día.

**Rutina (intensidad/seguridad):**
- Obesidad II-III (35+): añadir/priorizar cardio de bajo impacto, reducir carga,
  nota de arranque progresivo (proteger articulaciones).
- Obesidad I / Sobrepeso: cardio + fuerza equilibrado (plantilla tal cual + nota).
- Normal / Bajo peso: plantilla del objetivo sin cambios de intensidad.

En v1 la modulación de rutina se limita a: (a) una **nota** en la rutina según
IMC, y (b) si IMC≥35, marcar los ejercicios de carga con una `carga` reducida
("progresivo"). No reescribimos ejercicios (eso lo hace el trainer). El foco de
la modulación cuantitativa es la **dieta** (kcal), que es lo medible.

**Nota legal/seguridad:** cada plan generado lleva la nota: *"Plan sugerido según
tu objetivo e IMC. Consulta a tu entrenador; no reemplaza indicación médica."*

## Sección 3 — Estructura de datos

`rutina.empresa_id` y `dieta.empresa_id` son **NOT NULL** (por diseño multi-tenant
+ RLS). Por eso las plantillas GLOBALES no pueden vivir en esas tablas con
`empresa_id NULL`. Solución: **tablas de plantilla separadas** (sin empresa),
espejo simplificado de la estructura de rutina/dieta:

```sql
create table plantilla_rutina (
  id uuid pk, objetivo_id uuid fk, nombre text, notas text, ...
);  -- sin empresa_id: es global (semilla)
create table plantilla_rutina_dia (id, plantilla_rutina_id, dia_semana, foco);
create table plantilla_rutina_ejercicio (id, plantilla_rutina_dia_id, ejercicio_id, nombre, series, reps, carga, descanso, orden, notas);

create table plantilla_dieta (id uuid pk, objetivo_id uuid fk, nombre, suplementos, ...);
create table plantilla_comida (id, plantilla_dieta_id, nombre, hora, descripcion, kcal, orden, dia_semana);
```

- **Plantilla global (semilla):** vive en `plantilla_*`, sin empresa. La cargo yo.
- **Plantilla del gym:** cuando el gym edita una plantilla, se crea una fila en
  las MISMAS tablas `plantilla_*` con una columna `empresa_id` (nullable ahí):
  `empresa_id IS NULL` = global; `empresa_id = <gym>` = versión del gym que pisa
  la global para ese objetivo. (En estas tablas nuevas sí controlamos que
  empresa_id sea nullable.)
- La rutina/dieta **del socio** sigue en `rutina`/`dieta` tal cual (socio_id set),
  sin cambios de esquema salvo `objetivo_id` en socio.

Estructura copiada al asignar: `plantilla_rutina → …dia → …ejercicio` se copia a
`rutina → rutina_dia → rutina_ejercicio` del socio; `plantilla_dieta → comida`
a `dieta → comida`. Los ejercicios referencian el catálogo global (`ejercicio`,
384 disponibles) por `ejercicio_id` + `nombre`.

Ventaja de tablas separadas: no ensucia `rutina`/`dieta` con filas sin socio, no
toca su RLS por tenant, y las plantillas quedan claramente aparte.

## Sección 4 — Asignación automática

RPC `asignar_plan_automatico(p_socio_id uuid) returns jsonb`:
1. Lee `objetivo_id`, `peso_kg`, `talla_m` del socio. Si falta objetivo con
   plantilla o faltan peso/talla → devuelve `{asignado:false, motivo}`.
2. Calcula IMC = peso / talla² y su categoría OMS.
3. Resuelve la plantilla de rutina y dieta para el objetivo: la del gym
   (`empresa_id`) si existe, si no la global (`empresa_id is null`).
4. **Copia la rutina**: crea `rutina` del socio (activa, enviado_at=now) + sus
   `rutina_dia` + `rutina_ejercicio`. Aplica la nota/ajuste de intensidad por IMC.
5. **Copia la dieta**: crea `dieta` del socio + `comida` con las `kcal` ajustadas
   por el factor de IMC. Recalcula totales.
6. Devuelve resumen: `{asignado:true, objetivo, imc, categoria, rutina_dias,
   dieta_kcal_dia}` para el aviso.

Idempotente: si el socio ya tiene rutina/dieta activa de plantilla, no duplica
(se puede re-generar sólo si el trainer lo pide explícitamente — fuera de v1).

`inscribir_socio` la llama al final (dentro de la misma transacción, con
`perform`), y agrega el resumen del plan a su jsonb de retorno para el toast.

## Sección 5 — Editor de plantillas (panel)

**Rutinas → nueva pestaña "Plantillas":**
- Lista las 8 plantillas (rutina + dieta por objetivo). Muestra global vs.
  "personalizada por tu gym".
- Editar una plantilla: si es global, la primera edición **duplica a plantilla
  del gym** (`empresa_id` set) y edita esa copia; la global no se toca.
- "Restaurar a la original": borra la plantilla del gym → vuelve a usar la global.
- Reusa la UI de edición de rutina/dieta existente (días, ejercicios, comidas).

El plan **individual** del socio se edita en su ficha como hoy (sin cambios).

## Alcance

**Incluye:** catálogo objetivos, semilla 8 plantillas rutina + 8 dieta (contenido
real de ejercicios/comidas), modulación IMC (dieta cuantitativa + nota rutina),
asignación auto al inscribir con aviso, editor de plantillas en panel, mapeo de
objetivos de socios existentes.

**No incluye (futuro):** re-generar plan al cambiar el peso del socio, variantes
por sexo/edad, plantillas por sub-disciplina deportiva, macros detallados
(proteína/carbo/grasa) — sólo kcal por ahora.

## Verificación

- Inscribir un socio con objetivo "Bajar de peso" + peso/talla de sobrepeso →
  recibe rutina de bajar_peso + dieta con déficit, y el toast muestra el resumen.
- Un socio obeso II → su dieta tiene mayor déficit y la rutina lleva la nota de
  arranque progresivo.
- Un socio con objetivo "Otro" o sin peso → se inscribe sin plan (sin error).
- Editar una plantilla global en el panel → crea copia del gym, la global intacta;
  un socio nuevo de ese gym recibe la versión editada.
- E2E contra la BD: copia correcta de días/ejercicios/comidas, kcal ajustadas,
  idempotencia.
