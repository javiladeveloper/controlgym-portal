import { describe, it, expect } from 'vitest'
import { metodoPagoLabel, METODOS_PAGO } from '../src/lib/pagos.js'

describe('metodoPagoLabel', () => {
  it("'yape' → 'Yape'", () => {
    expect(metodoPagoLabel('yape')).toBe('Yape')
  })

  it('cubre todas las etiquetas conocidas de METODOS_PAGO', () => {
    for (const [valor, label] of METODOS_PAGO) {
      expect(metodoPagoLabel(valor)).toBe(label)
    }
  })

  it('valor desconocido se devuelve tal cual', () => {
    expect(metodoPagoLabel('bitcoin')).toBe('bitcoin')
  })

  it('valor vacío/undefined se devuelve tal cual (falsy)', () => {
    expect(metodoPagoLabel(undefined)).toBeUndefined()
    expect(metodoPagoLabel('')).toBe('')
  })
})
