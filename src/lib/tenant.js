// Resuelve el "slug" del gym (tenant) desde la URL.
//
// Producción: subdominio → gym1.fitcorecenter.com  → slug 'gym1'
// Desarrollo: localhost no tiene subdominios reales, así que se usa ?g=slug
//             (ej. http://localhost:5173/?g=fitcore) o la ruta /g/:slug.
//
// El dominio raíz (fitcorecenter.com / www) y localhost sin ?g NO son un gym:
// muestran el landing de la PLATAFORMA (o el login del portal en dev).

const ROOT_DOMAIN = 'fitcorecenter.com'
const RESERVED = new Set(['www', 'app', 'admin', 'api', 'portal'])

export function getTenantSlug() {
  const host = window.location.hostname

  // Desarrollo: ?g=slug tiene prioridad
  const params = new URLSearchParams(window.location.search)
  const q = params.get('g')
  if (q) return q.toLowerCase()

  // localhost / 127.0.0.1 sin ?g → sin tenant (portal/login o landing plataforma)
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return null

  // Producción: <slug>.fitcorecenter.com
  if (host.endsWith('.' + ROOT_DOMAIN)) {
    const sub = host.slice(0, -(ROOT_DOMAIN.length + 1)) // quita ".fitcorecenter.com"
    if (!sub || RESERVED.has(sub)) return null
    return sub.toLowerCase()
  }

  // Dominio raíz exacto → plataforma
  return null
}

// ¿Estamos en el host del portal/app (no en una landing)? En dev, el portal vive
// en localhost sin ?g; en prod, en app.fitcorecenter.com.
export function isPortalHost() {
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return true
  return host === 'app.' + ROOT_DOMAIN
}

// ¿Estamos en el host de la plataforma (apex/www), sin importar la ruta?
// Sirve para páginas hermanas de la landing (/terminos, /privacidad).
// En dev se simula con ?home
export function isPlataformaHost() {
  const host = window.location.hostname
  const params = new URLSearchParams(window.location.search)
  if (params.has('home')) return true
  return host === ROOT_DOMAIN || host === 'www.' + ROOT_DOMAIN
}

// ¿Es el dominio raíz de la plataforma (fitcorecenter.com / www)? Ahí vive la
// landing de FitControl que vende el SaaS a los gimnasios.
// En dev se previsualiza con ?home
export function isPlataformaHome() {
  const host = window.location.hostname
  const params = new URLSearchParams(window.location.search)
  if (params.has('home')) return true
  return (host === ROOT_DOMAIN || host === 'www.' + ROOT_DOMAIN)
    && window.location.pathname === '/'
    && !params.get('g')
}

// URL pública de la página de un gym: subdominio real en producción,
// ?g=slug solo en desarrollo (localhost no tiene subdominios).
export function urlPublica(slug) {
  if (!slug) return '#'
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    return `${window.location.origin}/?g=${slug}`
  }
  return `https://${slug}.${ROOT_DOMAIN}`
}

export { ROOT_DOMAIN }
