import { describe, it, expect } from 'vitest'
import { fechaLocal, fechaCorta, mismoDia } from '../src/lib/uiHelpers.js'

describe('fechaLocal', () => {
  it("'2026-07-10' se interpreta como día LOCAL 10 (no 9 por desfase UTC)", () => {
    const d = fechaLocal('2026-07-10')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(6) // julio = índice 6
    expect(d.getDate()).toBe(10)
  })

  it('acepta timestamps completos (ISO con hora) y los deja tal cual', () => {
    const d = fechaLocal('2026-07-10T15:30:00.000Z')
    expect(d).toBeInstanceOf(Date)
    expect(Number.isNaN(d.getTime())).toBe(false)
  })

  it('devuelve la misma instancia si ya recibe un Date', () => {
    const original = new Date(2026, 5, 1)
    expect(fechaLocal(original)).toBe(original)
  })

  it('null → null', () => {
    expect(fechaLocal(null)).toBeNull()
  })

  it('undefined / string vacío → null', () => {
    expect(fechaLocal(undefined)).toBeNull()
    expect(fechaLocal('')).toBeNull()
  })
})

describe('fechaCorta', () => {
  it('formatea una fecha YYYY-MM-DD como "DD mmm" en es-PE', () => {
    const s = fechaCorta('2026-01-02')
    expect(s).toContain('02')
    expect(s.toLowerCase()).toContain('ene')
  })

  it('sin fecha → "—"', () => {
    expect(fechaCorta(null)).toBe('—')
    expect(fechaCorta(undefined)).toBe('—')
  })
})

describe('mismoDia', () => {
  it('true para dos fechas YYYY-MM-DD idénticas', () => {
    expect(mismoDia('2026-07-10', '2026-07-10')).toBe(true)
  })

  it('true para una fecha corta y un timestamp del mismo día local', () => {
    expect(mismoDia('2026-07-10', new Date(2026, 6, 10, 23, 0))).toBe(true)
  })

  it('false para días distintos', () => {
    expect(mismoDia('2026-07-10', '2026-07-11')).toBe(false)
  })

  it('false si falta alguna de las dos fechas', () => {
    expect(mismoDia(null, '2026-07-10')).toBe(false)
    expect(mismoDia('2026-07-10', null)).toBe(false)
  })
})
