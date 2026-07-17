// Catálogo comercial de FitCore: qué plan(es) puede contratar cada
// segmento de negocio y a qué precio. Espejo de precio_plan() en la BD.
//
// Gimnasios (categoría fitness) eligen entre 3 tamaños; los demás segmentos
// tienen plan único pensado para lo que realmente usan.
// Precio POR SEDE: cada sede paga su plan. Los planes se diferencian por
// features (qué tan completo es el gym), no por número de sedes.
//
// Los planes de gym traen la app del socio INCLUIDA: precio único, sin la
// dualidad sin-app/con-app que sí conservan los planes de segmento.
export const PLANES_GYM = [
  { slug: 'estudio', nombre: 'Estudio', precio: 99, para: 'Lo esencial · socios ilimitados por sede', limite: null },
  { slug: 'crecimiento', nombre: 'Crecimiento', precio: 169, para: 'CRM, rutinas, kardex y finanzas', popular: true, limite: null },
  { slug: 'pro', nombre: 'Pro', precio: 279, para: 'Torniquetes, huella, cámaras y multi-marca', limite: null },
]

// Plan de entrada sin cuota fija: se cobra S/1 por cada socio con membresía
// vigente al cierre del mes. Si el gym no registra socios, no paga nada.
// No incluye la app: en este plan el gym no aparece para sus socios.
export const PLAN_MIEMBROS = {
  slug: 'miembros',
  nombre: 'Miembros',
  precio: 0,
  porSocio: 1,
  // El gancho es "empiezas sin pagar", no "es gratis": esto es POSPAGO. Poner
  // GRATIS en grande con el precio real en letra chica es justo lo que genera
  // el reclamo (y lo que sanciona Indecopi). El precio va en el mismo tamaño.
  eslogan: 'Empieza sin pagar nada',
  para: 'Sin cuota fija · S/1 por socio activo al mes',
  detalle: 'Gestiona tu gym sin pagar nada por adelantado. A fin de mes pagas S/1 por cada socio con membresía vigente — si no registras socios, no pagas nada.',
  // "Sin compromiso" sería falso: si no pagas la cuenta del mes, la sede queda
  // en solo lectura. Se dice lo que sí es cierto.
  notas: ['Sin cuota fija', 'Sin tarjeta', 'Cancela cuando quieras'],
  letraChica: 'Tus socios no se conectan a la app en este plan: tu gym no aparece en ella.',
  limite: null,
}

export const PLANES_SEGMENTO = {
  clases: { slug: 'academia', nombre: 'Academia', base: 49, conApp: 69, para: 'Clases, alumnos, cobros y tu página web — sin módulos que no usas' },
  ninos: { slug: 'ninos', nombre: 'Niños', base: 69, conApp: 109, para: 'Alumnos con apoderados, clases por edades y tu página web' },
  personal_trainer: { slug: 'trainer', nombre: 'Trainer', base: 29, conApp: 49, para: 'Tus clientes, tus paquetes de sesiones y tu página personal' },
}

// Planes disponibles según la categoría del negocio. Los gimnasios pueden
// arrancar en Miembros (sin cuota) y subir a un plan fijo al crecer.
export function planesPorCategoria(categoriaCodigo) {
  const seg = PLANES_SEGMENTO[categoriaCodigo]
  return seg ? [seg] : [PLAN_MIEMBROS, ...PLANES_GYM]
}

// Ficha de un plan comercial por su slug (para Mi plan)
export function planPorSlug(slug) {
  return [PLAN_MIEMBROS, ...PLANES_GYM, ...Object.values(PLANES_SEGMENTO)].find((p) => p.slug === slug) || null
}

// ¿Este plan trae la app incluida y por tanto no se puede elegir aparte?
// Los de gym sí; los de segmento la venden como extra.
export function appIncluida(slug) {
  return PLANES_GYM.some((p) => p.slug === slug)
}

// Precio mensual de un plan, único punto que sabe si `conApp` aplica.
// Espejo de precio_plan(plan, con_app) en la BD.
export function precioPlan(plan, conApp = false) {
  if (!plan) return 0
  if (plan.precio !== undefined) return plan.precio          // gym y miembros: precio único
  return conApp ? plan.conApp : plan.base                     // segmento: dual
}

// Cuánto pagaría este mes un gym en el plan Miembros con N socios activos.
export function costoMiembros(socios) {
  return Math.max(0, Math.trunc(socios || 0)) * PLAN_MIEMBROS.porSocio
}

// Si con un plan fijo pagaría menos que por socio, cuál le conviene. Devuelve
// null mientras Miembros siga siendo lo más barato — así el panel solo sugiere
// migrar cuando de verdad ahorra, y el gym nunca siente que le cobramos de más.
//
// Descarta los planes cuyo tope de socios no le alcance: recomendar un plan
// más barato donde no le entran sus socios sería mandarlo a un muro.
export function planQueConviene(socios) {
  const n = Math.max(0, Math.trunc(socios || 0))
  const costo = costoMiembros(n)
  const masBarato = PLANES_GYM
    .filter((p) => p.precio < costo && (p.limite == null || n <= p.limite))
    .sort((a, b) => a.precio - b.precio)[0]
  return masBarato ? { plan: masBarato, ahorro: costo - masBarato.precio } : null
}
