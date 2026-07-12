import { describe, it, expect } from 'vitest'
import { construirLineas } from '../api/facturacion/_norac.js'

// Reproduce el redondeo final tal como lo hace SUNAT/NORAC (mostrar 2dp) para
// verificar que el payload de construirLineas cuadra exacto con el total.
function sumaCentavosNorac(lineasNorac) {
  return lineasNorac.reduce((acc, l) => {
    const vu = Number(l.valor_unitario)
    const cant = Number(l.cantidad)
    return acc + Math.round(vu * cant * 1.18 * 100)
  }, 0)
}

function centavos(n) {
  return Math.round(n * 100)
}

// PRNG determinístico (mulberry32) para el fuzz — reproducible con semilla fija.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min
}

// Monto aleatorio con 2 decimales dentro de [min, max].
function randMonto(rng, min, max) {
  const cents = randInt(rng, Math.round(min * 100), Math.round(max * 100))
  return cents / 100
}

describe('construirLineas — cuadre exacto de céntimos (SUNAT/NORAC)', () => {
  it('total=100.00, 1 línea cantidad 1 → cuadra exacto (caso que rompía con 2 decimales)', () => {
    const lineas = [{ descripcion: 'Membresía', cantidad: 1, subtotal: 100.0 }]
    const out = construirLineas(lineas, 100.0)
    expect(sumaCentavosNorac(out)).toBe(centavos(100.0))
  })

  it('carrito 25+3 (total 28.00) → cuadre exacto', () => {
    const lineas = [
      { descripcion: 'Producto A', cantidad: 1, subtotal: 25.0 },
      { descripcion: 'Producto B', cantidad: 1, subtotal: 3.0 },
    ]
    const out = construirLineas(lineas, 28.0)
    expect(sumaCentavosNorac(out)).toBe(centavos(28.0))
  })

  it('3 líneas 33.34 + 33.33 + 33.33 → cuadre exacto', () => {
    const lineas = [
      { descripcion: 'A', cantidad: 1, subtotal: 33.34 },
      { descripcion: 'B', cantidad: 1, subtotal: 33.33 },
      { descripcion: 'C', cantidad: 1, subtotal: 33.33 },
    ]
    const total = 33.34 + 33.33 + 33.33
    const out = construirLineas(lineas, total)
    expect(sumaCentavosNorac(out)).toBe(centavos(total))
  })

  it('cantidades > 1 (3 × 33.33) → cuadre exacto', () => {
    const lineas = [{ descripcion: 'Producto', cantidad: 3, subtotal: 33.33 }]
    const out = construirLineas(lineas, 33.33)
    expect(sumaCentavosNorac(out)).toBe(centavos(33.33))
    expect(out[0].cantidad).toBe('3')
  })

  it('montos "feos" (19.90, 0.10, 129.99) → cuadre exacto', () => {
    const lineas = [
      { descripcion: 'A', cantidad: 1, subtotal: 19.9 },
      { descripcion: 'B', cantidad: 1, subtotal: 0.1 },
      { descripcion: 'C', cantidad: 1, subtotal: 129.99 },
    ]
    const total = 19.9 + 0.1 + 129.99
    const out = construirLineas(lineas, total)
    expect(sumaCentavosNorac(out)).toBe(centavos(total))
  })

  it('guard: líneas 80+5 con total=50 → lanza (valor_unitario <= 0)', () => {
    const lineas = [
      { descripcion: 'A', cantidad: 1, subtotal: 80 },
      { descripcion: 'B', cantidad: 1, subtotal: 5 },
    ]
    expect(() => construirLineas(lineas, 50)).toThrow(/valor_unitario/)
  })

  it('shape: cada línea tiene los campos esperados y valor_unitario sin notación exponencial', () => {
    const lineas = [{ descripcion: 'Producto pequeño', cantidad: 1, subtotal: 0.1 }]
    const out = construirLineas(lineas, 0.1)
    for (const l of out) {
      expect(l).toHaveProperty('descripcion')
      expect(typeof l.cantidad).toBe('string')
      expect(typeof l.valor_unitario).toBe('string')
      expect(l.valor_unitario).not.toMatch(/e/i) // sin notación exponencial
      expect(l.afectacion_igv).toBe('10')
      expect(l.unidad).toBe('NIU')
    }
  })

  describe('fuzz — 500 casos aleatorios (semilla fija, mulberry32)', () => {
    const SEED = 20260711
    const rng = mulberry32(SEED)
    const N = 500
    const fallos = []

    for (let i = 0; i < N; i++) {
      const numLineas = randInt(rng, 1, 5)
      const lineas = []
      let total = 0
      for (let j = 0; j < numLineas; j++) {
        const cantidad = randInt(rng, 1, 10)
        const subtotal = randMonto(rng, 0.1, 2000)
        lineas.push({ descripcion: `Línea ${j}`, cantidad, subtotal })
        total += subtotal
      }
      total = Math.round(total * 100) / 100 // total = Σ subtotales, a 2dp

      let out
      let error = null
      try {
        out = construirLineas(lineas, total)
      } catch (e) {
        error = e
      }

      if (error) {
        // Guard legítimo (total < suma de líneas por ajuste) no debería darse
        // aquí porque total = Σ subtotales exactamente, pero lo registramos
        // por si acaso para inspección.
        fallos.push({ caso: i, tipo: 'excepcion', error: error.message, lineas, total })
        continue
      }

      const sumaObtenida = sumaCentavosNorac(out)
      const sumaEsperada = centavos(total)
      if (sumaObtenida !== sumaEsperada) {
        fallos.push({ caso: i, tipo: 'descuadre', lineas, total, sumaObtenida, sumaEsperada })
      }
    }

    it(`todos los ${N} casos cuadran exacto (semilla ${SEED})`, () => {
      if (fallos.length > 0) {
        console.error('FUZZ construirLineas — casos que NO cuadraron:', JSON.stringify(fallos.slice(0, 5), null, 2))
      }
      expect(fallos.length).toBe(0)
    })
  })
})
