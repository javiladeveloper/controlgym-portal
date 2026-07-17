// Endpoint de suscripción SaaS con Culqi. Dos acciones en un archivo (el plan
// Hobby de Vercel limita el nº de funciones serverless):
//   POST /api/culqi?action=suscribir    → activa el pago automático (customer→card→sub)
//   POST /api/culqi?action=agregar-app  → sube al plan con app sobre una sub activa
import { db, usuarioDesdeJwt, env } from '../_lib/db.js'

const CULQI = 'https://api.culqi.com/v2'

async function culqi(method, path, body) {
  const res = await fetch(`${CULQI}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env('CULQI_SECRET_KEY')}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.user_message || data?.merchant_message || `Culqi ${path} ${res.status}`
    throw new Error(msg)
  }
  return data
}

export default async function handler(req, res) {
  const action = (req.query?.action || '').toString()
  if (action === 'agregar-app') return agregarApp(req, res)
  if (action === 'pagar-factura') return pagarFactura(req, res)
  return suscribir(req, res)
}

// ── Pago de una factura del plan 'miembros' (cargo ÚNICO, no suscripción) ────
// El plan por miembro no tiene cuota fija: cada fin de mes se emite una factura
// por los socios activos y el gym la paga con tarjeta desde el panel.
// Body: { factura_id, token_id, email } — token_id del Culqi Checkout.
async function pagarFactura(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  try {
    if (!env('CULQI_SECRET_KEY')) return res.status(503).json({ error: 'Pagos aún no habilitados' })

    const user = await usuarioDesdeJwt(req)
    if (!user) return res.status(401).json({ error: 'No autenticado' })
    const { factura_id, token_id, email } = req.body || {}
    if (!factura_id || !token_id) return res.status(400).json({ error: 'Faltan datos del pago' })

    const pool = db()
    // El monto sale de la BD, jamás del cliente. Y la factura debe ser de una
    // empresa donde el usuario sea admin activo: sin eso, cualquiera con sesión
    // podría pagar (o sondear) facturas ajenas.
    const { rows } = await pool.query(
      `select f.id, f.empresa_id, f.monto, f.estado, f.periodo, f.socios_contados
         from public.factura_sede f
         join public.usuario_empresa ue on ue.empresa_id = f.empresa_id
         join public.rol r on r.id = ue.rol_id
        where f.id = $1 and ue.usuario_id = $2 and ue.activo = true and r.codigo = 'admin'`,
      [factura_id, user.id])
    const fac = rows[0]
    if (!fac) return res.status(404).json({ error: 'Factura no encontrada' })
    if (!['emitida', 'vencida'].includes(fac.estado)) {
      return res.status(400).json({ error: 'Esa factura ya está pagada' })
    }

    const charge = await culqi('POST', '/charges', {
      amount: Math.round(Number(fac.monto) * 100),
      currency_code: 'PEN',
      email: email || user.email || 'pagos@fitcorecenter.com',
      source_id: token_id,
      description: `FitCore — ${fac.socios_contados} socios activos (${String(fac.periodo).slice(0, 7)})`,
      metadata: { factura_id: fac.id, periodo: String(fac.periodo).slice(0, 7) },
    })

    // Deja rastro del cobro y marca la factura pagada. marcar_factura_pagada
    // reactiva la sede solo si ya no le quedan facturas pendientes.
    const { rows: pg } = await pool.query(
      `insert into public.pago_plataforma (empresa_id, monto, moneda, estado, proveedor, proveedor_pago_id, raw)
       values ($1, $2, 'PEN', 'exitoso', 'culqi', $3, $4)
       on conflict (proveedor_pago_id) do update set estado = 'exitoso'
       returning id`,
      [fac.empresa_id, fac.monto, charge.id, JSON.stringify(charge)])

    const { rows: mk } = await pool.query(
      'select public.marcar_factura_pagada($1, $2) as r', [fac.id, pg[0].id])

    return res.status(200).json({ ok: true, cargo_id: charge.id, monto: Number(fac.monto), resultado: mk[0].r })
  } catch (e) {
    return res.status(400).json({ error: e.message || 'No se pudo procesar el pago' })
  }
}

// ── Activa el pago automático de la suscripción de FitCore para una empresa ──
// Body: { empresa_id, token_id, email } — token_id del Culqi Checkout.
async function suscribir(req, res) {
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

    const planes = JSON.parse(env('CULQI_PLANES', '{}'))
    const planKey = sus.con_app ? `${sus.plan_slug}_app` : sus.plan_slug
    const planId = planes[planKey]
    if (!planId) return res.status(500).json({ error: `Plan Culqi no configurado: ${planKey}` })

    const mail = email || user.email
    const nombre = (user.user_metadata?.full_name || 'Admin FitCore').split(' ')

    // 1) Cliente (si ya existe para ese email, Culqi devuelve error → reintentar solo con lo mínimo no aplica; guardamos el nuestro)
    let customerId = sus.proveedor_customer_id
    if (!customerId) {
      const customer = await culqi('POST', '/customers', {
        first_name: nombre[0] || 'Admin',
        last_name: nombre.slice(1).join(' ') || sus.empresa_nombre || 'FitCore',
        email: mail,
        address: 'Lima, Peru',
        address_city: 'Lima',
        country_code: 'PE',
        phone_number: '999999999',
      })
      customerId = customer.id
    }

    // 2) Tarjeta desde el token del Checkout
    const card = await culqi('POST', '/cards', { customer_id: customerId, token_id })

    // 3) Suscripción al plan
    const sub = await culqi('POST', '/recurrent/subscriptions/create', {
      card_id: card.id,
      plan_id: planId,
      tyc: true,
      metadata: { empresa_id },
    })

    // Los planes Culqi tienen el primer ciclo gratis: el primer cobro real
    // siempre sale 1 mes después de activar la tarjeta, se active cuando se active.
    await db().query(
      `update public.suscripcion_plataforma
       set estado = 'activa', proveedor = 'culqi',
           proveedor_customer_id = $2, proveedor_card_id = $3, proveedor_suscripcion_id = $4,
           proximo_cobro = (current_date + interval '1 month')::date
       where id = $1`,
      [sus.id, customerId, card.id, sub.id],
    )

    return res.status(200).json({ ok: true, suscripcion: sub.id })
  } catch (err) {
    console.error('suscribir error', err)
    return res.status(500).json({ error: err.message || 'Error al activar el pago' })
  }
}

// ── El negocio ya paga su plan base y quiere sumar la App del socio ──────────
// Con la tarjeta ya guardada: cancela la sub actual y crea la del plan con app.
async function agregarApp(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  try {
    if (!process.env.CULQI_SECRET_KEY || !process.env.CULQI_PLANES) {
      return res.status(503).json({ error: 'Pagos aún no habilitados' })
    }
    const { empresa_id } = req.body || {}
    if (!empresa_id) return res.status(400).json({ error: 'Faltan datos' })

    const user = await usuarioDesdeJwt(req)
    if (!user?.id) return res.status(401).json({ error: 'Sesión inválida' })

    const q = await db().query(
      `select s.* from public.suscripcion_plataforma s
       join public.usuario_empresa ue on ue.empresa_id = s.empresa_id
       join public.rol r on r.id = ue.rol_id
       where ue.usuario_id = $1 and r.codigo = 'admin' and s.empresa_id = $2`,
      [user.id, empresa_id],
    )
    const sus = q.rows[0]
    if (!sus) return res.status(403).json({ error: 'No eres administrador de este gimnasio' })
    if (sus.estado !== 'activa') return res.status(409).json({ error: 'Primero activa tu plan; la app se agrega sobre un plan activo' })
    if (sus.con_app) return res.status(409).json({ error: 'Tu plan ya incluye la app' })
    if (!sus.proveedor_card_id) return res.status(409).json({ error: 'No hay tarjeta guardada — escríbenos por WhatsApp' })

    const planes = JSON.parse(env('CULQI_PLANES', '{}'))
    const planId = planes[`${sus.plan_slug}_app`]
    if (!planId) return res.status(500).json({ error: `Plan Culqi no configurado: ${sus.plan_slug}_app` })

    // 1) Nueva suscripción al plan con app (misma tarjeta)
    const sub = await culqi('POST', '/recurrent/subscriptions/create', {
      card_id: sus.proveedor_card_id,
      plan_id: planId,
      tyc: true,
      metadata: { empresa_id, upgrade: 'app' },
    })

    // 2) Cancelar la suscripción anterior (después de crear la nueva, para
    //    no dejar al negocio sin suscripción si algo falla)
    if (sus.proveedor_suscripcion_id) {
      try { await culqi('DELETE', `/recurrent/subscriptions/${sus.proveedor_suscripcion_id}`) }
      catch (e) { console.error('No se pudo cancelar la sub anterior', e.message) }
    }

    // 3) Reflejar el upgrade: monto nuevo desde precio_plan (fuente de verdad)
    await db().query(
      `update public.suscripcion_plataforma
       set con_app = true,
           monto = public.precio_plan(plan_slug, true),
           proveedor_suscripcion_id = $2,
           proximo_cobro = (current_date + interval '1 month')::date
       where id = $1`,
      [sus.id, sub.id],
    )

    return res.status(200).json({ ok: true, suscripcion: sub.id })
  } catch (err) {
    console.error('agregar-app error', err)
    return res.status(500).json({ error: err.message || 'No se pudo agregar la app' })
  }
}
