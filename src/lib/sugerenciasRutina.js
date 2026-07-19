/**
 * sugerenciasDeProgreso - Genera sugerencias de ajuste de rutina basadas en progreso
 * @param {Object} progreso - jsonb de progreso_socio con adherencia, peso, asistencia
 * @param {string} objetivoCodigo - código del objetivo (ganar_masa, bajar_peso, etc)
 * @returns {Array<{tipo, texto}>} Sugerencias de ajuste para la siguiente rutina
 */
export function sugerenciasDeProgreso(progreso, objetivoCodigo) {
  const sugerencias = []

  // Sin datos suficientes → no inventar sugerencias
  if (!progreso || Object.keys(progreso).length === 0) {
    return []
  }

  // Regla 1: Alta adherencia + carga subiendo → sube intensidad/carga/series
  if (progreso.adherencia_dia) {
    const { completados, esperados } = progreso.adherencia_dia
    if (completados !== undefined && esperados !== undefined) {
      const adherencia = completados / esperados
      // Alta adherencia: >85%
      if (adherencia > 0.85) {
        sugerencias.push({
          tipo: 'intensidad',
          texto: 'Alta adherencia: considera subir intensidad, carga o series'
        })
      }
    }
  }

  // Regla 2: Objetivo bajar_peso pero peso estancado → más cardio/volumen
  if (objetivoCodigo === 'bajar_peso' && progreso.peso) {
    const { delta } = progreso.peso
    if (delta !== undefined) {
      // Peso estancado: delta ~0 (rango -0.5 a 0.5 kg)
      if (Math.abs(delta) <= 0.5) {
        sugerencias.push({
          tipo: 'volumen',
          texto: 'Peso estancado: aumenta volumen de cardio o ejercicios'
        })
      }
    }
  }

  // Regla 3: Baja asistencia → rutina más corta / menos días
  if (progreso.asistencia) {
    const { dias, semanas } = progreso.asistencia
    if (dias !== undefined && semanas !== undefined) {
      // Baja asistencia: máximo 0.5 días por semana en promedio
      const diasPorSemana = dias / semanas
      if (diasPorSemana <= 0.5) {
        sugerencias.push({
          tipo: 'adherencia',
          texto: 'Baja asistencia: propón rutina más corta con menos días'
        })
      }
    }
  }

  return sugerencias
}
