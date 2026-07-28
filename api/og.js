// Tarjeta para compartir (Open Graph) por gimnasio.
// Los crawlers de WhatsApp/Facebook/etc. no ejecutan JS, así que vercel.json
// los enruta aquí: devolvemos un HTML mínimo con los meta del GYM del
// subdominio (su nombre, eslogan y su foto) en vez de la marca FitCore.
import { db, env } from './_lib/db.js'

const ROOT = 'fitcorecenter.com'
const RESERVADOS = new Set(['www', 'app', 'admin', 'api', 'portal'])

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function html({ titulo, descripcion, imagen, url }) {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8" />
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(titulo)}" />
<meta property="og:description" content="${esc(descripcion)}" />
<meta property="og:image" content="${esc(imagen)}" />
<meta property="og:url" content="${esc(url)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0;url=${esc(url)}" />
</head><body></body></html>`
}

// Última versión disponible de la app (para el aviso "nueva versión" que muestra
// la app). Se sirve DESDE og.js — vía rewrite en vercel.json — para no crear una
// función serverless nueva (el plan Hobby topa en 12).
//
// El valor vive en la tabla `app_version` de Supabase (dinámico, sin redeploy):
// el CI de la app lo actualiza por SQL al subir un AAB. Antes vivía en la env var
// APP_ANDROID_LATEST de Vercel, pero esa solo se refresca al REDESPLEGAR el panel,
// así que el popup quedaba congelado. Si la tabla no existe todavía, cae a la env
// var como respaldo (no rompe).
async function responderVersion(res) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  // Cache corto: la app consulta al abrir; 60s basta y no martillea la BD.
  res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300')
  let android = parseInt(env('APP_ANDROID_LATEST') || '0', 10) || 0
  let ios = parseInt(env('APP_IOS_LATEST') || '0', 10) || 0
  try {
    const r = await db().query(
      "select plataforma, version_code from app_version where plataforma in ('android','ios')",
    )
    for (const fila of r.rows) {
      if (fila.plataforma === 'android') android = parseInt(fila.version_code, 10) || android
      if (fila.plataforma === 'ios') ios = parseInt(fila.version_code, 10) || ios
    }
  } catch {
    // Tabla aún no creada o BD inaccesible: usamos los valores de env var.
  }
  return res.status(200).json({
    android: { latest: android, url: 'https://play.google.com/store/apps/details?id=pe.fitcore.app' },
    ios: { latest: ios, url: 'https://apps.apple.com/app/fitcore' },
  })
}

// robots.txt: permite todo y apunta al sitemap del host actual. Cada subdominio
// (gym) sirve el suyo. Se sirve desde og.js — vía rewrite — para no sumar función.
function responderRobots(res, host) {
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800')
  return res.status(200).send(`User-agent: *\nAllow: /\nSitemap: https://${host}/sitemap.xml\n`)
}

// Dominios YA verificados del proyecto en Vercel (una sola llamada, sirve para
// 10 o 10.000 gyms). Devuelve un Set de FQDNs ("gym1.fitcorecenter.com", …) o
// null si no se pudo consultar (sin token / error de red). El sitemap usa null
// para degradar seguro, no para meter URLs muertas.
//
// Cacheado en memoria del contenedor (la función se reusa entre requests con
// Fluid Compute) + el s-maxage=3600 de la respuesta: Vercel casi no se consulta.
const TEAM = 'team_kr4GLmjqzYi9UCOFFz8MPoR6'
// Cache en memoria del contenedor. Con Fluid Compute la instancia se reusa entre
// requests, así que la lista de dominios se consulta a Vercel muy de vez en cuando
// (no en cada request). Vale por 1h; mientras tanto se sirve al instante.
let _domCache = { at: 0, set: null }
async function dominiosVerificadosVercel() {
  const token = env('VERCEL_TOKEN')
  if (!token) return null
  if (_domCache.set && Date.now() - _domCache.at < 3_600_000) return _domCache.set

  // Presupuesto de tiempo DURO: si Vercel no responde rápido, NO bloqueamos el
  // sitemap (Google marca "no se ha podido obtener" si tarda ~>5s). Preferimos
  // servir el sitemap ya —con lo que hubiera en cache, o sin gyms— que colgarnos.
  const ctrl = new AbortController()
  const kill = setTimeout(() => ctrl.abort(), 2500)
  try {
    const set = new Set()
    let next = null
    for (let i = 0; i < 60; i++) {   // techo de seguridad (6000 dominios)
      const u = new URL(`https://api.vercel.com/v9/projects/fitcore/domains`)
      u.searchParams.set('teamId', TEAM)
      u.searchParams.set('limit', '100')
      if (next) u.searchParams.set('since', String(next))
      const r = await fetch(u, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal })
      if (!r.ok) return _domCache.set   // si falla, reusar lo último bueno (o null)
      const data = await r.json()
      for (const d of data.domains || []) {
        if (d?.name && d.verified !== false) set.add(String(d.name).toLowerCase())
      }
      next = data.pagination?.next
      if (!next) break
    }
    _domCache = { at: Date.now(), set }
    return set
  } catch (e) {
    console.error('sitemap dominios vercel', e)
    // timeout/abort: servir con lo último cacheado (o null si nunca hubo)
    return _domCache.set
  } finally {
    clearTimeout(kill)
  }
}

// sitemap.xml. En el dominio RAÍZ lista las páginas comerciales + una entrada por
// cada gym con página activa (para que Google descubra a los clientes). En un
// SUBDOMINIO de gym lista solo su propia home (su página vive ahí sola).
async function responderSitemap(res, host, sub) {
  const url = (loc, prio) =>
    `  <url><loc>${esc(loc)}</loc>${prio ? `<priority>${prio}</priority>` : ''}</url>`
  const urls = []

  if (!sub || RESERVADOS.has(sub)) {
    // dominio raíz: web comercial
    for (const [path, prio] of [['/', '1.0'], ['/planes', '0.8'], ['/demo', '0.6']]) {
      urls.push(url(`https://${ROOT}${path}`, prio))
    }
    // + la home de cada gym con página pública activa. Solo subdominios que
    // EXISTEN de verdad en Vercel (basta UNA URL muerta para que Google rechace
    // todo el sitemap). Cruzamos la BD contra la lista de dominios de Vercel.
    //
    // CLAVE: nunca bloquear la respuesta. Si la lista de dominios NO está cacheada
    // todavía, servimos el sitemap YA con las páginas comerciales y disparamos la
    // consulta a Vercel en segundo plano para que la próxima lectura ya la tenga.
    // Google marca "no se ha podido obtener" si el sitemap tarda ~>5s.
    try {
      const cacheListo = _domCache.set && Date.now() - _domCache.at < 3_600_000
      if (cacheListo) {
        const q = await db().query(
          `select e.slug from public.empresa e
            where e.landing_activa and e.deleted_at is null
              and coalesce(e.slug,'') <> '' and public.empresa_tiene_acceso(e.id)
            order by e.slug limit 5000`,
        )
        for (const g of q.rows) {
          const fqdn = `${g.slug}.${ROOT}`
          if (_domCache.set.has(fqdn)) urls.push(url(`https://${fqdn}/`, '0.7'))
        }
      } else {
        // caché fría: calentarla para la próxima, sin esperarla ahora
        dominiosVerificadosVercel().catch(() => {})
      }
    } catch (e) {
      console.error('sitemap gyms', e)
    }
  } else {
    // subdominio de un gym: solo su home
    urls.push(url(`https://${host}/`, '1.0'))
  }

  res.setHeader('content-type', 'application/xml; charset=utf-8')
  res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
  )
}

export default async function handler(req, res) {
  // Ruta de versión de la app (enrutada aquí por vercel.json para ahorrar función).
  const ruta = String(req.url || '').split('?')[0]
  if (ruta === '/api/app/version' || ruta.endsWith('/app/version')) {
    return responderVersion(res)  // async; el handler ya es async
  }

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase()
  const sub = host.endsWith('.' + ROOT) ? host.slice(0, -(ROOT.length + 1)) : ''

  // SEO: robots.txt y sitemap.xml (enrutados aquí por vercel.json).
  if (ruta === '/robots.txt') return responderRobots(res, host)
  if (ruta === '/sitemap.xml') return responderSitemap(res, host, sub)

  const fitcore = {
    titulo: 'FitCore · El sistema operativo del fitness',
    descripcion: 'Gimnasios, academias, gyms para niños y personal trainers: gestión, página web propia y captación de clientes.',
    imagen: `https://${ROOT}/landing/og.jpg`,
    url: `https://${ROOT}/`,
  }

  try {
    if (!sub || RESERVADOS.has(sub)) {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.status(200).send(html(fitcore))
    }

    // Solo gyms con suscripción vigente (trial no vencido o activa) muestran
    // su preview — igual que la landing. Si no, cae al OG genérico de FitCore.
    const q = await db().query(
      `select e.nombre, e.eslogan, e.mensaje_bienvenida,
              e.landing->>'hero_url' as hero,
              e.landing->'galeria'->>0 as foto1,
              t.logo_url
       from public.empresa e
       left join public.empresa_tema t on t.empresa_id = e.id
       where lower(e.slug) = $1 and e.landing_activa and e.deleted_at is null
         and public.empresa_tiene_acceso(e.id)
       limit 1`,
      [sub],
    )
    const g = q.rows[0]
    if (!g) {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      return res.status(200).send(html(fitcore))
    }

    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    return res.status(200).send(html({
      titulo: g.eslogan ? `${g.nombre} — ${g.eslogan}` : g.nombre,
      descripcion: g.mensaje_bienvenida || `Planes, horarios e inscripciones de ${g.nombre}. Reserva tu primera clase.`,
      imagen: g.hero || g.foto1 || g.logo_url || fitcore.imagen,
      url: `https://${host}/`,
    }))
  } catch (err) {
    console.error('og error', err)
    res.setHeader('content-type', 'text/html; charset=utf-8')
    return res.status(200).send(html(fitcore))
  }
}
