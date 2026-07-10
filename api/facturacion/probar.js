// Prueba la conexión a NORAC del gym del usuario autenticado (admin).
import { db, env, usuarioDesdeJwt } from '../_lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const pool = db()
  // empresa activa del usuario (admin). Un admin puede pertenecer a varias
  // empresas: filtramos membresías activas y priorizamos la empresa default
  // antes de quedarnos con una sola.
  const { rows: emp } = await pool.query(
    `select ue.empresa_id from public.usuario_empresa ue
     where ue.usuario_id = $1 and ue.activo = true and ue.rol_id in
       (select id from public.rol where codigo = 'admin')
     order by ue.es_default desc nulls last limit 1`, [user.id])
  if (!emp.length) return res.status(403).json({ error: 'Solo el administrador' })
  const empresaId = emp[0].empresa_id

  const { rows } = await pool.query('select public.facturacion_credenciales($1) as c', [empresaId])
  const cred = rows[0].c
  if (!cred?.ok) return res.status(400).json({ error: 'Falta configurar el RUC y la API key de NORAC' })

  try {
    const r = await fetch(`${cred.url}/api/documents?limit=1`, {
      headers: { 'X-API-Key': cred.api_key },
    })
    if (r.status === 401 || r.status === 403)
      return res.status(400).json({ error: 'La API key de NORAC no es válida' })
    if (!r.ok) return res.status(400).json({ error: `NORAC respondió ${r.status}` })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo conectar con NORAC: ' + e.message })
  }
}
