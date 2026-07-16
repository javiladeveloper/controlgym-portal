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

describe('talla: cm (métrico) <-> ft', () => {
  it('mADisplay con unidad m muestra CENTÍMETROS (1.75m -> 175)', () => {
    expect(mADisplay(1.75, 'm')).toBe(175)
    expect(mADisplay(1.70, 'm')).toBe(170)
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

  it('displayAM con unidad m convierte cm a metros (170 -> 1.70)', () => {
    expect(displayAM(170, 'm')).toBeCloseTo(1.70, 2)
    expect(displayAM(160, 'm')).toBeCloseTo(1.60, 2)
  })

  it('ida y vuelta cm: 168 -> metros -> 168', () => {
    expect(mADisplay(displayAM(168, 'm'), 'm')).toBe(168)
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
    expect(labelTalla('m')).toBe('cm') // métrico se muestra en centímetros
    expect(labelTalla('ft')).toBe('ft')
    expect(labelTalla(undefined)).toBe('cm') // default sensato (métrico = cm)
  })
})
