# Plantillas editables + duración heredada — diseño

## Problema

En **Rutinas y dietas → Plantillas** el admin ve las plantillas por objetivo
(Bajar de peso, Ganar masa, …) con el badge **"Global"**, y **no puede editarlas**:
el botón "✎ Editar ejercicios" solo se renderiza cuando el gym ya tiene su versión
personalizada (`rGym`), y no existe forma de crear esa versión desde esa pantalla.
Resultado: para un gym nuevo (todas sus plantillas son globales) el editor es
inalcanzable — parece que la funcionalidad no existe.

Además, **las plantillas no tienen duración**. La rutina del socio sí tiene
vigencia (se ve en su ficha), pero el molde del que sale no propone ningún ciclo:
el trainer tiene que elegir la duración a mano cada vez.

## Decisiones tomadas con el owner

- **La duración de la plantilla se HEREDA, la plantilla no caduca.** La plantilla
  lleva una duración sugerida (ej. 8 semanas) que al asignarla **pre-llena** la
  vigencia de la rutina del socio. El molde en sí no expira ni se archiva.
- **Pre-llena pero editable:** el trainer puede cambiar la duración para ese socio
  al asignar. La plantilla sugiere; el trainer decide.
- **Editar una Global crea automáticamente la copia del gym** (copy-on-write). El
  admin solo pulsa "Editar"; el sistema protege la global por detrás.
- **Alcance: rutinas Y dietas.** Ambas plantillas deben poder editarse y llevar
  duración.

## Arquitectura — copy-on-write

Cuando el admin pulsa **✎ Editar** sobre una plantilla:

1. Si ya es del gym (`empresa_id = su empresa`) → se edita directo (lo de hoy).
2. Si es **Global** (`empresa_id is null`) → el sistema **copia** la plantilla
   completa (rutina: días + ejercicios / dieta: comidas) a una plantilla propia
   del gym, y edita **esa copia**. La global queda intacta para los demás gyms.
3. El badge pasa solo de "Global" a "Personalizada (tu gym)".

**Por qué así:** el admin no necesita entender la distinción global/propia — solo
edita. Y es imposible que rompa las plantillas de otros gyms del SaaS.

**RPC nueva** `plantilla_personalizar(p_plantilla_id uuid, p_tipo text)`:
- `p_tipo` = `'rutina'` | `'dieta'`.
- Copia la plantilla y toda su descendencia a una nueva con `empresa_id` = empresa
  del llamante. Devuelve el id de la copia.
- **Idempotente**: si el gym YA tiene su plantilla para ese objetivo+tipo, devuelve
  esa en vez de crear otra (evita duplicados si el admin pulsa dos veces).
- Solo **admin**; valida empresa activa; rechaza escribir sobre una global.

## Duración heredada

**Migración:** `duracion_semanas int` (nullable) en `plantilla_rutina` y
`plantilla_dieta`. Nullable = plantilla sin duración sugerida (comportamiento
actual, no rompe nada existente).

- Se edita **dentro del editor** de la plantilla: un selector 4 / 8 / 12 / 16
  semanas (los mismos valores que ya usa la vigencia de la rutina del socio), más
  la opción "sin sugerencia".
- **Al asignar** (modal "⚡ Usar plantilla"): el selector de vigencia se
  **pre-llena** con `duracion_semanas` de la plantilla usada. Si la plantilla no
  tiene, se mantiene el default actual. El trainer puede cambiarlo siempre.
- Guardar la duración de la plantilla usa la misma vía copy-on-write: si el admin
  cambia la duración de una Global, primero se personaliza y se guarda en su copia.

## Componentes

### Backend
- Migración: `duracion_semanas` en `plantilla_rutina` y `plantilla_dieta`.
- RPC `plantilla_personalizar(p_plantilla_id, p_tipo)` — copy-on-write, idempotente.
- RPC `plantilla_set_duracion(p_plantilla_id, p_tipo, p_semanas)` — fija la duración
  (valida que la plantilla sea del gym; el panel llama antes a `plantilla_personalizar`
  si era global).
- RPCs de comidas para el editor de dieta, espejo de las de ejercicio ya existentes:
  `plantilla_comida_agregar / plantilla_comida_editar / plantilla_comida_quitar`
  sobre `plantilla_comida` (nombre, hora, descripcion, kcal, orden, dia_semana).
- Todas: `security definer`, validan `empresa_id = auth_empresa_id()` y rol admin,
  y `revoke ... from public, authenticated` + grant explícito (regla del repo).

### Panel (`src/pages/Rutinas.jsx`, pestaña Plantillas)
- Botón **"✎ Editar"** visible SIEMPRE (global o propia), para rutina y para dieta.
  Al pulsarlo sobre una global: llama `plantilla_personalizar`, refresca, y abre el
  editor sobre la copia recién creada.
- `PlantillaEditor` (rutina) — ya existe; se le suma el **selector de duración**.
- `PlantillaDietaEditor` (dieta) — **nuevo**, espejo del de rutina: comidas por día
  con nombre, hora, descripción y kcal; mismo patrón de filas editables.
- Modal "⚡ Usar plantilla": pre-llena la vigencia con la duración de la plantilla.

## Verificación

- **BD (rollback):** `plantilla_personalizar` copia días+ejercicios (y comidas)
  completos; llamarla dos veces NO duplica (idempotente); un gym no puede
  personalizar ni editar la plantilla de otro; nunca se escribe sobre la global.
- **Duración:** fijarla en la plantilla y comprobar que "Usar plantilla" pre-llena
  ese valor; que sigue siendo editable por el trainer; plantilla sin duración →
  default de hoy.
- **Panel (Playwright):** desde un gym con todas sus plantillas globales, pulsar
  "Editar" → aparece el editor y el badge cambia a "Personalizada (tu gym)";
  agregar/quitar un ejercicio y una comida; cambiar la duración. 0 errores de
  consola. `npm test` + `npm run build` limpios.

## Fuera de alcance

- **Que la plantilla caduque/se archive** (retirar planes viejos del catálogo): el
  owner eligió solo la duración heredada. Si más adelante se quiere, se suma un
  `vencida_at` sin tocar este diseño.
- **Editar la plantilla GLOBAL del sistema** (afectaría a todos los gyms): sigue
  siendo de solo lectura. Un cambio así sería una herramienta de superadmin aparte.
- **Macros//nutrientes detallados en la dieta**: el editor cubre los campos que la
  tabla ya tiene (nombre, hora, descripción, kcal). Nada nuevo de nutrición.
