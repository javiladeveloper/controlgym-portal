# Rutinas prediseñadas de casa + biblioteca navegable — Diseño

**Fecha:** 2026-07-29
**Repos:** ControlGym (backend Supabase + panel) y controlgym-app (app KMP/Compose)
**Objetivo:** que el usuario SIN gym (o cuyo gym no aparece) pueda entrenar en casa
con rutinas prediseñadas y curadas por caso de uso (full body, pilates, prenatal,
etc.) y explorar el catálogo de ejercicios con una biblioteca navegable.

---

## Contexto (estado actual verificado)

- El **"modo libre"** ya existe (PEDIDO 38/40): la pestaña "Mi rutina" del Home está
  siempre disponible, con o sin gym. Genera rutinas por objetivo/nivel/días/equipo
  desde `ejercicio_catalogo` (catálogo global, 1,324 ejercicios con GIF).
- Tablas existentes: `rutina_libre`, `rutina_libre_dia`, `rutina_libre_ejercicio`
  (una activa por usuario, RLS por `auth.uid()`), helper `_rutina_libre_detalle()`,
  RPCs `generar_rutina_libre()` y `mi_rutina_libre()`.
- El equipo "en casa" se mapea a `ejercicio_catalogo.equipment = 'body weight'`
  (~325 ejercicios). No hay columna "en casa"; es el string `equipment`.
- Las **"alternativas"** hoy NO son un sistema persistente: el botón ⇄ "Alternar"
  llama `buscar_ejercicios_catalogo(p_target = target)` y muestra otros ejercicios
  del mismo músculo; al elegir uno solo abre su detalle (GIF), NO reemplaza en la
  rutina. No hay swap real en ninguna parte del sistema (ni en las rutinas del gym).

## Decisiones tomadas con el owner

- **Ambas** features: rutinas prediseñadas + biblioteca navegable.
- Rutinas **curadas a mano** por nosotros (elegimos los ejercicios del catálogo),
  empezando con unas ~5 de calidad; estructura extensible por SQL.
- **Alternativas curadas por ejercicio** (no el "alternar" automático por músculo),
  **sin swap** (no reemplaza en la rutina; solo se muestran con su GIF). Motivo: en
  prenatal/pilates el match automático por músculo puede sugerir ejercicios
  contraindicados; las curadas las apruebas tú.
- **Prenatal/especiales con aviso médico visible** (`disclaimer_salud`).
- Al **adoptar** una prediseñada, las alternativas curadas NO viajan a la rutina
  libre (para no cambiar `rutina_libre_ejercicio`); se ven en el detalle de la
  prediseñada. Una vez adoptada, "alternar" cae al comportamiento automático actual.
- Entradas a prediseñadas y biblioteca **dentro de la pestaña "Mi rutina"** (no
  pestañas nuevas del Home).
- **Verificación antes de release**: backend probado en rollback → aplicado a prod;
  app compila; commit/push; **NO crear tag/release** hasta que el owner verifique
  en vivo.

---

## Sección 1 — Modelo de datos (backend)

Tres tablas nuevas GLOBALES (sin `empresa_id`, como `ejercicio_catalogo`):

```sql
create table public.rutina_predisenada (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,          -- 'full-body-casa', 'prenatal', ...
  nombre        text not null,
  categoria     text not null,                 -- full_body_casa|pilates|prenatal|gluteos_casa|core_abdomen
  descripcion   text,
  nivel         text not null default 'principiante'
                  check (nivel in ('principiante','intermedio','avanzado')),
  dias_por_semana int not null check (dias_por_semana between 1 and 6),
  equipo        text not null default 'peso_corporal'
                  check (equipo in ('peso_corporal','mancuernas','gym_completo')),
  disclaimer_salud text,                       -- null salvo prenatal/especiales
  imagen        text,                          -- url opcional para la tarjeta
  orden         int not null default 0,
  activa        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.rutina_predisenada_dia (
  id            uuid primary key default gen_random_uuid(),
  predisenada_id uuid not null references public.rutina_predisenada(id) on delete cascade,
  dia_semana    int not null,
  foco          text
);

create table public.rutina_predisenada_ejercicio (
  id            uuid primary key default gen_random_uuid(),
  predisenada_dia_id uuid not null references public.rutina_predisenada_dia(id) on delete cascade,
  catalogo_id   uuid not null references public.ejercicio_catalogo(id),
  nombre        text not null,
  series        int,
  reps          text,
  descanso      text,
  orden         int not null default 0,
  alternativas_ids uuid[] not null default '{}'  -- ejercicios del catálogo, CURADOS
);
```

Índices: `rutina_predisenada(categoria, activa, orden)`,
`rutina_predisenada_dia(predisenada_id)`, `rutina_predisenada_ejercicio(predisenada_dia_id)`.

**RLS:** las 3 tablas con RLS activa; policy de SELECT para `authenticated`
(catálogo compartido, cualquiera lo lee). Escritura solo `service_role` (curado por
SQL/panel admin). Grants: `select` a `authenticated`; no insert/update/delete a
`authenticated`.

---

## Sección 2 — RPCs (backend)

Todas `security definer set search_path = public`, con `revoke all from public` +
`grant execute to authenticated` (patrón del repo).

1. **`listar_rutinas_predisenadas(p_categoria text default null, p_equipo text default null)` → jsonb**
   Array de tarjetas de las prediseñadas `activa`, filtrable por categoría/equipo,
   ordenado por `orden`. Cada tarjeta:
   `{ id, slug, nombre, categoria, descripcion, nivel, dias_por_semana, equipo, disclaimer_salud, imagen }`.

2. **`detalle_rutina_predisenada(p_id uuid)` → jsonb**
   Mismo shape que `_rutina_libre_detalle` (para reusar la pantalla de detalle):
   `{ id, nombre, categoria, descripcion, nivel, dias_por_semana, equipo, disclaimer_salud,
      dias: [ { dia_semana, foco, ejercicios: [ {
        nombre, series, reps, descanso, orden, catalogo_id, target, body_part,
        grupo_muscular, secondary, equipment, gif_url, video_url, foto_url, descripcion,
        alternativas: [ { catalogo_id, nombre, target, equipment, gif_url, foto_url } ]
      } ] } ] }`.
   Las `alternativas` se resuelven uniendo `alternativas_ids` contra `ejercicio_catalogo`.

3. **`adoptar_rutina_predisenada(p_id uuid)` → jsonb**
   Copia la prediseñada a la rutina libre activa del usuario: borra la `rutina_libre`
   activa anterior (como `generar_rutina_libre`), crea `rutina_libre` +
   `rutina_libre_dia` + `rutina_libre_ejercicio` a partir de la prediseñada (sin
   `alternativas_ids`; esa columna no existe en la libre). Devuelve
   `_rutina_libre_detalle(nueva_rutina)`. Falla con excepción si la prediseñada no
   existe o no está activa.

4. **Biblioteca:** se reutiliza la RPC existente
   `buscar_ejercicios_catalogo(p_texto, p_body_part, p_equipment, p_target, p_offset, p_limit)`.
   No se crea RPC nueva.

---

## Sección 3 — App móvil (KMP)

Entradas nuevas dentro de la pestaña "Mi rutina" (que ya está siempre disponible en
`PantallaHome.kt`). NO se toca `SocioAppViewModel` ni el wizard actual.

**Modelos** (`data/modelos/RutinaPredisenada.kt`): `RutinaPredisenadaCard`,
`RutinaPredisenadaDetalle` (reusa el modelo de detalle de rutina libre + lista de
alternativas por ejercicio), `EjercicioAlternativa`.

**Repositorio** (`data/repositorio/RutinaPredisenadaRepositorio.kt` + impl Supabase):
- `listar(categoria?, equipo?)` → `rpc("listar_rutinas_predisenadas")`
- `detalle(id)` → `rpc("detalle_rutina_predisenada")`
- `adoptar(id)` → `rpc("adoptar_rutina_predisenada")`
- Biblioteca: reutiliza `PlanesRepositorio.buscar...`/`buscar_ejercicios_catalogo`.

**Pantallas:**
1. `PantallaRutinasPredisenadas` (galería): grid de tarjetas por categoría; filtro de
   equipo. Toca → detalle.
2. Detalle de prediseñada: reutiliza el layout de rutina libre (días/ejercicios con
   GIF) + bloque de **alternativas curadas** por ejercicio (muestra su GIF con el
   `DialogoSugerencia` existente). Banner `disclaimer_salud` si existe. Botón "Usar
   esta rutina" → `adoptar` → navega a "Mi rutina".
3. `PantallaBiblioteca`: buscador del catálogo con filtros equipo + zona/músculo; cada
   resultado abre el `DialogoSugerencia` de detalle existente.

**ViewModels** (`PredisenadasViewModel`, `BibliotecaViewModel`): patrón existente
(`viewModelScope` + `MutableStateFlow`/`asStateFlow`, sin `onCleared`).

---

## Sección 4 — Contenido curado (seed)

Migración de seed que inserta ~5 prediseñadas, eligiendo `catalogo_id` reales
(verificados contra la BD antes de insertar; si el catálogo no tiene buenos
ejercicios seguros para alguna categoría —posible en prenatal— se ajusta y se avisa
al owner, sin inventar ejercicios inexistentes):

- Full body en casa — peso_corporal, 3 días, principiante
- Pilates / core — peso_corporal, 3 días
- Prenatal / embarazadas — peso_corporal, suave, con `disclaimer_salud`
- Glúteos en casa — peso_corporal + banda
- Core / abdomen — peso_corporal

Cada ejercicio con 2-3 `alternativas_ids` curadas.

`disclaimer_salud` prenatal (texto): "Consulta con tu médico antes de comenzar
cualquier rutina durante el embarazo. Detente si sientes molestias."

---

## Verificación

- **Backend**: migración (tablas + RPCs + seed) probada en transacción `rollback`
  contra prod (proyecto zlmqdubrjzmagslcsqvb) — verificar tablas creadas, las 3 RPCs
  existen, `listar`/`detalle` devuelven el shape esperado, `adoptar` copia a
  `rutina_libre` (contar días/ejercicios). Luego aplicar a prod.
- **RPCs con sesión authenticated** (no solo service_role): confirmar que `adoptar`
  respeta `auth.uid()` y que `detalle` resuelve alternativas.
- **App**: `gradlew compileCommonMainKotlinMetadata` limpio.
- **Panel**: no se toca; correr `npm test` solo si cambia algún archivo compartido.
- **Deploy**: aplicar migración a prod + commit/push app + push backend. **NO crear
  tag/release** hasta que el owner verifique en vivo.

## Fuera de alcance (YAGNI / más adelante)

- **Swap real** de ejercicio (reemplazar y persistir en la rutina): no existe en
  ningún lado del sistema; se evalúa aparte si se pide.
- **Panel admin** para curar prediseñadas por UI: por ahora se curan por SQL (seed y
  migraciones). Se puede añadir después.
- Alternativas curadas viajando a la rutina libre al adoptar (requeriría columna
  nueva en `rutina_libre_ejercicio`).
