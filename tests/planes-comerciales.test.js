import { describe, it, expect } from 'vitest'
import {
  PLANES_GYM, PLAN_MIEMBROS, PLANES_SEGMENTO,
  precioPlan, appIncluida, costoMiembros, planQueConviene,
  planesPorCategoria, planPorSlug,
} from '../src/config/planesComerciales.js'

// Estos precios son espejo de precio_plan() en la BD. Si cambian aquí, hay que
// cambiarlos allá (y al revés): el desfase se cobra en soles reales.
describe('precios de los planes', () => {
  it('los planes de gym tienen precio único: ignoran conApp', () => {
    for (const p of PLANES_GYM) {
      expect(precioPlan(p, false)).toBe(p.precio)
      expect(precioPlan(p, true)).toBe(p.precio)
    }
  })

  it('los precios de gym son los acordados (99/169/279)', () => {
    expect(planPorSlug('estudio').precio).toBe(99)
    expect(planPorSlug('crecimiento').precio).toBe(169)
    expect(planPorSlug('pro').precio).toBe(279)
  })

  it('los planes de segmento SÍ respetan conApp', () => {
    const trainer = PLANES_SEGMENTO.personal_trainer
    expect(precioPlan(trainer, false)).toBe(29)
    expect(precioPlan(trainer, true)).toBe(49)
  })

  it('appIncluida distingue gym (incluida) de segmento (extra)', () => {
    expect(appIncluida('estudio')).toBe(true)
    expect(appIncluida('crecimiento')).toBe(true)
    expect(appIncluida('pro')).toBe(true)
    expect(appIncluida('trainer')).toBe(false)
    expect(appIncluida('academia')).toBe(false)
    // miembros NO incluye la app: el gym no aparece para sus socios
    expect(appIncluida('miembros')).toBe(false)
  })

  it('precioPlan tolera un plan nulo sin explotar', () => {
    expect(precioPlan(null)).toBe(0)
    expect(precioPlan(undefined)).toBe(0)
  })
})

describe('plan Miembros: S/1 por socio activo', () => {
  it('cobra S/1 por socio', () => {
    expect(costoMiembros(0)).toBe(0)
    expect(costoMiembros(1)).toBe(1)
    expect(costoMiembros(80)).toBe(80)
  })

  it('sin socios no se paga nada — es la promesa del plan', () => {
    expect(costoMiembros(0)).toBe(0)
    expect(costoMiembros(null)).toBe(0)
    expect(costoMiembros(undefined)).toBe(0)
  })

  it('nunca cobra negativo aunque le pasen basura', () => {
    expect(costoMiembros(-5)).toBe(0)
  })

  it('no cobra fracciones de socio', () => {
    expect(costoMiembros(10.7)).toBe(10)
  })
})

describe('sugerencia de migrar a plan fijo', () => {
  it('no sugiere nada mientras Miembros sea lo más barato', () => {
    expect(planQueConviene(50)).toBeNull()   // S/50 < S/99 (Estudio)
    expect(planQueConviene(99)).toBeNull()   // empate: no ahorra nada
  })

  it('sugiere Estudio recién cuando de verdad ahorra', () => {
    const r = planQueConviene(100)           // S/100 > S/99
    expect(r.plan.slug).toBe('estudio')
    expect(r.ahorro).toBe(1)
  })

  it('sugiere el plan más barato que le convenga, no el más caro', () => {
    // Con 200 socios (S/200) le convienen Estudio (99) y Crecimiento (169):
    // debe ofrecer el más barato.
    const r = planQueConviene(200)
    expect(r.plan.slug).toBe('estudio')
    expect(r.ahorro).toBe(101)
  })

  it('el embudo funciona: un gym grande paga más por socio que por plan fijo', () => {
    // 300 socios = S/300 > S/279 del Pro completo. Es intencional: el gym
    // grande migra solo.
    expect(costoMiembros(300)).toBeGreaterThan(planPorSlug('pro').precio)
  })
})

describe('catálogo por categoría', () => {
  it('un gimnasio puede elegir Miembros o cualquier plan de gym', () => {
    const planes = planesPorCategoria('fitness')
    expect(planes.map((p) => p.slug)).toEqual(['miembros', 'estudio', 'crecimiento', 'pro'])
  })

  it('Miembros va primero: es la puerta de entrada sin riesgo', () => {
    expect(planesPorCategoria('fitness')[0].slug).toBe('miembros')
  })

  it('los segmentos tienen plan único y NO ven Miembros', () => {
    expect(planesPorCategoria('clases').map((p) => p.slug)).toEqual(['academia'])
    expect(planesPorCategoria('ninos').map((p) => p.slug)).toEqual(['ninos'])
    expect(planesPorCategoria('personal_trainer').map((p) => p.slug)).toEqual(['trainer'])
  })

  it('planPorSlug encuentra todos los planes, Miembros incluido', () => {
    for (const slug of ['miembros', 'estudio', 'crecimiento', 'pro', 'trainer', 'academia', 'ninos']) {
      expect(planPorSlug(slug), `falta ${slug}`).toBeTruthy()
    }
    expect(planPorSlug('inexistente')).toBeNull()
  })

  it('el copy de Miembros no promete la app del socio', () => {
    // "Usa el sistema GRATIS" — no "la aplicación": la app del socio no va en
    // este plan y el gym no debe entender lo contrario.
    expect(PLAN_MIEMBROS.eslogan).not.toMatch(/aplicaci[oó]n|app/i)
    expect(PLAN_MIEMBROS.letraChica).toMatch(/app/i)
  })
})
