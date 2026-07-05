// POST /api/dni/verificar — puente con MAXFIND (producto hermano del cliente).
// Body: { dni, nombre?, alimentar? }
//   1) Consulta el DNI en el padrón (GET /v1/dni/:numero)
//   2) Si se envía `nombre`, compara localmente contra el padrón (una sola
//      unidad de cuota en vez de dos)
//   3) Si NO existe y viene `alimentar: true` + nombre → lo aporta al padrón
//      (PUT), retroalimentando la base de MAXFIND desde los gyms
// La API key vive en el servidor: el navegador nunca la ve.
import { usuarioDesdeJwt, env } from '../_lib/db.js'

const MAXFIND = 'https://api.maxfind.app/v1'

// Normaliza para comparar: MAYÚSCULAS, sin tildes, espacios simples
const norm = (s) => String(s || '')
  .toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-ZÑ ]/g, ' ').replace(/\s+/g, ' ').trim()

// Similitud por tokens (Dice): tolera orden distinto y segundos nombres omitidos
function similitud(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean))
  const B = new Set(norm(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let comunes = 0
  for (const t of A) if (B.has(t)) comunes++
  return (2 * comunes) / (A.size + B.size)
}

// 'JUAN CARLOS PEREZ GARCIA' → nombres + 2 apellidos (convención peruana)
function partirNombre(completo) {
  const t = norm(completo).split(' ').filter(Boolean)
  if (t.length < 2) return null
  if (t.length === 2) return { nombres: t[0], apellido_paterno: t[1] }
  return {
    nombres: t.slice(0, -2).join(' '),
    apellido_paterno: t[t.length - 2],
    apellido_materno: t[t.length - 1],
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  try {
    if (!process.env.MAXFIND_API_KEY) return res.status(503).json({ error: 'Verificación de DNI no configurada' })

    const user = await usuarioDesdeJwt(req)
    if (!user?.id) return res.status(401).json({ error: 'Sesión inválida' })

    const dni = String(req.body?.dni || '').replace(/\D/g, '')
    const nombre = String(req.body?.nombre || '').trim()
    if (!/^\d{8}$/.test(dni)) return res.status(400).json({ error: 'DNI inválido (8 dígitos)' })

    const headers = { authorization: `Bearer ${env('MAXFIND_API_KEY')}` }
    const r = await fetch(`${MAXFIND}/dni/${dni}`, { headers })

    if (r.status === 404) {
      // No está en el padrón: si el gym ya tiene el nombre, lo aportamos
      let alimentado = false
      if (req.body?.alimentar && nombre) {
        const partes = partirNombre(nombre)
        if (partes) {
          const put = await fetch(`${MAXFIND}/dni/${dni}`, {
            method: 'PUT',
            headers: { ...headers, 'content-type': 'application/json' },
            body: JSON.stringify(partes),
          }).catch(() => null)
          alimentado = !!put?.ok // 403 si la org no tiene can_write_cache: silencio
        }
      }
      return res.status(200).json({ encontrado: false, alimentado })
    }

    const out = await r.json().catch(() => ({}))
    if (!r.ok) {
      return res.status(200).json({ encontrado: null, error: out?.error?.message || `MAXFIND ${r.status}` })
    }

    const oficial = out.data?.nombre_completo || ''
    const sim = nombre ? similitud(nombre, oficial) : null
    return res.status(200).json({
      encontrado: true,
      nombre_oficial: oficial,
      similitud: sim,
      coincide: sim === null ? null : sim >= 0.66,
    })
  } catch (err) {
    console.error('dni/verificar error', err)
    // La verificación jamás debe bloquear la operación del gym
    return res.status(200).json({ encontrado: null, error: 'Servicio de verificación no disponible' })
  }
}
