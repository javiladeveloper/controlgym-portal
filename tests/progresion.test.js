import { describe, it, expect } from 'vitest'
import { sugerenciasDeProgreso } from '../src/lib/sugerenciasRutina.js'

describe('sugerencias de progreso', () => {
  it('alta adherencia + carga subiendo → sube intensidad', () => {
    const p = { adherencia_dia: { completados: 22, esperados: 24 },
      adherencia_ejercicio: [{ ejercicio:'Press', veces:8, carga_prom:70 }] }
    const s = sugerenciasDeProgreso(p, 'ganar_masa')
    expect(s.some(x => /intensidad|carga|series/i.test(x.texto))).toBe(true)
  })
  it('objetivo bajar peso pero peso estancado → más volumen/cardio', () => {
    const p = { peso: { delta: 0 }, adherencia_dia:{completados:20,esperados:24} }
    const s = sugerenciasDeProgreso(p, 'bajar_peso')
    expect(s.some(x => /cardio|volumen/i.test(x.texto))).toBe(true)
  })
  it('baja asistencia → rutina más corta', () => {
    const p = { asistencia: { dias: 4, semanas: 8 }, adherencia_dia:{completados:4,esperados:24} }
    const s = sugerenciasDeProgreso(p, 'ganar_masa')
    expect(s.some(x => /corta|menos días|reenganch/i.test(x.texto))).toBe(true)
  })
  it('sin datos suficientes → no inventa sugerencias', () => {
    expect(sugerenciasDeProgreso({}, 'ganar_masa')).toEqual([])
  })
})
