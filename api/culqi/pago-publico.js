// POST /api/culqi/pago-publico — checkout PÚBLICO de planes (sin cuenta previa).
// Requisito de Culqi: un botón de pago que el revisor pruebe navegando la web.
// Hace un CARGO ÚNICO del primer mes del plan elegido y registra el intento en
// pago_publico para seguimiento comercial (el alta de la cuenta se hace luego).
//
// Body: { token_id, plan_slug, con_app, email, nombre, telefono, nombre_gym }
//   token_id: token de tarjeta de Culqi Checkout (generado en el navegador).
import { db, env } from '../_lib/db.js'

const CULQI = 'https://api.culqi.com/v2'

// El precio se lee de precio_plan() en la BD — nunca del cliente, y nunca de una
// copia local: este endpoint COBRA de verdad, así que una tabla duplicada aquí
// significa cobrar de menos (o de más) en cuanto cambien los precios. La BD es
// la única fuente de verdad. Devuelve null si el plan no existe.
async function precioDe(planSlug, conApp) {
  const { rows } = await db().query('select public.precio_plan($1, $2) as p', [planSlug, !!conApp])
  const p = rows[0]?.p
  return p == null ? null : Number(p)
}

// El plan 'miembros' no se puede contratar por este checkout: no tiene cuota
// fija que cobrar (se factura a mes vencido según los socios que registre).
const PLANES_NO_CHECKOUT = new Set(['miembros'])

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

  if (PLANES_NO_CHECKOUT.has(plan_slug)) {
    return res.status(400).json({ error: 'El plan Miembros no se paga por adelantado: se factura a fin de mes según tus socios activos' })
  }
  const monto = await precioDe(plan_slug, con_app)
  if (monto == null) return res.status(400).json({ error: 'Plan no válido' })
  if (monto <= 0) return res.status(400).json({ error: 'Este plan no se cobra por adelantado' })
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
