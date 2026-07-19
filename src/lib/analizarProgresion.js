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
  // si la carga subió en las últimas 3 completadas → aún progresando rápido
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

  // "intentos": cuántas veces al menos registró el ejercicio (venga o no lo complete).
  // Distingue al que EVITA (no aparece) del que ESTANCA (aparece pero falla): un
  // socio que registra 3 intentos fallidos SÍ viene, no lo evita.
  const intentos = sesiones.length
  const tasaIntentos = veces_esperado > 0 ? intentos / veces_esperado : 0

  // 1) EVITADO — casi ni lo intenta (pocos registros vs lo que tocaba). Se mide
  //    por INTENTOS, no por completados: el que viene y falla no está evitando.
  if (veces_esperado > 0 && tasaIntentos < TASA_EVITADO) {
    return {
      ...ej, veces_completado, tasa, estado: 'evitado',
      sugerencia: {
        tipo: 'evitado',
        texto: `Casi no hace ${ej.ejercicio} (${intentos}/${veces_esperado} sesiones). Replantéalo o cámbialo por uno que sí haga; conversa la motivación.`,
      },
    }
  }

  // Para adaptado/estancado necesitamos que venga con constancia (aparece seguido).
  const constante = tasaIntentos >= 0.5

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
  //    Con datos de carga: la racha de completados; sin datos, igual (solo completado).
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
