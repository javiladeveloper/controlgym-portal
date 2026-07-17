import { describe, it, expect } from 'vitest'
import { visibleModules, canAccessModule, MODULES } from '../src/config/modules.js'

// Simula lo que modulos_de_sede devuelve por plan. En la BD, modulo_min_rank
// decide qué slugs llegan según el rank; aquí probamos que el front respeta esa
// lista — que un módulo que NO está en enabledModules queda inaccesible.
const MODS_ESTUDIO = ['dashboard', 'clientes', 'membresias', 'ventas', 'clases', 'configuracion']
const MODS_CRECIMIENTO = [...MODS_ESTUDIO, 'crm', 'rutinas', 'kardex', 'personal',
  'promociones', 'finanzas', 'reportes', 'maquinas', 'sponsors', 'croquis']
const MODS_PRO = [...MODS_CRECIMIENTO, 'acceso_fisico', 'facturacion']

describe('gating de módulos por plan (front respeta la lista de la sede)', () => {
  it('Estudio no accede a croquis, acceso físico ni facturación', () => {
    expect(canAccessModule('croquis', MODS_ESTUDIO, 'admin')).toBe(false)
    expect(canAccessModule('acceso_fisico', MODS_ESTUDIO, 'admin')).toBe(false)
    expect(canAccessModule('facturacion', MODS_ESTUDIO, 'admin')).toBe(false)
  })

  it('Crecimiento accede a croquis pero NO a acceso físico ni facturación (son Pro)', () => {
    expect(canAccessModule('croquis', MODS_CRECIMIENTO, 'admin')).toBe(true)
    expect(canAccessModule('acceso_fisico', MODS_CRECIMIENTO, 'admin')).toBe(false)
    expect(canAccessModule('facturacion', MODS_CRECIMIENTO, 'admin')).toBe(false)
  })

  it('Pro accede a todo, incluido acceso físico y facturación', () => {
    expect(canAccessModule('croquis', MODS_PRO, 'admin')).toBe(true)
    expect(canAccessModule('acceso_fisico', MODS_PRO, 'admin')).toBe(true)
    expect(canAccessModule('facturacion', MODS_PRO, 'admin')).toBe(true)
  })

  it('los módulos-pestaña Pro NO ensucian el sidebar (grupo null → no agrupados)', () => {
    // visibleModules los incluye (para canAccessModule) pero groupedModules los
    // omite por grupo null. Verificamos que su grupo sea null.
    for (const slug of ['croquis', 'acceso_fisico', 'facturacion']) {
      const m = MODULES.find((x) => x.slug === slug)
      expect(m, `falta el módulo ${slug}`).toBeTruthy()
      expect(m.grupo, `${slug} no debe ir al sidebar`).toBeNull()
    }
  })

  it('un no-admin nunca ve las pestañas Pro aunque el plan alcance', () => {
    // acceso/facturación/croquis son roles:['admin']; un recepcionista no entra
    expect(canAccessModule('acceso_fisico', MODS_PRO, 'recepcion')).toBe(false)
    expect(canAccessModule('facturacion', MODS_PRO, 'recepcion')).toBe(false)
  })

  it('el reparto no rompió los módulos existentes (Estudio conserva lo suyo)', () => {
    for (const slug of MODS_ESTUDIO) {
      expect(canAccessModule(slug, MODS_ESTUDIO, 'admin'), `Estudio perdió ${slug}`).toBe(true)
    }
  })
})
