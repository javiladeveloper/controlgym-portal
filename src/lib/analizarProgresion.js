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

  // SIN DATOS — ningún registro en el periodo. NO es "evita": es que la app aún
  // no persiste (registro_entreno_ejercicio a 0 filas). Devolver 'normal' + flag
  // sin_datos para que el panel degrade a su mensaje de "aún sin registros" en
  // vez de pintar 🔴 en todos los ejercicios. Sin este corte, todo saldría evitado.
  if (intentos === 0) {
    return { ...ej, veces_completado, tasa, estado: 'normal', sugerencia: null, sin_datos: true }
  }

  // 1) EVITADO por AUSENCIA — casi ni lo intenta (pocos registros vs lo que
  //    tocaba). Se mide por INTENTOS, no por completados: distingue al que no
  //    aparece del que aparece y falla (ese es estancado, no evita).
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
  const fallosSeguidos = rachaFinal(sesiones, (s) => s.completado === false)
  const completadasSeguidas = rachaFinal(sesiones, (s) => s.completado === true)

  // 2) ESTANCADO — viene y registra, pero falla el objetivo con la misma carga
  //    3 sesiones seguidas (plateau). Se evalúa ANTES del evitado-por-completado
  //    para no confundir una meseta real (racha de fallos) con "nunca completa".
  if (constante && fallosSeguidos >= FALLOS_ESTANCADO) {
    return {
      ...ej, veces_completado, tasa, estado: 'estancado',
      sugerencia: {
        tipo: 'estancado',
        texto: `${ej.ejercicio} estancado (${fallosSeguidos} sesiones sin completar la misma carga). Baja ~10% y vuelve a subir (deload); si reincide, cambia el ejercicio o el esquema.`,
      },
    }
  }

  // 3) EVITADO por INCOMPLETUD — viene (registra) pero casi nunca lo COMPLETA
  //    (tasa de completado < 0.30) y sin ser una meseta limpia. Captura al que
  //    abandona el ejercicio a media serie una y otra vez.
  if (veces_esperado > 0 && tasa < TASA_EVITADO) {
    return {
      ...ej, veces_completado, tasa, estado: 'evitado',
      sugerencia: {
        tipo: 'evitado',
        texto: `Registra ${ej.ejercicio} pero casi nunca lo termina (${veces_completado}/${intentos} completadas). Replantéalo o bájale la exigencia; conversa la motivación.`,
      },
    }
  }

  // 4) ADAPTADO — completa el objetivo N sesiones consecutivas → subir carga.
  //    Con datos de carga: la racha de completados; sin datos, igual (solo completado).
  const N = esNovato(sesiones) ? RACHA_NOVATO : RACHA_INTERMEDIO
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
  // Se agrupa por dia_id (estable) para no fusionar dos días con el mismo foco;
  // se conserva el label (dia) para mostrar. Si no hay dia_id, cae al label.
  const porDia = new Map()
  for (const e of analizados) {
    const key = e.dia_id || e.dia || '—'
    if (!porDia.has(key)) porDia.set(key, { dia_id: e.dia_id ?? null, dia: e.dia ?? null, ejs: [] })
    porDia.get(key).ejs.push(e)
  }
  const dias = []
  for (const { dia_id, dia, ejs } of porDia.values()) {
    // Solo se evalúa un día si al menos un ejercicio tiene datos. Un día entero
    // sin registros = sin datos (la app aún no persiste), NO abandonado.
    const conDatos = ejs.filter((e) => !e.sin_datos)
    if (conDatos.length === 0) {
      dias.push({ dia_id, dia, tasa: 0, abandonado: false, sin_datos: true })
      continue
    }
    const tasa = conDatos.reduce((a, e) => a + e.tasa, 0) / conDatos.length
    dias.push({ dia_id, dia, tasa, abandonado: tasa < TASA_DIA_ABANDONADO })
  }

  return { ejercicios: analizados, dias }
}
