// Genera dist/sitemap.xml y dist/robots.txt como ARCHIVOS ESTÁTICOS en el build.
//
// Por qué estático y no una función: el sitemap dinámico (api/og.js) sufría el
// cold-start de Vercel (~10s intermitente) y Google marcaba "no se ha podido
// obtener" cuando el crawler caía en un contenedor frío. Un archivo estático
// responde al instante siempre, sin función ni cold start.
//
// Trade-off aceptado: se regenera en cada deploy, no al vuelo. Para un sitemap es
// perfecto — Google lo re-lee cada varios días, no cada minuto. Un gym nuevo
// aparece en el próximo deploy (o se puede forzar un redeploy).
//
// Corre después de `vite build`. Si la BD no está disponible en el build, cae a
// solo las páginas comerciales (nunca rompe el deploy).
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const ROOT = 'fitcorecenter.com'
const DIST = path.resolve('dist')

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const urlTag = (loc, prio) => `  <url><loc>${esc(loc)}</loc><priority>${prio}</priority></url>`

async function gymsActivos() {
  const conn = process.env.DATABASE_URL
  if (!conn) { console.warn('[sitemap] sin DATABASE_URL: solo páginas comerciales'); return [] }
  const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false }, max: 1 })
  try {
    // mismos criterios que el sitemap dinámico: landing activa, suscripción
    // vigente y subdominio aprovisionado (evita URLs muertas que Google rechaza).
    const { rows } = await pool.query(
      `select e.slug from public.empresa e
        where e.landing_activa and e.deleted_at is null and e.subdominio_ok
          and coalesce(e.slug,'') <> '' and public.empresa_tiene_acceso(e.id)
        order by e.slug limit 5000`,
    )
    return rows.map((r) => r.slug)
  } catch (e) {
    console.warn('[sitemap] error consultando gyms, solo comerciales:', e.message)
    return []
  } finally {
    await pool.end().catch(() => {})
  }
}

const gyms = await gymsActivos()

const urls = [
  urlTag(`https://${ROOT}/`, '1.0'),
  urlTag(`https://${ROOT}/planes`, '0.8'),
  urlTag(`https://${ROOT}/demo`, '0.6'),
  ...gyms.map((slug) => urlTag(`https://${slug}.${ROOT}/`, '0.7')),
]

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
const robots = `User-agent: *\nAllow: /\nSitemap: https://${ROOT}/sitemap.xml\n`

fs.mkdirSync(DIST, { recursive: true })
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap)
fs.writeFileSync(path.join(DIST, 'robots.txt'), robots)
console.log(`[sitemap] generado: ${urls.length} URLs (${gyms.length} gyms) → dist/sitemap.xml + robots.txt`)
