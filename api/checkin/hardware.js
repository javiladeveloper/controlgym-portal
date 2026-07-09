// POST /api/checkin/hardware — endpoint ESTÁNDAR para molinetes/lectores físicos.
//
// Lo llama el "Agente Puente" instalado en la PC del gym (no el navegador). El
// agente traduce la marca del lector (ZKTeco/Hikvision/…) a esta llamada única,
// así FitCore ve un solo formato sin importar el hardware. Se autentica con la
// API key del gym (generada en el panel). Esto es lo que permite vender la
// integración a nivel nacional sin configurar cada equipo a mano.
//
// Auth:  Authorization: Bearer fk_live_...   (la API key del gym)
// Body:  { credencial: "<id que da el lector>", tipo?: 'huella'|'tarjeta'|'facial',
//          dispositivo?: "<nombre/serie del lector>", direccion?: 'entrada'|'salida' }
// Resp:  { resultado:'permitido'|'denegado', tipo, nombre, rol, motivo?, hora? }
//        El molinete abre la puerta solo si resultado === 'permitido'.
import { createHash } from 'node:crypto'
import { db } from '../_lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  // 1) API key del header Authorization: Bearer <key>
  const auth = req.headers.authorization || ''
  const apiKey = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!apiKey) return res.status(401).json({ resultado: 'denegado', motivo: 'sin_clave' })

  const { credencial, tipo, dispositivo, direccion } = req.body || {}
  if (!credencial) return res.status(400).json({ resultado: 'denegado', motivo: 'sin_credencial' })

  try {
    // 2) Hash de la clave (nunca viaja ni se guarda en claro). El match lo hace
    //    la RPC contra empresa_api_key.key_hash.
    const keyHash = createHash('sha256').update(apiKey).digest('hex')

    const { rows } = await db().query(
      `select public.checkin_hardware($1, $2, $3, $4, $5) as r`,
      [keyHash, String(credencial), tipo || 'huella', dispositivo || null, direccion || null],
    )
    const r = rows[0]?.r || { resultado: 'denegado', motivo: 'error' }

    // clave inválida → 401 para que el agente sepa reconfigurar; el resto 200.
    if (r.motivo === 'clave_invalida') return res.status(401).json(r)
    return res.status(200).json(r)
  } catch (e) {
    console.error('checkin/hardware', e)
    // No filtramos el error al lector; denegamos de forma segura.
    return res.status(200).json({ resultado: 'denegado', motivo: 'error_servidor' })
  }
}
