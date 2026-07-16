import { describe, it, expect } from 'vitest'
import { kgADisplay, displayAKg, mADisplay, displayAM, labelPeso, labelTalla } from '../src/lib/unidades.js'

describe('peso: kg <-> lb', () => {
  it('kgADisplay con unidad kg devuelve el valor tal cual', () => {
    expect(kgADisplay(70, 'kg')).toBe(70)
  })

  it('kgADisplay con unidad lb convierte 70kg a ~154.3 lb', () => {
    expect(kgADisplay(70, 'lb')).toBeCloseTo(154.3, 1)
  })

  it('ida y vuelta kg -> lb -> kg conserva el valor (±0.1)', () => {
    const kgOriginal = 70
    const lb = kgADisplay(kgOriginal, 'lb')
    const kgVuelta = displayAKg(lb, 'lb')
    expect(kgVuelta).toBeCloseTo(kgOriginal, 1)
  })

  it('displayAKg con unidad kg devuelve el valor tal cual', () => {
    expect(displayAKg(82.5, 'kg')).toBe(82.5)
  })

  it('null/vacío -> null', () => {
    expect(kgADisplay(null, 'lb')).toBeNull()
    expect(kgADisplay('', 'lb')).toBeNull()
    expect(kgADisplay(undefined, 'kg')).toBeNull()
    expect(displayAKg(null, 'lb')).toBeNull()
    expect(displayAKg('', 'kg')).toBeNull()
  })
})

describe('talla: m <-> ft', () => {
  it('mADisplay con unidad m devuelve el valor tal cual', () => {
    expect(mADisplay(1.75, 'm')).toBe(1.75)
  })

  it('mADisplay con unidad ft convierte 1.75m a ~5.7 ft', () => {
    expect(mADisplay(1.75, 'ft')).toBeCloseTo(5.7, 1)
  })

  it('ida y vuelta m -> ft -> m conserva el valor (±0.01)', () => {
    const mOriginal = 1.75
    const ft = mADisplay(mOriginal, 'ft')
    const mVuelta = displayAM(ft, 'ft')
    expect(mVuelta).toBeCloseTo(mOriginal, 1)
  })

  it('displayAM con unidad m devuelve el valor tal cual', () => {
    expect(displayAM(1.6, 'm')).toBe(1.6)
  })

  it('null/vacío -> null', () => {
    expect(mADisplay(null, 'ft')).toBeNull()
    expect(mADisplay('', 'm')).toBeNull()
    expect(displayAM(undefined, 'ft')).toBeNull()
    expect(displayAM('', 'm')).toBeNull()
  })
})

describe('labels', () => {
  it('labelPeso', () => {
    expect(labelPeso('kg')).toBe('kg')
    expect(labelPeso('lb')).toBe('lb')
    expect(labelPeso(undefined)).toBe('kg') // default sensato
  })

  it('labelTalla', () => {
    expect(labelTalla('m')).toBe('m')
    expect(labelTalla('ft')).toBe('ft')
    expect(labelTalla(undefined)).toBe('m') // default sensato
  })
})
