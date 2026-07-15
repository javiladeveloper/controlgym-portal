# Catálogo de ejercicios (1,324 con GIF, multi-idioma) — Diseño

**Fecha:** 2026-07-14
**Estado:** Aprobado (brainstorming), pendiente plan de implementación
**Fuente de datos:** [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) (MIT; medios © Gymvisual)

## Objetivo

Integrar un catálogo global de **1,324 ejercicios** a FitCore, con GIF animado,
imagen, instrucciones y pasos en **9 idiomas**, músculo objetivo/secundarios y
equipo. Reemplaza al catálogo maestro actual (`ejercicio_maestro`, hoy 47) como
fuente global, y habilita features de biblioteca visual, filtro por equipo y
generación de rutinas — para **panel** y **app del socio**.

## Contexto del modelo actual (verificado)

- `ejercicio_maestro` — catálogo GLOBAL curado (47 filas): `nombre, grupo_muscular,
  descripcion, video_url, foto_url`. Sin `empresa_id`. Solo lectura para gyms.
- `ejercicio` — catálogo POR EMPRESA (384 filas, `empresa_id`): misma forma.
  Es lo que las rutinas referencian (FK desde `rutina_ejercicio` y
  `plantilla_rutina_ejercicio`).
- **Herencia**: trigger `trg_ejercicio_hereda_maestro` (BEFORE INSERT en
  `ejercicio`): si la fila nueva viene sin media y el maestro tiene un ejercicio
  con el mismo `lower(nombre)`, copia `descripcion/video_url/foto_url/grupo_muscular`
  UNA vez. A partir de ahí la media es del gym.
- Rutinas: `rutina`/`rutina_dia`/`rutina_ejercicio` (asignadas al socio) y
  `plantilla_rutina`/`plantilla_rutina_dia`/`plantilla_rutina_ejercicio` (plantillas
  reutilizables, con series/reps/descanso/carga). `registro_entreno` (ejecución).
- `objetivo_entrenamiento` (8 objetivos: bajar_peso, ganar_masa, tonificar,
  fuerza, resistencia, salud_general, rehabilitacion, prep_deportiva) con campo
  `enfoque` descriptivo.
- `maquina` (empresa/sede) = máquinas físicas del gym (con zona/unidades) — es
  otro concepto, NO el "tipo de equipo" del dataset.

## Decisiones tomadas (con el owner)

1. **Tabla nueva rica** `ejercicio_catalogo` (Enfoque A: reemplazo). Reemplaza a
   `ejercicio_maestro` como fuente global; el trigger de herencia se re-apunta a
   ella. `ejercicio_maestro` se conserva (seguridad) pero se depreca.
2. **Medios → Supabase Storage** (bucket público `ejercicios`). Riesgo legal
   registrado: los GIF/imágenes son © Gymvisual; servirlos desde Storage en un
   producto de pago es redistribución comercial → **validar términos con Gymvisual
   en paralelo** (decisión de negocio del owner, no bloqueante técnico).
3. **9 idiomas** guardados como `jsonb` (flexibilidad futura).
4. **Nombre**: inglés del dataset + `nombre_es` (traducción provista por el owner,
   validada 1,324/1,324 en `scripts/datos-ejercicios/nombres_es.txt`). UI muestra
   `coalesce(nombre_es, nombre)`.
5. **Alcance**: backend + panel + PEDIDO app. Las 4 features van al spec; se
   implementan "todo de una" con criterios de terminado por feature.

## Esquema de datos

### Tabla `ejercicio_catalogo` (nueva, global)

```sql
create table public.ejercicio_catalogo (
  id             uuid primary key default gen_random_uuid(),
  ext_id         text not null unique,        -- "0001" del dataset (idempotencia)
  nombre         text not null,               -- inglés (fuente)
  nombre_es      text,                         -- traducción del owner
  body_part      text not null,               -- back, chest, waist, cardio…
  grupo_muscular text,                          -- muscle_group (sinergista)
  target         text,                          -- músculo objetivo (abs, biceps…)
  secondary      text[] default '{}',           -- músculos secundarios
  equipment      text,                          -- barbell, body weight, cable…
  instrucciones  jsonb not null default '{}',   -- {en, es, it, tr, ru, zh, hi, pl, ko}
  pasos          jsonb not null default '{}',   -- {en:[...], es:[...], …}
  media_id       text,
  foto_url       text,                          -- URL pública en Storage
  gif_url        text,                          -- URL pública en Storage
  attribution    text,                          -- "© Gym visual"
  activo         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

Índices: `body_part`, `equipment`, `target`, y GIN/trigram para búsqueda por
`nombre`/`nombre_es`. RLS: SELECT para `authenticated`; escritura solo
`service_role` (curado por plataforma, igual que el maestro).

## Fase A — Importación (idempotente)

Script Node en `scripts/` (fuera de `api/`, no cuenta para el límite Vercel de
12 funciones). Corre con service_role.

1. Lee `scripts/datos-ejercicios/exercises.json` (1,324) +
   `nombres_es.txt` (mapa ext_id→nombre_es).
2. `upsert` por `ext_id` en `ejercicio_catalogo`. Mapeo:
   `name→nombre`, `nombres_es[id]→nombre_es`, `body_part→body_part`,
   `muscle_group→grupo_muscular`, `target→target`, `secondary_muscles→secondary`,
   `equipment→equipment`, `instructions→instrucciones` (jsonb),
   `instruction_steps→pasos` (jsonb), `media_id`, `attribution`.
3. Re-correr no duplica (upsert por ext_id).

## Fase B — Medios a Storage

1. Bucket público `ejercicios`.
2. Subir `images/*.jpg` → `ejercicios/img/<ext_id>.jpg`; `videos/*.gif` →
   `ejercicios/gif/<ext_id>.gif`. **Idempotente**: no re-sube lo que ya existe.
3. Actualizar `foto_url`/`gif_url` con la URL pública.
4. ~139 MB (12 MB img + 127 MB gif).

## Fase C — Herencia (re-apuntar trigger)

1. Migrar los 47 de `ejercicio_maestro` a `ejercicio_catalogo` por nombre: los
   que ya existan en el dataset se ignoran; los que no, se insertan (no perder
   contenido curado). ext_id de los migrados: `maestro-<uuid>` para distinguirlos.
2. Reescribir `trg_ejercicio_hereda_maestro` para leer de `ejercicio_catalogo`
   casando por `lower(nombre)` OR `lower(nombre_es)` (así "Curl con barra"
   también hereda). Copia `descripcion` (de instrucciones.es), `video_url`
   (gif_url), `foto_url`, `grupo_muscular`.
3. `ejercicio_maestro` deja de escribirse (deprecado; tabla conservada).

## Feature 1 — Biblioteca visual con GIF (panel + app)

**RPC** `buscar_ejercicios_catalogo(p_texto, p_body_part, p_equipment, p_target,
p_cursor, p_limit)` → lista paginada con `id, ext_id, nombre_es|nombre, body_part,
equipment, target, gif_url, foto_url`. SECURITY DEFINER, grant authenticated.

**RPC** `ejercicio_catalogo_detalle(p_id)` → 1 ejercicio con pasos en el idioma
pedido (default es) + secundarios.

**Panel** (`Rutinas.jsx`): buscador de ejercicios con GIF, filtros por
body_part/equipment/target. Al elegir uno para una rutina/plantilla, se
materializa en `ejercicio` del gym (heredando media vía el trigger).

**PEDIDO app**: la app consume las mismas RPCs para la biblioteca de ejercicios
del socio (GIF + pasos ES) y sus rutinas asignadas. Documentado en
`docs/APP-BACKEND-REQUESTS.md`.

**Terminado cuando:** el panel busca/filtra el catálogo, muestra GIF, y agrega un
ejercicio del catálogo a una rutina; el PEDIDO app está escrito.

## Feature 2 — Filtro por equipo del gym

El gym marca qué **tipos de equipo** tiene (los 28 del dataset: barbell, dumbbell,
cable, body weight…). El catálogo se filtra a lo que puede hacer.

- Tabla `sede_equipo_disponible(sede_id, equipment, disponible bool)` o un
  `text[]` en config de sede (a decidir en el plan; preferir tabla por claridad).
- UI en config/sede: checklist de los 28 tipos.
- `buscar_ejercicios_catalogo` acepta `p_solo_disponibles` que cruza con lo que
  la sede marcó.

**Terminado cuando:** el gym marca su equipo y el buscador puede limitarse a esos.

## Feature 3 — Generador de rutina por objetivo/músculo

Auto-arma una **plantilla_rutina** editable a partir de objetivo + parámetros.

- RPC `generar_plantilla_rutina(p_empresa_id, p_objetivo_codigo, p_dias,
  p_equipo_disponible)` que, según el `enfoque` del objetivo, selecciona
  ejercicios del catálogo balanceando `body_part`/`target`, crea
  `plantilla_rutina` + `plantilla_rutina_dia` + `plantilla_rutina_ejercicio` con
  series/reps/descanso por defecto según el objetivo.
- Reglas base por objetivo (ej. ganar_masa → split por grupo, 4x8-12;
  resistencia → circuitos, alto volumen). Editable después por el gym.
- Respeta el filtro de equipo (Feature 2) si se pasa.

**Terminado cuando:** elegir objetivo + días genera una plantilla coherente y
editable, con ejercicios reales del catálogo.

## Futuro habilitado (NO en esta entrega)

- Sustituir ejercicio por mismo `target` con distinto `equipment`.
- Rutina "sin equipo/en casa" (325 body-weight) como segmento.
- Leadia arma/explica rutinas con este catálogo.
- GIF en `registro_entreno` durante la ejecución.

## Verificación

- Importación: 1,324 filas en `ejercicio_catalogo`, `nombre_es` en todas,
  re-correr no duplica.
- Storage: foto_url/gif_url resuelven a un objeto público real (HTTP 200).
- Herencia: crear un `ejercicio` en un gym con nombre del catálogo hereda su
  media desde `ejercicio_catalogo` (probar en rollback).
- RPCs: búsqueda paginada y filtros devuelven lo esperado; detalle trae pasos ES.
- Panel: buscador con GIF funciona; se agrega un ejercicio a una rutina.
- Generador: produce una plantilla coherente para 2-3 objetivos distintos.
- `npm test` + `npm run build` limpios; ≤12 funciones serverless.

## Riesgos

- **Licencia Gymvisual** (media): validar términos para uso comercial. Registrado.
- **Tamaño Storage** (139 MB): egress/costo — aceptado por el owner.
- **Tocar el trigger de herencia**: probar en rollback antes de aplicar, para no
  romper la creación de ejercicios de los gyms.
