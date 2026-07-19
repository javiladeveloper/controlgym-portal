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

  it('viene pero casi nunca completa (registra 4, completa 1, sin racha de fallos limpia) → evitado por incompletitud', () => {
    const r = analizarProgresion([{
      ejercicio: 'Dominadas', grupo_muscular: 'espalda', dia: 'Día 1', series_obj: 4,
      veces_esperado: 8,
      // registra 5 (viene, tasaIntentos 0.625), pero completa solo 1 → tasa 0.125 < 0.30.
      // termina en completada, así que NO hay racha de 3 fallos → no es estancado.
      sesiones: ses([['2026-07-01', false, 0], ['2026-07-03', false, 0], ['2026-07-05', false, 0], ['2026-07-08', false, 0], ['2026-07-10', true, 0]]),
    }])
    const e = r.ejercicios[0]
    // no es evitado-por-ausencia (viene), no es estancado (no hay 3 fallos seguidos), es incompletitud
    expect(e.estado).toBe('evitado')
    expect(/termina|complet/i.test(e.sugerencia.texto)).toBe(true)
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

  it('SIN datos (0 filas hoy): ejercicios con veces_esperado>0 y sesiones vacías → todo normal, ningún evitado, ningún día abandonado', () => {
    // Estado real de producción: registro_entreno_ejercicio a 0 filas. La app
    // aún no persiste. Debe degradar (normal + sin_datos), NO pintar evitado.
    const r = analizarProgresion([
      { ejercicio: 'Press banca', grupo_muscular: 'pecho', dia: 'Día 1', series_obj: 4, veces_esperado: 9, sesiones: [] },
      { ejercicio: 'Press militar', grupo_muscular: 'hombro', dia: 'Día 1', series_obj: 3, veces_esperado: 9, sesiones: [] },
      { ejercicio: 'Sentadilla', grupo_muscular: 'pierna', dia: 'Día 2', series_obj: 4, veces_esperado: 9, sesiones: [] },
    ])
    expect(r.ejercicios.every((e) => e.estado === 'normal')).toBe(true)
    expect(r.ejercicios.every((e) => e.sin_datos === true)).toBe(true)
    expect(r.ejercicios.some((e) => e.estado === 'evitado')).toBe(false)
    expect(r.dias.some((d) => d.abandonado)).toBe(false)
  })

  it('datos mixtos: un ejercicio del día con datos manda; el sin-datos no arrastra el día a abandonado', () => {
    const r = analizarProgresion([
      // este SÍ tiene datos y viene bien (tasa alta)
      { ejercicio: 'Press', grupo_muscular: 'pecho', dia: 'Día 1', series_obj: 4, veces_esperado: 4, sesiones: ses([['2026-07-01', true, 60], ['2026-07-03', true, 60], ['2026-07-05', true, 60]]) },
      // este no tiene datos → no debe contar como abandono del día
      { ejercicio: 'Aperturas', grupo_muscular: 'pecho', dia: 'Día 1', series_obj: 3, veces_esperado: 4, sesiones: [] },
    ])
    const dia = r.dias.find((d) => d.dia === 'Día 1')
    expect(dia.abandonado).toBe(false)
    // el que tiene datos y completó 3 seguidas → adaptado
    expect(r.ejercicios.find((e) => e.ejercicio === 'Press').estado).toBe('adaptado')
    // el sin datos → normal/sin_datos
    expect(r.ejercicios.find((e) => e.ejercicio === 'Aperturas').sin_datos).toBe(true)
  })

  it('dos días con el mismo foco pero distinto dia_id NO se fusionan', () => {
    const r = analizarProgresion([
      { ejercicio: 'Press', grupo_muscular: 'pecho', dia: 'Full body', dia_id: 'd1', series_obj: 4, veces_esperado: 4, sesiones: ses([['2026-07-01', true, 60], ['2026-07-03', true, 60], ['2026-07-05', true, 60]]) },
      { ejercicio: 'Sentadilla', grupo_muscular: 'pierna', dia: 'Full body', dia_id: 'd2', series_obj: 4, veces_esperado: 8, sesiones: [] },
    ])
    // dos grupos de día distintos aunque compartan el label 'Full body'
    expect(r.dias.length).toBe(2)
    expect(r.dias.map((d) => d.dia_id).sort()).toEqual(['d1', 'd2'])
    // d1 tiene datos (no sin_datos); d2 sin datos
    expect(r.dias.find((d) => d.dia_id === 'd1').sin_datos).toBeUndefined()
    expect(r.dias.find((d) => d.dia_id === 'd2').sin_datos).toBe(true)
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
