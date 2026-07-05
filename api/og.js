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

export default async function handler(req, res) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase()
  const sub = host.endsWith('.' + ROOT) ? host.slice(0, -(ROOT.length + 1)) : ''
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
