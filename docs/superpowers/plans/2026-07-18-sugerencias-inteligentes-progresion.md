# Sugerencias inteligentes de progresión — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analizar cómo el socio entrenó ejercicio-por-ejercicio (adherencia + evolución de carga) y sugerir ajustes específicos por ejercicio (adaptado / evitado / estancado / día abandonado), respaldados por sobrecarga progresiva, para el mundo A (trainer aprueba) y dejando el backend listo para el mundo B (app pregunta al usuario).

**Architecture:** Un **motor puro JS** `analizarProgresion(ejercicios)` clasifica cada ejercicio con reglas fundamentadas (regla 2-por-2 de ACSM, deload por 3 fallos, incremento por grupo muscular). Lo alimenta una **RPC enriquecida** `analizar_progresion_socio(p_socio_id)` que devuelve, por ejercicio de la rutina activa: grupo muscular, series/reps objetivo, y la serie temporal de sesiones (fecha, completado, carga). El panel (`ProgresoRenovarModal` en Rutinas.jsx) muestra las señales al lado de cada ejercicio; el trainer edita con la edición ya existente. Se agrega `carga_usada` a `registro_entreno_libre` y un PEDIDO a la app para el mundo B.

**Tech Stack:** Supabase Postgres (migraciones vía MCP `apply_migration`, proyecto `zlmqdubrjzmagslcsqvb`), plpgsql, React + `@tanstack/react-query`, Vitest.

## Global Constraints

- **RPC seguras:** toda RPC nueva debe `revoke all ... from public, authenticated` explícitamente y regrantear solo a quien corresponde — `revoke from public` NO basta en este esquema (hay default privilege a `authenticated`). Las RPC de lectura del panel se otorgan a `authenticated` pero validan empresa internamente (`security definer`, `auth_empresa_id()`).
- **Aislamiento multi-tenant:** todo dato leído se filtra por `empresa_id = auth_empresa_id()`. Un trainer solo ve socios de su empresa.
- **Degradación sin carga:** `registro_entreno_ejercicio` tiene 0 filas hoy (la app aún no persiste, PEDIDO 46). El motor debe dar `evitado` / `día_abandonado` (que solo necesitan completado sí/no) sin datos de carga, y `adaptado` / `estancado` solo cuando hay serie de carga. Nunca romper con datos vacíos.
- **El sistema informa; el humano ajusta.** Ninguna RPC aplica un cambio de carga automáticamente. El trainer edita a mano; la app (mundo B) pregunta al usuario.
- **Umbrales fundamentados (spec):** subir tras completar el objetivo **2 sesiones consecutivas** (regla 2-por-2, novato); **3** (intermedio). Incremento: tren inferior +2.5–5 kg, tren superior compuesto +1.25–2.5 kg, aislado +0.5–1 kg (usar extremo bajo). Estancado: fallar el objetivo con la misma carga **3 sesiones seguidas**. `evitado`: tasa < 0.30. `día abandonado`: adherencia del día < 0.20.
- **Sin dependencias nuevas.** Reusar los patrones existentes (`sugerenciasRutina.js`, `useProgresion.js`, `progreso_socio`).

---

## Estructura de archivos

- `src/lib/analizarProgresion.js` (crear) — motor puro: `analizarProgresion(ejercicios) → { ejercicios: [...], dias: [...] }`. Sin I/O, testeable solo.
- `tests/analizarProgresion.test.js` (crear) — casos del motor.
- `supabase/migrations/20260718150000_analizar_progresion.sql` (crear) — RPC `analizar_progresion_socio(p_socio_id)`.
- `supabase/migrations/20260718151000_registro_libre_carga.sql` (crear) — `registro_entreno_libre += carga_usada numeric`.
- `src/hooks/useProgresion.js` (modificar) — agregar `useAnalizarProgresion(socioId)`.
- `src/pages/Rutinas.jsx` (modificar) — enriquecer `ProgresoRenovarModal` con las señales por ejercicio.
- `docs/APP-BACKEND-REQUESTS.md` (modificar) — PEDIDO nuevo (mundo B: carga en rutina libre + consumir el motor).

---

## Task 1: Motor de clasificación por ejercicio (JS puro)

El cerebro. Recibe ejercicios ya normalizados (la RPC de la Task 2 los produce con ese shape) y clasifica cada uno. Sin BD, sin red — pura lógica testeable.

**Files:**
- Create: `src/lib/analizarProgresion.js`
- Test: `tests/analizarProgresion.test.js`

**Interfaces:**
- Consumes: nada (función pura).
- Produces: `analizarProgresion(ejercicios)` donde `ejercicios` es
  ```
  [{
    ejercicio: string,           // nombre
    grupo_muscular: string|null, // 'pecho', 'pierna', etc (o null si no enlazado)
    dia: string|null,            // nombre/número del día
    series_obj: number|null,     // series objetivo (rutina_ejercicio.series)
    veces_esperado: number,      // cuántas veces tocaba en el periodo
    sesiones: [{ fecha: string, completado: boolean, carga: number|null }]  // orden cronológico
  }]
  ```
  Devuelve `{ ejercicios: [{ ...entrada, veces_completado, tasa, estado, sugerencia }], dias: [{ dia, tasa, abandonado }] }`.
  - `estado`: `'adaptado' | 'evitado' | 'estancado' | 'normal'`
  - `sugerencia`: `{ tipo, texto, incremento_kg?: number }` o `null`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest'
import { analizarProgresion, incrementoPorGrupo } from '../src/lib/analizarProgresion.js'

const ses = (arr) => arr.map(([fecha, completado, carga]) => ({ fecha, completado, carga }))

describe('incrementoPorGrupo', () => {
  it('tren inferior → 2.5 kg', () => {
    expect(incrementoPorGrupo('pierna')).toBe(2.5)
    expect(incrementoPorGrupo('cuadriceps')).toBe(2.5)
  })
  it('compuesto tren superior → 1.25 kg', () => {
    expect(incrementoPorGrupo('pecho')).toBe(1.25)
    expect(incrementoPorGrupo('espalda')).toBe(1.25)
  })
  it('aislado → 0.5 kg', () => {
    expect(incrementoPorGrupo('biceps')).toBe(0.5)
  })
  it('grupo desconocido/null → 1.25 kg (default conservador)', () => {
    expect(incrementoPorGrupo(null)).toBe(1.25)
    expect(incrementoPorGrupo('rarísimo')).toBe(1.25)
  })
})

describe('analizarProgresion', () => {
  it('completa el objetivo 2 sesiones seguidas con misma carga → adaptado, sugiere subir', () => {
    const r = analizarProgresion([{
      ejercicio: 'Press banca', grupo_muscular: 'pecho', dia: 'Día 1', series_obj: 4,
      veces_esperado: 3, sesiones: ses([['2026-07-01', true, 60], ['2026-07-03', true, 60]]),
    }])
    const e = r.ejercicios[0]
    expect(e.estado).toBe('adaptado')
    expect(e.sugerencia.incremento_kg).toBe(1.25)
    expect(/sub/i.test(e.sugerencia.texto)).toBe(true)
  })

  it('evita el ejercicio (tasa < 0.30) → evitado, replantear', () => {
    const r = analizarProgresion([{
      ejercicio: 'Sentadilla', grupo_muscular: 'pierna', dia: 'Día 2', series_obj: 4,
      veces_esperado: 8, sesiones: ses([['2026-07-01', true, 40]]),  // 1 de 8 = 0.125
    }])
    const e = r.ejercicios[0]
    expect(e.estado).toBe('evitado')
    expect(/replante|evit|motiv/i.test(e.sugerencia.texto)).toBe(true)
  })

  it('falla el objetivo 3 sesiones seguidas con misma carga → estancado, deload', () => {
    const r = analizarProgresion([{
      ejercicio: 'Peso muerto', grupo_muscular: 'pierna', dia: 'Día 3', series_obj: 5,
      veces_esperado: 4,
      // viene (registra) pero no completa: 3 fallos seguidos a 100
      sesiones: ses([['2026-07-01', false, 100], ['2026-07-03', false, 100], ['2026-07-05', false, 100]]),
    }])
    const e = r.ejercicios[0]
    expect(e.estado).toBe('estancado')
    expect(/deload|baj|cambi|10%/i.test(e.sugerencia.texto)).toBe(true)
  })

  it('sin datos de carga: completa siempre → adaptado igual (usa completado), sin incremento_kg fiable', () => {
    const r = analizarProgresion([{
      ejercicio: 'Press', grupo_muscular: 'pecho', dia: 'Día 1', series_obj: 4,
      veces_esperado: 2, sesiones: ses([['2026-07-01', true, null], ['2026-07-03', true, null]]),
    }])
    const e = r.ejercicios[0]
    expect(e.estado).toBe('adaptado')
    expect(e.sugerencia.incremento_kg).toBe(1.25) // sugiere el salto por grupo aunque no sepa la carga base
  })

  it('normal: completa a veces, sin racha → normal, sin sugerencia', () => {
    const r = analizarProgresion([{
      ejercicio: 'Remo', grupo_muscular: 'espalda', dia: 'Día 1', series_obj: 4,
      veces_esperado: 4, sesiones: ses([['2026-07-01', true, 50], ['2026-07-03', false, 50]]),
    }])
    const e = r.ejercicios[0]
    expect(e.estado).toBe('normal')
    expect(e.sugerencia).toBe(null)
  })

  it('día abandonado: todos los ejercicios del día con adherencia < 0.20', () => {
    const r = analizarProgresion([
      { ejercicio: 'Sentadilla', grupo_muscular: 'pierna', dia: 'Día 2', series_obj: 4, veces_esperado: 8, sesiones: ses([['2026-07-01', true, 40]]) },
      { ejercicio: 'Prensa', grupo_muscular: 'pierna', dia: 'Día 2', series_obj: 4, veces_esperado: 8, sesiones: [] },
    ])
    const dia = r.dias.find(d => d.dia === 'Día 2')
    expect(dia.abandonado).toBe(true)
  })

  it('entrada vacía → { ejercicios: [], dias: [] } sin romper', () => {
    expect(analizarProgresion([])).toEqual({ ejercicios: [], dias: [] })
    expect(analizarProgresion(null)).toEqual({ ejercicios: [], dias: [] })
  })

  it('veces_esperado 0 → no divide por cero, estado normal', () => {
    const r = analizarProgresion([{
      ejercicio: 'X', grupo_muscular: null, dia: 'Día 1', series_obj: null,
      veces_esperado: 0, sesiones: [],
    }])
    expect(r.ejercicios[0].tasa).toBe(0)
    expect(r.ejercicios[0].estado).toBe('normal')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analizarProgresion.test.js`
Expected: FAIL — "Failed to resolve import ... analizarProgresion.js" / "analizarProgresion is not a function".

- [ ] **Step 3: Write the implementation**

```javascript
// src/lib/analizarProgresion.js
//
// Motor de sugerencias inteligentes de progresión. JS puro (sin BD/red) para
// poder testearlo. Recibe los ejercicios de una rutina ya normalizados (la RPC
// analizar_progresion_socio los produce con este shape, y la app hará lo mismo
// con la rutina libre) y clasifica cada uno según sobrecarga progresiva.
//
// Fundamento (docs/superpowers/specs/2026-07-18-sugerencias-inteligentes-progresion-design.md):
// - Subir carga tras completar el objetivo N sesiones seguidas (regla 2-por-2 ACSM):
//   N = 2 (novato) o 3 (intermedio), inferido del historial de carga.
// - Incremento por grupo muscular: tren inferior +2.5, superior compuesto +1.25,
//   aislado +0.5 (extremo bajo del rango, más sostenible).
// - Estancado: fallar el objetivo con la misma carga 3 sesiones seguidas → deload ~10%.
// - Evitado: tasa < 0.30. Día abandonado: adherencia del día < 0.20.

const TASA_EVITADO = 0.30
const TASA_DIA_ABANDONADO = 0.20
const FALLOS_ESTANCADO = 3       // 3 fallos seguidos = plateau (StrongLifts/Starting Strength)
const RACHA_NOVATO = 2           // 2-por-2 (ACSM): piso para sugerir subir
const RACHA_INTERMEDIO = 3

// Grupos musculares → incremento sugerido en kg (extremo bajo del rango del spec).
// Se compara en minúsculas y sin tildes contra substrings, para tolerar nombres
// libres del gym ('Cuádriceps', 'Pierna - femoral', etc).
const GRUPOS_INFERIOR = ['pierna', 'cuadriceps', 'femoral', 'gluteo', 'gemelo', 'pantorrilla', 'muslo']
const GRUPOS_SUPERIOR_COMPUESTO = ['pecho', 'espalda', 'dorsal', 'hombro', 'trapecio']
const GRUPOS_AISLADO = ['biceps', 'triceps', 'antebrazo', 'abdomen', 'core', 'abdominal']

function normalizar(txt) {
  return (txt || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Incremento sugerido según el grupo muscular. Default conservador (1.25) para
// desconocido/null: nunca sugerir un salto grande sin saber qué músculo es.
export function incrementoPorGrupo(grupo) {
  const g = normalizar(grupo)
  if (GRUPOS_INFERIOR.some((k) => g.includes(k))) return 2.5
  if (GRUPOS_AISLADO.some((k) => g.includes(k))) return 0.5
  if (GRUPOS_SUPERIOR_COMPUESTO.some((k) => g.includes(k))) return 1.25
  return 1.25
}

// Racha de sesiones consecutivas (desde la más reciente hacia atrás) que cumplen
// un predicado. Las sesiones vienen en orden cronológico ascendente.
function rachaFinal(sesiones, pred) {
  let n = 0
  for (let i = sesiones.length - 1; i >= 0; i--) {
    if (pred(sesiones[i])) n++
    else break
  }
  return n
}

// ¿La carga viene subiendo entre sesiones completadas? Si sube seguido cada
// pocas sesiones → novato (umbral bajo). Si es plana/lenta → intermedio.
// Sin datos de carga (todas null) → asumir novato (umbral más bajo, progresa antes).
function esNovato(sesiones) {
  const cargas = sesiones.filter((s) => s.completado && s.carga != null).map((s) => s.carga)
  if (cargas.length < 3) return true // poca historia → tratar como novato
  // si la carga subió al menos una vez en las últimas 3 completadas → aún progresando rápido
  const ult = cargas.slice(-3)
  return ult[ult.length - 1] > ult[0]
}

function clasificarEjercicio(ej) {
  const sesiones = Array.isArray(ej.sesiones) ? ej.sesiones : []
  const veces_completado = sesiones.filter((s) => s.completado).length
  const veces_esperado = Math.max(0, Number(ej.veces_esperado) || 0)
  const tasa = veces_esperado > 0 ? veces_completado / veces_esperado : 0

  const grupo = ej.grupo_muscular || null
  const incremento_kg = incrementoPorGrupo(grupo)

  // 1) EVITADO — casi no lo hace. No tiene sentido hablar de carga si no viene.
  if (veces_esperado > 0 && tasa < TASA_EVITADO) {
    return {
      ...ej, veces_completado, tasa, estado: 'evitado',
      sugerencia: {
        tipo: 'evitado',
        texto: `Casi no completa ${ej.ejercicio} (${veces_completado}/${veces_esperado}). Replantéalo o cámbialo por uno que sí haga; conversa la motivación.`,
      },
    }
  }

  // Para adaptado/estancado necesitamos que venga con constancia (tasa razonable).
  const constante = tasa >= 0.5

  // 2) ESTANCADO — viene y registra, pero falla el objetivo con la misma carga
  //    3 sesiones seguidas (plateau). Necesita datos: sesiones registradas.
  const fallosSeguidos = rachaFinal(sesiones, (s) => s.completado === false)
  if (constante && fallosSeguidos >= FALLOS_ESTANCADO) {
    return {
      ...ej, veces_completado, tasa, estado: 'estancado',
      sugerencia: {
        tipo: 'estancado',
        texto: `${ej.ejercicio} estancado (${fallosSeguidos} sesiones sin completar la misma carga). Baja ~10% y vuelve a subir (deload); si reincide, cambia el ejercicio o el esquema.`,
      },
    }
  }

  // 3) ADAPTADO — completa el objetivo N sesiones consecutivas → subir carga.
  //    Con datos de carga: exige que la carga se mantuvo (no bajó) en la racha.
  //    Sin datos de carga: solo la racha de completados.
  const N = esNovato(sesiones) ? RACHA_NOVATO : RACHA_INTERMEDIO
  const completadasSeguidas = rachaFinal(sesiones, (s) => s.completado === true)
  if (constante && completadasSeguidas >= N) {
    return {
      ...ej, veces_completado, tasa, estado: 'adaptado',
      sugerencia: {
        tipo: 'adaptado', incremento_kg,
        texto: `${ej.ejercicio}: completado ${completadasSeguidas} sesiones seguidas → el cuerpo se adaptó. Sube ~${incremento_kg} kg o cambia por una variante más exigente.`,
      },
    }
  }

  // 4) NORMAL — sigue igual.
  return { ...ej, veces_completado, tasa, estado: 'normal', sugerencia: null }
}

export function analizarProgresion(ejercicios) {
  if (!Array.isArray(ejercicios) || ejercicios.length === 0) {
    return { ejercicios: [], dias: [] }
  }

  const analizados = ejercicios.map(clasificarEjercicio)

  // Día abandonado: agrupar por día; si la adherencia promedio del día < 0.20,
  // marcarlo (el trainer ve un aviso a nivel día, no solo por ejercicio).
  const porDia = new Map()
  for (const e of analizados) {
    const key = e.dia || '—'
    if (!porDia.has(key)) porDia.set(key, [])
    porDia.get(key).push(e)
  }
  const dias = []
  for (const [dia, ejs] of porDia) {
    const tasa = ejs.reduce((a, e) => a + e.tasa, 0) / ejs.length
    dias.push({ dia, tasa, abandonado: tasa < TASA_DIA_ABANDONADO })
  }

  return { ejercicios: analizados, dias }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analizarProgresion.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: PASS (existing progresion.test.js + new file, all green).

- [ ] **Step 6: Commit**

```bash
git add src/lib/analizarProgresion.js tests/analizarProgresion.test.js
git commit -m "feat(progresion): motor de clasificación por ejercicio (adaptado/evitado/estancado)"
```

---

## Task 2: RPC `analizar_progresion_socio` (alimenta el motor)

Enriquece lo que hoy da `progreso_socio.adherencia_ejercicio` (solo `veces` + `carga_prom`) con lo que el motor necesita: por cada ejercicio de la rutina activa, su grupo muscular, series objetivo, cuántas veces tocaba, y la **serie cronológica** de sesiones (fecha, completado, carga). Los produce con el mismo periodo que `progreso_socio` calcula.

**Files:**
- Create: `supabase/migrations/20260718150000_analizar_progresion.sql`
- Verify: transacción rollback vía MCP `execute_sql`.

**Interfaces:**
- Consumes: tablas `rutina`, `rutina_dia`, `rutina_ejercicio` (con `ejercicio_id`, `series`), `ejercicio` (`grupo_muscular`), `registro_entreno_ejercicio` (`fecha`, `completado`, `carga_usada`).
- Produces: `analizar_progresion_socio(p_socio_id uuid) → jsonb`:
  ```
  {
    periodo: { inicio, fin },
    ejercicios: [{
      ejercicio, grupo_muscular, dia, series_obj, veces_esperado,
      sesiones: [{ fecha, completado, carga }]   // orden cronológico asc
    }]
  }
  ```
  El campo `sesiones` es exactamente el shape que consume `analizarProgresion(ejercicios)` de la Task 1.

- [ ] **Step 1: Escribir la migración**

Aplicar vía MCP `apply_migration` (name: `analizar_progresion`, project: `zlmqdubrjzmagslcsqvb`) con este SQL:

```sql
-- analizar_progresion_socio: por cada ejercicio de la rutina activa del socio,
-- devuelve grupo muscular, series objetivo, veces esperadas y la serie
-- cronológica de sesiones (fecha, completado, carga) que el motor JS clasifica.
-- Reusa el periodo/vigencia igual que progreso_socio. security definer + aislamiento.
create or replace function public.analizar_progresion_socio(p_socio_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_emp uuid := public.auth_empresa_id();
  v_socio_id uuid;
  v_rutina_id uuid;
  v_inicio date;
  v_fin date;
  v_semanas numeric;
  v_ejercicios jsonb;
begin
  if v_emp is null then raise exception 'Sin empresa activa'; end if;

  select id into v_socio_id from public.socio
  where id = p_socio_id and empresa_id = v_emp and deleted_at is null;
  if v_socio_id is null then raise exception 'socio no encontrado o sin acceso'; end if;

  select id, vigencia_inicio, vigencia_fin into v_rutina_id, v_inicio, v_fin
  from public.rutina
  where socio_id = p_socio_id and empresa_id = v_emp and activa
  order by created_at desc limit 1;

  if v_inicio is null then v_inicio := current_date - 60; end if;
  if v_fin is null then v_fin := current_date; end if;
  v_semanas := greatest(1, ceil((v_fin - v_inicio + 1) / 7.0));

  -- por ejercicio de la rutina activa: grupo muscular (del catálogo del gym),
  -- series objetivo, veces_esperado (nº de semanas del periodo, ya que cada
  -- ejercicio de un día toca 1 vez por semana), y la serie de sesiones.
  select coalesce(jsonb_agg(jsonb_build_object(
      'ejercicio', t.nombre,
      'grupo_muscular', t.grupo_muscular,
      'dia', t.dia_nombre,
      'series_obj', t.series,
      'veces_esperado', round(v_semanas)::int,
      'sesiones', t.sesiones
    ) order by t.orden nulls last, t.nombre), '[]'::jsonb)
    into v_ejercicios
  from (
    select re.id, re.nombre, re.orden, re.series,
           ej.grupo_muscular,
           rd.nombre as dia_nombre,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                 'fecha', ree.fecha, 'completado', ree.completado, 'carga', ree.carga_usada
               ) order by ree.fecha)
             from public.registro_entreno_ejercicio ree
             where ree.rutina_ejercicio_id = re.id
               and ree.fecha between v_inicio and v_fin
           ), '[]'::jsonb) as sesiones
    from public.rutina_ejercicio re
    join public.rutina_dia rd on rd.id = re.rutina_dia_id
    left join public.ejercicio ej on ej.id = re.ejercicio_id
    where rd.rutina_id = v_rutina_id
  ) t;

  return jsonb_build_object(
    'periodo', jsonb_build_object('inicio', v_inicio, 'fin', v_fin),
    'ejercicios', v_ejercicios
  );
end $$;

-- Bloqueo por defecto: en este esquema authenticated tiene execute por default
-- privilege, así que hay que revocar a public Y authenticated y regrantear
-- explícitamente. La RPC valida empresa internamente (security definer).
revoke all on function public.analizar_progresion_socio(uuid) from public, authenticated;
grant execute on function public.analizar_progresion_socio(uuid) to authenticated;
```

- [ ] **Step 2: Verificar aislamiento y shape (transacción rollback)**

Ejecutar vía MCP `execute_sql` (project `zlmqdubrjzmagslcsqvb`). Tomar un socio real con rutina activa (buscar uno de MaximusGym) y su empresa; correr como `authenticated` con esa empresa:

```sql
begin;
-- elegir un socio con rutina activa
select s.id as socio_id, s.empresa_id
from public.socio s join public.rutina r on r.socio_id = s.id and r.activa
where s.deleted_at is null limit 1;
-- (usar esos valores abajo) simular sesión del gym dueño:
set local role authenticated;
set local request.jwt.claims to '{"sub":"<un admin uuid de esa empresa>","role":"authenticated"}';
select public.analizar_progresion_socio('<socio_id>');
rollback;
```
Expected: devuelve `{ periodo, ejercicios: [...] }`; cada ejercicio tiene `grupo_muscular`, `series_obj`, `veces_esperado`, `sesiones` (arreglo, probablemente vacío hoy porque `registro_entreno_ejercicio` está a 0 filas — eso es correcto, degradación limpia). Sin errores.

- [ ] **Step 3: Verificar que NO es llamable sin empresa / de otra empresa**

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<uuid de usuario de OTRA empresa>","role":"authenticated"}';
select public.analizar_progresion_socio('<socio_id de la primera empresa>');
rollback;
```
Expected: `ERROR: socio no encontrado o sin acceso` (aislamiento correcto).

- [ ] **Step 4: Verificar grant (revocado a public/authenticated y regranteado)**

```sql
select grantee, privilege_type from information_schema.role_routine_grants
where routine_name = 'analizar_progresion_socio';
```
Expected: `authenticated` con `EXECUTE`; NO aparece `public` con execute.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260718150000_analizar_progresion.sql
git commit -m "feat(progresion): RPC analizar_progresion_socio (serie por ejercicio para el motor)"
```

---

## Task 3: Hook `useAnalizarProgresion` + integración en el panel

Trae el análisis al panel y muestra la señal + sugerencia al lado de cada ejercicio dentro de `ProgresoRenovarModal`, con un aviso arriba si hay un día abandonado. El trainer edita con la edición ya existente (nada nuevo de escritura).

**Files:**
- Modify: `src/hooks/useProgresion.js` (agregar hook al final)
- Modify: `src/pages/Rutinas.jsx` (dentro de `ProgresoRenovarModal`)

**Interfaces:**
- Consumes: `analizar_progresion_socio` (Task 2), `analizarProgresion` (Task 1).
- Produces: `useAnalizarProgresion(socioId) → { data: { periodo, ejercicios, dias }, isLoading, ... }` — donde `ejercicios` y `dias` ya vienen clasificados por el motor.

- [ ] **Step 1: Agregar el hook a useProgresion.js**

Agregar al final de `src/hooks/useProgresion.js` (después de `useRenovarRutina`):

```javascript
import { analizarProgresion } from '../lib/analizarProgresion.js'

// Análisis inteligente por ejercicio (adaptado/evitado/estancado/día abandonado).
// Trae la serie por ejercicio de la RPC y la clasifica con el motor puro. Alimenta
// las señales al lado de cada ejercicio en ProgresoRenovarModal.
export function useAnalizarProgresion(socioId) {
  return useQuery({
    queryKey: ['analizar-progresion', socioId],
    enabled: !!socioId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('analizar_progresion_socio', { p_socio_id: socioId })
      if (error) throw error
      const raw = data || {}
      const { ejercicios, dias } = analizarProgresion(raw.ejercicios || [])
      return { periodo: raw.periodo || null, ejercicios, dias }
    },
  })
}
```

Nota: el `import` de `analizarProgresion` va en la parte superior del archivo junto a los imports existentes, no dentro de la función.

- [ ] **Step 2: Localizar el punto de inserción en Rutinas.jsx**

Run: `grep -n "ProgresoRenovarModal\|useProgresoSocio\|adherencia_ejercicio" src/pages/Rutinas.jsx`
Leer la sección del modal para ubicar dónde se listan los ejercicios / se muestran las sugerencias actuales.

- [ ] **Step 3: Enganchar el hook y renderizar las señales**

Dentro del componente `ProgresoRenovarModal` (que ya recibe `socioId` y usa `useProgresoSocio`), agregar el nuevo hook y un bloque que muestre, por ejercicio, su estado y sugerencia; y un aviso arriba si algún día está abandonado. Insertar junto a donde hoy se muestran las sugerencias generales:

```jsx
// dentro de ProgresoRenovarModal, junto a los otros hooks:
const analisis = useAnalizarProgresion(socioId)

// helper de color/emoji por estado (definir arriba del componente o inline):
const SENAL = {
  adaptado:  { icon: '🟢', label: 'Adaptado — subir', cls: 'text-emerald-600' },
  evitado:   { icon: '🔴', label: 'Evitado', cls: 'text-red-600' },
  estancado: { icon: '🟡', label: 'Estancado', cls: 'text-amber-600' },
  normal:    { icon: '⚪', label: '', cls: 'text-muted' },
}
```

Y en el JSX del modal, un bloque nuevo (colocarlo antes/junto a las sugerencias generales existentes):

```jsx
{analisis.data && (
  <div className="mt-4">
    {/* aviso de día abandonado */}
    {analisis.data.dias.filter((d) => d.abandonado).map((d) => (
      <div key={d.dia} className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">
        ⚠️ El socio casi no entrena <strong>{d.dia}</strong> — replantea ese día o motívalo.
      </div>
    ))}

    {/* señal por ejercicio */}
    {analisis.data.ejercicios.some((e) => e.estado !== 'normal') ? (
      <div className="space-y-2">
        <h4 className="text-[12.5px] font-bold text-muted">Análisis por ejercicio</h4>
        {analisis.data.ejercicios
          .filter((e) => e.estado !== 'normal')
          .map((e) => {
            const s = SENAL[e.estado] || SENAL.normal
            return (
              <div key={`${e.dia}-${e.ejercicio}`} className="rounded-lg border border-border px-3 py-2">
                <div className={`text-[13px] font-bold ${s.cls}`}>
                  {s.icon} {e.ejercicio} <span className="font-normal">· {s.label}</span>
                </div>
                {e.sugerencia && (
                  <div className="text-[12.5px] text-muted">{e.sugerencia.texto}</div>
                )}
              </div>
            )
          })}
      </div>
    ) : (
      // degradación: sin datos por ejercicio (registro_entreno_ejercicio vacío)
      analisis.data.ejercicios.length > 0 && (
        <div className="text-[12.5px] text-muted">
          Aún sin registros por ejercicio. Cuando el socio marque sus ejercicios y su peso
          en la app, aquí verás qué subir, qué cambiar y qué está evitando.
        </div>
      )
    )}
  </div>
)}
```

Ajustar clases a las que ya usa el modal (usar las mismas utilidades de estilo que el resto de `ProgresoRenovarModal` — `text-muted`, `border-border`, etc; el snippet usa las que aparecen en el archivo).

- [ ] **Step 4: Verificar build y tests**

Run: `npm run build`
Expected: build limpio, sin errores.

Run: `npm test`
Expected: PASS (sin regresiones).

- [ ] **Step 5: Verificar en el navegador (Playwright)**

Levantar el panel (`npm run dev` en background), loguear como admin de MaximusGym, ir a Rutinas, abrir "Ver progreso y renovar" de un socio con rutina activa. Confirmar:
- El bloque "Análisis por ejercicio" aparece (o el texto de degradación, si aún no hay registros por ejercicio — que es lo esperado hoy con 0 filas).
- 0 errores de consola.
Tomar screenshot como evidencia.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useProgresion.js src/pages/Rutinas.jsx
git commit -m "feat(progresion): señales por ejercicio en el panel de progreso del trainer"
```

---

## Task 4: Backend del mundo B — carga en la rutina libre + PEDIDO a la app

Deja lista la materia prima del mundo B (rutina libre sin gym): la tabla `registro_entreno_libre` hoy NO tiene columna de carga (confirmado en el esquema). Se agrega, sin romper la RPC que la escribe hoy, y se documenta el PEDIDO a la app (registrar la carga + consumir el motor preguntando al usuario).

**Files:**
- Create: `supabase/migrations/20260718151000_registro_libre_carga.sql`
- Modify: `docs/APP-BACKEND-REQUESTS.md` (nuevo PEDIDO arriba del todo)

**Interfaces:**
- Consumes: tabla `registro_entreno_libre`, RPC `marcar_entreno_libre` (existente).
- Produces: columna `registro_entreno_libre.carga_usada numeric null`; parámetro opcional `p_carga_usada` en `marcar_entreno_libre`.

- [ ] **Step 1: Revisar la firma actual de marcar_entreno_libre**

Ejecutar vía MCP `execute_sql` (project `zlmqdubrjzmagslcsqvb`):
```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'marcar_entreno_libre';
```
Leer para conservar su lógica (upsert por usuario+ejercicio+fecha) al agregar el parámetro.

- [ ] **Step 2: Escribir la migración**

Aplicar vía MCP `apply_migration` (name: `registro_libre_carga`). Agregar la columna y extender la RPC con un parámetro **opcional al final** (para no romper llamadas existentes de la app). Reemplazar el cuerpo del upsert conservando su lógica original — copiar del resultado del Step 1 y añadir `carga_usada`:

```sql
-- Mundo B (rutina libre): registrar también la carga usada, para que el motor
-- de progresión (analizarProgresion) funcione igual que en la rutina asignada.
alter table public.registro_entreno_libre
  add column if not exists carga_usada numeric;

-- Extiende marcar_entreno_libre con p_carga_usada OPCIONAL al final (default null),
-- para no romper las llamadas actuales de la app. El resto de la lógica (upsert
-- por usuario+ejercicio+fecha, validación de pertenencia) se conserva igual.
-- NOTA AL IMPLEMENTADOR: copiar el cuerpo real del Step 1 y sumar carga_usada al
-- INSERT y al ON CONFLICT ... DO UPDATE. El bloque de abajo es la forma esperada;
-- ajústalo a la firma/columnas reales que devolvió el Step 1.
create or replace function public.marcar_entreno_libre(
  p_rutina_libre_ejercicio_id uuid,
  p_fecha date,
  p_completado boolean,
  p_carga_usada numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_usuario uuid := auth.uid();
begin
  if v_usuario is null then raise exception 'No autenticado'; end if;

  -- validar que el ejercicio libre es de una rutina del propio usuario
  if not exists (
    select 1
    from public.rutina_libre_ejercicio rle
    join public.rutina_libre_dia rld on rld.id = rle.rutina_libre_dia_id
    join public.rutina_libre rl on rl.id = rld.rutina_libre_id
    where rle.id = p_rutina_libre_ejercicio_id and rl.usuario_id = v_usuario
  ) then
    raise exception 'ejercicio no pertenece al usuario';
  end if;

  insert into public.registro_entreno_libre
    (usuario_id, rutina_libre_ejercicio_id, fecha, completado, carga_usada)
  values (v_usuario, p_rutina_libre_ejercicio_id, p_fecha, p_completado, p_carga_usada)
  on conflict (usuario_id, rutina_libre_ejercicio_id, fecha)
  do update set completado = excluded.completado, carga_usada = excluded.carga_usada;

  return jsonb_build_object('ok', true, 'completado', p_completado);
end $$;

revoke all on function public.marcar_entreno_libre(uuid, date, boolean, numeric) from public, authenticated;
grant execute on function public.marcar_entreno_libre(uuid, date, boolean, numeric) to authenticated;
```

⚠️ El implementador DEBE reconciliar este cuerpo con el real del Step 1 (nombres de columnas del `on conflict`, retorno, validación). Si la firma vieja (3 args) queda huérfana y causa ambigüedad, hacer `drop function public.marcar_entreno_libre(uuid, date, boolean);` **solo si** no rompe a la app — como es un default nuevo al final, Postgres puede resolver la de 4 args para llamadas de 3; verificar en el Step 3.

- [ ] **Step 3: Verificar la RPC (rollback) con 3 y con 4 argumentos**

Ejecutar vía MCP `execute_sql`:
```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub":"<uuid usuario con rutina libre>","role":"authenticated"}';
-- llamada legacy (3 args, sin carga) debe seguir funcionando:
select public.marcar_entreno_libre('<rutina_libre_ejercicio_id>', current_date, true);
-- llamada nueva (4 args, con carga):
select public.marcar_entreno_libre('<rutina_libre_ejercicio_id>', current_date, true, 50);
select carga_usada from public.registro_entreno_libre
  where rutina_libre_ejercicio_id = '<rutina_libre_ejercicio_id>' and fecha = current_date;
rollback;
```
Expected: ambas llamadas OK; la segunda deja `carga_usada = 50`. Sin error de "function is not unique".

- [ ] **Step 4: Documentar el PEDIDO a la app**

Agregar al inicio de `docs/APP-BACKEND-REQUESTS.md` (después de la cabecera, antes del PEDIDO 46) un bloque nuevo:

```markdown
> ## 📩 PANEL → APP (2026-07-18): PEDIDO 47 — progresión inteligente en la rutina LIBRE (mundo B)
> Complemento del PEDIDO 46 (rutina asignada). Ahora para la rutina **libre** (la
> que el socio se arma solo, sin gym): queremos sugerirle a ÉL MISMO cuándo subir
> el peso, con el mismo motor que usa el trainer.
>
> **Backend LISTO:**
> - `registro_entreno_libre` ahora tiene columna **`carga_usada numeric`**.
> - `marcar_entreno_libre` acepta un 4º parámetro opcional **`p_carga_usada`**:
>   ```
>   supabase.rpc('marcar_entreno_libre', {
>     p_rutina_libre_ejercicio_id: <uuid>,
>     p_fecha: '2026-07-18',
>     p_completado: true,
>     p_carga_usada: 50   // opcional, nuevo
>   })
>   ```
>   Las llamadas actuales de 3 args siguen funcionando igual.
>
> **Lo que necesitamos de la app:**
> 1. Al marcar un ejercicio de la rutina libre, permitir anotar la **carga** y
>    pasarla en `p_carga_usada` (igual que el PEDIDO 46 para la asignada).
> 2. Con los registros acumulados, la app puede clasificar cada ejercicio con la
>    MISMA lógica del motor `analizarProgresion` (adaptado/evitado/estancado) y
>    **preguntarle al usuario**: "Ya dominás Press banca (completado 2 sesiones
>    seguidas) — ¿subimos ~1.25 kg?" / "Casi nunca haces Sentadilla, ¿la cambiamos?".
>    Al aceptar, la app edita su rutina libre. El motor (reglas y umbrales) está
>    en `src/lib/analizarProgresion.js` del panel — se puede portar a Kotlin o
>    exponer como RPC si prefieren; avisen y lo montamos como RPC compartida.
> 3. Texto incentivo (también aplica al PEDIDO 46): recordar al usuario que marcar
>    sus ejercicios y su peso sirve para que la app/el trainer le ajuste la rutina.
>
> Sin esto la app funciona igual; es aditivo.
```

- [ ] **Step 5: Verificar tests + build (sin cambios de front, sanity)**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260718151000_registro_libre_carga.sql docs/APP-BACKEND-REQUESTS.md
git commit -m "feat(progresion): carga en rutina libre (mundo B) + PEDIDO 47 a la app"
```

---

## Notas de verificación final (para el whole-branch review)

- El motor `analizarProgresion` es puro y cubre: adaptado, evitado, estancado, día abandonado, degradación sin carga, entrada vacía, div-por-cero.
- La RPC valida empresa (aislamiento probado con otra empresa → error) y está bien grant-eada (revoke a public+authenticated, grant a authenticated).
- El panel degrada limpio hoy (0 filas en `registro_entreno_ejercicio`): muestra el texto "aún sin registros por ejercicio", no rompe.
- Mundo B: columna + RPC extendida sin romper la firma vieja; PEDIDO 47 documentado.
- Dependencia dura reconocida: las señales "reales" aparecen cuando la app cumpla PEDIDO 46 (asignada) / 47 (libre). El backend y el panel ya están listos para ese día.
```
