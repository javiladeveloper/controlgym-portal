// POST /api/mp/crear-pago — el socio (desde la app) paga una membresía o
// producto. Crea una preferencia de Checkout Pro con marketplace_fee (3% para
// FitCore) usando el access_token DEL GYM. Devuelve init_point para la app.
// PEDIDO 15 Fase 1.
//
// Body: { empresa_id, tipo:'membresia'|'producto', ref_id, socio_id?,
//         sede_id?, fecha_inicio?, nuevo?:{nombre,documento,email,telefono} }
import { env, db } from '../_lib/db.js'

const COMISION = 0.03 // 3% FitCore

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const { empresa_id, tipo, ref_id, socio_id, sede_id, fecha_inicio, nuevo } = req.body || {}
  if (!empresa_id || !tipo || !ref_id) return res.status(400).json({ error: 'Faltan datos del pago' })
  if (!['membresia', 'producto'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' })

  try {
    // 1) token del gym (debe tener cobros habilitados)
    const { rows: mpRows } = await db().query(
      `select access_token from public.empresa_mp where empresa_id = $1`, [empresa_id])
    const gym = mpRows[0]
    if (!gym) return res.status(400).json({ error: 'Este gimnasio aún no habilitó los pagos en línea' })

    // 2) monto REAL desde el servidor (nunca del cliente)
    let monto, concepto
    if (tipo === 'membresia') {
      const { rows } = await db().query(
        `select p.precio, p.nombre from public.membresia m
           join public.plan p on p.id = m.plan_id
          where m.id = $1 and m.empresa_id = $2 and m.deleted_at is null`,
        [ref_id, empresa_id])
      if (!rows[0]) return res.status(400).json({ error: 'Membresía no válida' })
      monto = Number(rows[0].precio); concepto = 'Plan ' + rows[0].nombre
    } else {
      const { rows } = await db().query(
        `select precio, nombre from public.producto
          where id = $1 and empresa_id = $2 and visible_en_app = true and deleted_at is null`,
        [ref_id, empresa_id])
      if (!rows[0]) return res.status(400).json({ error: 'Producto no disponible' })
      monto = Number(rows[0].precio); concepto = rows[0].nombre
    }
    if (!(monto > 0)) return res.status(400).json({ error: 'Monto inválido' })
    const fee = Math.round(monto * COMISION * 100) / 100

    // 3) registra el pago pendiente (para conciliar en el webhook)
    const { rows: pagoRows } = await db().query(
      `insert into public.pago_app
         (empresa_id, sede_id, socio_id, tipo, concepto, ref_id, monto, comision_fitcore,
          fecha_inicio, estado_activacion, nuevo_nombre, nuevo_documento, nuevo_email, nuevo_telefono)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [empresa_id, sede_id || null, socio_id || null, tipo, concepto, ref_id, monto, fee,
       fecha_inicio || null, socio_id ? 'no_aplica' : 'pendiente_activacion',
       nuevo?.nombre || null, nuevo?.documento || null, nuevo?.email || null, nuevo?.telefono || null])
    const pagoId = pagoRows[0].id

    // 4) preferencia con split usando el token DEL GYM
    const pref = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { authorization: `Bearer ${gym.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: concepto, quantity: 1, unit_price: monto, currency_id: 'PEN' }],
        marketplace_fee: fee,                       // ← el 3% para FitCore
        external_reference: pagoId,                 // para casar el webhook
        back_urls: { success: `${env('APP_DEEP_LINK', 'fitcore://pago')}?ok=1` },
        auto_return: 'approved',
        notification_url: `${env('PANEL_URL')}/api/mp/webhook`,
      }),
    })
    const data = await pref.json().catch(() => ({}))
    if (!pref.ok) {
      console.error('mp crear-pago pref error', data)
      return res.status(400).json({ error: data?.message || 'No se pudo crear el pago' })
    }

    await db().query(`update public.pago_app set mp_preference_id = $1 where id = $2`, [data.id, pagoId])
    return res.status(200).json({ init_point: data.init_point, pago_id: pagoId })
  } catch (e) {
    console.error('mp crear-pago', e)
    return res.status(500).json({ error: 'Error al crear el pago' })
  }
}
