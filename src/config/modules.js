// Catálogo maestro de navegación del panel.
// Fuente única de qué rutas existen. El sidebar y las rutas se generan de aquí,
// filtrando por: (1) módulos habilitados de la empresa (enabledModules del bootstrap),
// (2) rol del usuario. El slug coincide con `modulo.slug` en la BD.

// roles: null = todos los roles; array = solo esos roles ven el módulo.
export const MODULES = [
  { slug: 'dashboard',   label: 'Dashboard',        roles: null },
  { slug: 'clientes',    label: 'Clientes',         roles: null },
  { slug: 'crm',         label: 'CRM',              roles: ['admin', 'recepcion'] },
  { slug: 'membresias',  label: 'Membresías',       roles: ['admin', 'recepcion'] },
  { slug: 'rutinas',     label: 'Rutinas y dietas', roles: ['admin', 'entrenador', 'nutricionista'] },
  { slug: 'clases',      label: 'Clases',           roles: null },
  { slug: 'promociones', label: 'Promociones',      roles: ['admin', 'recepcion'] },
  { slug: 'personal',    label: 'Personal',         roles: ['admin'] },
  { slug: 'kardex',      label: 'Kardex',           roles: ['admin', 'recepcion'] },
  { slug: 'maquinas',    label: 'Máquinas',         roles: ['admin', 'mantenimiento'] },
  { slug: 'finanzas',    label: 'Finanzas',         roles: ['admin'] },
  { slug: 'sponsors',    label: 'Sponsors',         roles: ['admin'] },
  { slug: 'apariencia',  label: 'Apariencia',       roles: ['admin'], alwaysOn: true }, // white-label; no depende del tipo de gym
  { slug: 'reportes',    label: 'Reportes',         roles: ['admin'] },
]

// Devuelve los módulos visibles para un usuario según empresa (módulos habilitados) y rol.
export function visibleModules(enabledModules, rol) {
  const enabled = new Set(enabledModules || [])
  return MODULES.filter((m) => {
    const moduleOn = m.alwaysOn || m.slug === 'dashboard' || enabled.has(m.slug)
    const roleOk = !m.roles || (rol && m.roles.includes(rol))
    return moduleOn && roleOk
  })
}

// ¿El usuario puede acceder a este slug? (para el guard por módulo en rutas)
export function canAccessModule(slug, enabledModules, rol) {
  return visibleModules(enabledModules, rol).some((m) => m.slug === slug)
}
