// Catálogo maestro de navegación del panel.
// Fuente única de qué rutas existen. El sidebar y las rutas se generan de aquí,
// filtrando por: (1) módulos habilitados de la empresa (enabledModules del bootstrap),
// (2) rol del usuario. El slug coincide con `modulo.slug` en la BD.
//
// `grupo` agrupa los módulos en secciones del sidebar (UX: no una lista plana).

// Orden y etiqueta de los grupos del sidebar.
export const GRUPOS = [
  { key: 'plataforma', label: 'FitCore' }, // solo super-admin de la plataforma
  { key: 'general', label: 'General' },
  { key: 'socios', label: 'Socios' },
  { key: 'operacion', label: 'Operación' },
  { key: 'negocio', label: 'Negocio' },
  { key: 'config', label: 'Configuración' },
]

// roles: null = todos los roles; array = solo esos roles ven el módulo.
// soloSuperadmin: visible únicamente para el dueño de la plataforma.
export const MODULES = [
  { slug: 'plataforma',  label: 'Dashboard global', grupo: 'plataforma', roles: null, alwaysOn: true, soloSuperadmin: true },

  { slug: 'dashboard',   label: 'Dashboard',        grupo: 'general',   roles: null },

  { slug: 'clientes',    label: 'Clientes',         grupo: 'socios',    roles: null },
  { slug: 'crm',         label: 'CRM',              grupo: 'socios',    roles: ['admin', 'recepcion'] },
  { slug: 'membresias',  label: 'Membresías',       grupo: 'socios',    roles: ['admin', 'recepcion'] },
  { slug: 'rutinas',     label: 'Rutinas y dietas', grupo: 'socios',    roles: ['admin', 'entrenador', 'nutricionista'] },

  { slug: 'clases',      label: 'Clases',           grupo: 'operacion', roles: null },
  { slug: 'personal',    label: 'Personal',         grupo: 'operacion', roles: ['admin'] },
  { slug: 'kardex',      label: 'Kardex',           grupo: 'operacion', roles: ['admin', 'recepcion'] },
  { slug: 'maquinas',    label: 'Máquinas',         grupo: 'operacion', roles: ['admin', 'mantenimiento'] },

  { slug: 'promociones', label: 'Promociones',      grupo: 'negocio',   roles: ['admin', 'recepcion'] },
  { slug: 'finanzas',    label: 'Finanzas',         grupo: 'negocio',   roles: ['admin'] },
  { slug: 'sponsors',    label: 'Sponsors',         grupo: 'negocio',   roles: ['admin'] },
  { slug: 'reportes',    label: 'Reportes',         grupo: 'negocio',   roles: ['admin'] },

  { slug: 'configuracion', label: 'Configuración',   grupo: 'config',    roles: ['admin'], alwaysOn: true },
]

// Devuelve los módulos visibles para un usuario según empresa (módulos habilitados),
// rol y si es super-admin de la plataforma.
export function visibleModules(enabledModules, rol, esSuperadmin = false) {
  const enabled = new Set(enabledModules || [])
  return MODULES.filter((m) => {
    if (m.soloSuperadmin && !esSuperadmin) return false
    const moduleOn = m.alwaysOn || m.slug === 'dashboard' || enabled.has(m.slug)
    const roleOk = !m.roles || (rol && m.roles.includes(rol))
    return moduleOn && roleOk
  })
}

// Agrupa los módulos visibles por su `grupo`, respetando el orden de GRUPOS.
// Devuelve [{ key, label, items: [...] }] omitiendo grupos vacíos.
export function groupedModules(enabledModules, rol, esSuperadmin = false) {
  const visibles = visibleModules(enabledModules, rol, esSuperadmin)
  return GRUPOS
    .map((g) => ({ ...g, items: visibles.filter((m) => m.grupo === g.key) }))
    .filter((g) => g.items.length > 0)
}

// ¿El usuario puede acceder a este slug? (para el guard por módulo en rutas)
export function canAccessModule(slug, enabledModules, rol, esSuperadmin = false) {
  return visibleModules(enabledModules, rol, esSuperadmin).some((m) => m.slug === slug)
}
