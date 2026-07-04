// POST /api/culqi/suscribir — activa el pago automático de la suscripción
// de FitControl para una empresa (la del admin que llama).
//
// Body: { empresa_id, token_id, email }
//   token_id: token de tarjeta generado por Culqi Checkout en el navegador.
// Flujo Culqi: customer → card → subscription (plan pre-creado en Culqi,
// ids en env CULQI_PLANES = {"estudio":"...","estudio_app":"...", ...}).
import { db, usuarioDesdeJwt } from '../_lib/db.js'

const CULQI = 'https://api.culqi.com/v2'

async function culqi(path, body) {
  const res = await fetch(`${CULQI}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.CULQI_SECRET_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.user_message || data?.merchant_message || `Culqi ${path} ${res.status}`
    throw new Error(msg)
  }
  return data
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  try {
    if (!process.env.CULQI_SECRET_KEY || !process.env.CULQI_PLANES) {
      return res.status(503).json({ error: 'Pagos aún no habilitados' })
    }
    const { empresa_id, token_id, email } = req.body || {}
    if (!empresa_id || !token_id) return res.status(400).json({ error: 'Faltan datos' })

    const user = await usuarioDesdeJwt(req)
    if (!user?.id) return res.status(401).json({ error: 'Sesión inválida' })

    // Debe ser admin de esa empresa; traemos su suscripción
    const q = await db().query(
      `select s.*, e.nombre as empresa_nombre
       from public.suscripcion_plataforma s
       join public.empresa e on e.id = s.empresa_id
       join public.usuario_empresa ue on ue.empresa_id = s.empresa_id
       join public.rol r on r.id = ue.rol_id
       where ue.usuario_id = $1 and r.codigo = 'admin' and s.empresa_id = $2`,
      [user.id, empresa_id],
    )
    const sus = q.rows[0]
    if (!sus) return res.status(403).json({ error: 'No eres administrador de este gimnasio' })
    if (sus.estado === 'activa') return res.status(409).json({ error: 'El pago automático ya está activo' })

    const planes = JSON.parse(process.env.CULQI_PLANES)
    const planKey = sus.con_app ? `${sus.plan_slug}_app` : sus.plan_slug
    const planId = planes[planKey]
    if (!planId) return res.status(500).json({ error: `Plan Culqi no configurado: ${planKey}` })

    const mail = email || user.email
    const nombre = (user.user_metadata?.full_name || 'Admin FitControl').split(' ')

    // 1) Cliente (si ya existe para ese email, Culqi devuelve error → reintentar solo con lo mínimo no aplica; guardamos el nuestro)
    let customerId = sus.proveedor_customer_id
    if (!customerId) {
      const customer = await culqi('/customers', {
        first_name: nombre[0] || 'Admin',
        last_name: nombre.slice(1).join(' ') || sus.empresa_nombre || 'FitControl',
        email: mail,
        address: 'Lima, Peru',
        address_city: 'Lima',
        country_code: 'PE',
        phone_number: '999999999',
      })
      customerId = customer.id
    }

    // 2) Tarjeta desde el token del Checkout
    const card = await culqi('/cards', { customer_id: customerId, token_id })

    // 3) Suscripción al plan
    const sub = await culqi('/recurrent/subscriptions/create', {
      card_id: card.id,
      plan_id: planId,
      tyc: true,
      metadata: { empresa_id },
    })

    await db().query(
      `update public.suscripcion_plataforma
       set estado = 'activa', proveedor = 'culqi',
           proveedor_customer_id = $2, proveedor_card_id = $3, proveedor_suscripcion_id = $4,
           proximo_cobro = greatest(coalesce(trial_hasta, current_date), current_date)
       where id = $1`,
      [sus.id, customerId, card.id, sub.id],
    )

    return res.status(200).json({ ok: true, suscripcion: sub.id })
  } catch (err) {
    console.error('suscribir error', err)
    return res.status(500).json({ error: err.message || 'Error al activar el pago' })
  }
}
