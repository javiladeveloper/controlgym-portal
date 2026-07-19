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

  it('sin datos de carga: completa siempre → adaptado igual (usa completado)', () => {
    const r = analizarProgresion([{
      ejercicio: 'Press', grupo_muscular: 'pecho', dia: 'Día 1', series_obj: 4,
      veces_esperado: 2, sesiones: ses([['2026-07-01', true, null], ['2026-07-03', true, null]]),
    }])
    const e = r.ejercicios[0]
    expect(e.estado).toBe('adaptado')
    expect(e.sugerencia.incremento_kg).toBe(1.25) // sugiere el salto por grupo aunque no sepa la carga base
  })

  it('normal: constante pero sin racha (última sesión falla) → normal, sin sugerencia', () => {
    const r = analizarProgresion([{
      ejercicio: 'Remo', grupo_muscular: 'espalda', dia: 'Día 1', series_obj: 4,
      veces_esperado: 4,
      // tasa 0.75 (constante), pero la racha final es 1 fallo → ni adaptado ni estancado
      sesiones: ses([['2026-07-01', true, 50], ['2026-07-03', true, 50], ['2026-07-05', false, 50]]),
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
