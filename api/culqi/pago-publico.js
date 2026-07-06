// POST /api/culqi/pago-publico — checkout PÚBLICO de planes (sin cuenta previa).
// Requisito de Culqi: un botón de pago que el revisor pruebe navegando la web.
// Hace un CARGO ÚNICO del primer mes del plan elegido y registra el intento en
// pago_publico para seguimiento comercial (el alta de la cuenta se hace luego).
//
// Body: { token_id, plan_slug, con_app, email, nombre, telefono, nombre_gym }
//   token_id: token de tarjeta de Culqi Checkout (generado en el navegador).
import { db, env } from '../_lib/db.js'

const CULQI = 'https://api.culqi.com/v2'

// Precios de referencia EN EL SERVIDOR — nunca se confía en el monto que manda
// el cliente. Espejo de config/planesComerciales.js (montos en soles).
const PRECIOS = {
  trainer: { base: 29, app: 49 },
  estudio: { base: 49, app: 79 },
  academia: { base: 49, app: 69 },
  ninos: { base: 69, app: 109 },
  crecimiento: { base: 99, app: 139 },
  cadena: { base: 179, app: 229 },
}

async function culqi(path, body) {
  const res = await fetch(`${CULQI}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env('CULQI_SECRET_KEY')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.user_message || data?.merchant_message || `Culqi ${path} ${res.status}`
    const err = new Error(msg)
    err.culqi = data
    throw err
  }
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

  const { token_id, plan_slug, con_app, email, nombre, telefono, nombre_gym } = req.body || {}
  if (!token_id || !plan_slug) return res.status(400).json({ error: 'Faltan datos del pago' })

  const precio = PRECIOS[plan_slug]
  if (!precio) return res.status(400).json({ error: 'Plan no válido' })
  const monto = con_app ? precio.app : precio.base
  const montoCentavos = Math.round(monto * 100)

  // Registrar el intento ANTES de cobrar (queda rastro aunque el charge falle).
  let intentoId = null
  try {
    const ins = await db().query(
      `insert into public.pago_publico
         (plan_slug, con_app, monto, moneda, email, nombre, telefono, nombre_gym)
       values ($1,$2,$3,'PEN',$4,$5,$6,$7) returning id`,
      [plan_slug, !!con_app, monto, email || null, nombre || null, telefono || null, nombre_gym || null],
    )
    intentoId = ins.rows[0].id
  } catch (e) {
    console.error('pago-publico: no se pudo registrar el intento', e.message)
    // seguimos: el cobro es lo importante; el registro es best-effort
  }

  try {
    if (!process.env.CULQI_SECRET_KEY) {
      return res.status(503).json({ error: 'Pagos aún no habilitados' })
    }

    const nombrePartes = (nombre || nombre_gym || 'Cliente FitCore').trim().split(/\s+/)
    const charge = await culqi('/charges', {
      amount: montoCentavos,
      currency_code: 'PEN',
      email: email || 'pagos@fitcorecenter.com',
      source_id: token_id,
      description: `FitCore ${plan_slug}${con_app ? ' + App' : ''} — primer mes`,
      antifraud_details: {
        first_name: nombrePartes[0] || 'Cliente',
        last_name: nombrePartes.slice(1).join(' ') || 'FitCore',
        email: email || 'pagos@fitcorecenter.com',
      },
      metadata: { plan: plan_slug, con_app: String(!!con_app), nombre_gym: nombre_gym || '' },
    })

    if (intentoId) {
      await db().query(
        `update public.pago_publico
           set estado='pagado', cargo_id=$2, pagado_at=now() where id=$1`,
        [intentoId, charge.id],
      )
    }
    return res.status(200).json({ ok: true, cargo_id: charge.id, monto })
  } catch (err) {
    console.error('pago-publico error', err.message)
    if (intentoId) {
      await db().query(
        `update public.pago_publico set estado='fallido', error=$2 where id=$1`,
        [intentoId, String(err.message).slice(0, 400)],
      ).catch(() => {})
    }
    return res.status(400).json({ error: err.message || 'No se pudo procesar el pago' })
  }
}
