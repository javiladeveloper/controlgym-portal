// Catálogo comercial de FitControl: qué plan(es) puede contratar cada
// segmento de negocio y a qué precio. Espejo de precio_plan() en la BD.
//
// Gimnasios (categoría fitness) eligen entre 3 tamaños; los demás segmentos
// tienen plan único pensado para lo que realmente usan.
export const PLANES_GYM = [
  { slug: 'estudio', nombre: 'Estudio', base: 49, conApp: 79, para: 'Hasta 100 socios activos · 1 sede', limite: 100 },
  { slug: 'crecimiento', nombre: 'Crecimiento', base: 99, conApp: 139, para: 'Socios ilimitados · hasta 3 sedes', popular: true, limite: null },
  { slug: 'cadena', nombre: 'Cadena', base: 179, conApp: 229, para: 'Socios y sedes ilimitados', limite: null },
]

export const PLANES_SEGMENTO = {
  clases: { slug: 'academia', nombre: 'Academia', base: 49, conApp: 69, para: 'Clases, alumnos, cobros y tu página web — sin módulos que no usas' },
  ninos: { slug: 'ninos', nombre: 'Niños', base: 69, conApp: 109, para: 'Alumnos con apoderados, clases por edades y tu página web' },
  personal_trainer: { slug: 'trainer', nombre: 'Trainer', base: 29, conApp: 49, para: 'Tus clientes, tus paquetes de sesiones y tu página personal' },
}

// Planes disponibles según la categoría del negocio
export function planesPorCategoria(categoriaCodigo) {
  const seg = PLANES_SEGMENTO[categoriaCodigo]
  return seg ? [seg] : PLANES_GYM
}

// Ficha de un plan comercial por su slug (para Mi plan)
export function planPorSlug(slug) {
  return [...PLANES_GYM, ...Object.values(PLANES_SEGMENTO)].find((p) => p.slug === slug) || null
}
