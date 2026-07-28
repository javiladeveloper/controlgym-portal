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
    // + la home de cada gym con página pública activa y suscripción vigente.
    // OJO: solo los subdominios que RESUELVEN de verdad. Algunos gyms quedan en
    // la BD sin su subdominio aprovisionado en Vercel (preparar_subdominio puede
    // fallar en silencio), y si Google encuentra UNA sola URL muerta en el
    // sitemap, rechaza el sitemap ENTERO. Por eso se verifica cada uno en vivo.
    try {
      const q = await db().query(
        `select e.slug from public.empresa e
          where e.landing_activa and e.deleted_at is null
            and coalesce(e.slug,'') <> '' and public.empresa_tiene_acceso(e.id)
          order by e.slug limit 2000`,
      )
      // chequeo de resolución en paralelo, con timeout corto para no colgar la
      // respuesta; un gym que no responde en 4s simplemente no entra al sitemap.
      const vivos = await Promise.all(q.rows.map(async (g) => {
        const u = `https://${g.slug}.${ROOT}/`
        try {
          const c = new AbortController()
          const t = setTimeout(() => c.abort(), 4000)
          const r = await fetch(u, { method: 'HEAD', redirect: 'manual', signal: c.signal })
          clearTimeout(t)
          return r.status > 0 && r.status < 500 ? g.slug : null
        } catch { return null }
      }))
      for (const slug of vivos) if (slug) urls.push(url(`https://${slug}.${ROOT}/`, '0.7'))
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
