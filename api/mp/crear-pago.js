// POST /api/mp/crear-pago — el socio (desde la app) paga una membresía, un
// producto, o un CARRITO de productos. Crea una preferencia de Checkout Pro con
// marketplace_fee (5% para FitCore) usando el access_token DEL GYM. Devuelve
// init_point para la app. PEDIDO 15 Fase 1 + carrito.
//
// Body (membresía):  { empresa_id, tipo:'membresia', ref_id, socio_id?, sede_id?,
//                      fecha_inicio?, nuevo?:{nombre,documento,email,telefono} }
// Body (1 producto): { empresa_id, tipo:'producto', ref_id, socio_id?, sede_id?, nuevo? }
// Body (carrito):    { empresa_id, tipo:'producto', items:[{producto_id, cantidad}],
//                      socio_id?, sede_id?, nuevo? }
import { env, db } from '../_lib/db.js'

const COMISION = 0.05 // 5% FitCore

// PEDIDO 23: precio efectivo con la oferta permanente del producto (si hay).
// Misma lógica que el CASE de la RPC catalogo_app — el backend es quien decide
// el monto, nunca el cliente.
function precioEfectivo(precio, tipo, valor) {
  const p = Number(precio); const v = Number(valor)
  if (tipo === 'porcentaje' && v > 0) return Math.round(p * (1 - v / 100) * 100) / 100
  if (tipo === 'monto' && v > 0) return Math.max(0, Math.round((p - v) * 100) / 100)
  return p
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const { empresa_id, tipo, ref_id, items, socio_id, sede_id, fecha_inicio, nuevo, canal } = req.body || {}
  const canalPago = ['app', 'mostrador'].includes(canal) ? canal : 'app'
  if (!empresa_id || !tipo) return res.status(400).json({ error: 'Faltan datos del pago' })
  if (!['membresia', 'producto'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' })

  // Un pago de producto trae ref_id (1 producto) o items[] (carrito).
  const esCarrito = Array.isArray(items) && items.length > 0
  if (tipo === 'producto' && !ref_id && !esCarrito) {
    return res.status(400).json({ error: 'No hay productos en el carrito' })
  }
  if (tipo === 'membresia' && !ref_id) {
    return res.status(400).json({ error: 'Falta la membresía' })
  }

  try {
    // 1) token del gym (debe tener cobros habilitados)
    const { rows: mpRows } = await db().query(
      `select access_token from public.empresa_mp where empresa_id = $1`, [empresa_id])
    const gym = mpRows[0]
    if (!gym) return res.status(400).json({ error: 'Este gimnasio aún no habilitó los pagos en línea' })

    // 2) monto REAL desde el servidor (nunca del cliente).
    //    mpItems = las líneas que verá el socio en el checkout de MP.
    //    carrito = las líneas que persistimos en pago_app_item.
    let monto, concepto, mpItems = [], carrito = []

    if (tipo === 'membresia') {
      const { rows } = await db().query(
        `select p.precio, p.nombre from public.membresia m
           join public.plan p on p.id = m.plan_id
          where m.id = $1 and m.empresa_id = $2 and m.deleted_at is null`,
        [ref_id, empresa_id])
      if (!rows[0]) return res.status(400).json({ error: 'Membresía no válida' })
      monto = Number(rows[0].precio); concepto = 'Plan ' + rows[0].nombre
      mpItems = [{ title: concepto, quantity: 1, unit_price: monto, currency_id: 'PEN' }]

    } else {
      // Producto(s): normalizamos a una lista {producto_id, cantidad}.
      const lineas = esCarrito
        ? items.map((i) => ({ producto_id: i.producto_id, cantidad: Math.max(1, parseInt(i.cantidad, 10) || 1) }))
        : [{ producto_id: ref_id, cantidad: 1 }]

      // Validamos CADA producto server-side: existe, visible en app, y con stock.
      monto = 0
      for (const l of lineas) {
        const { rows } = await db().query(
          `select p.precio, p.nombre, p.descuento_tipo, p.descuento_valor, coalesce(i.stock, 0) as stock
             from public.producto p
             left join public.inventario_sede i
               on i.producto_id = p.id and i.sede_id = $3
            where p.id = $1 and p.empresa_id = $2
              and p.visible_en_app = true and p.deleted_at is null`,
          [l.producto_id, empresa_id, sede_id || null])
        if (!rows[0]) return res.status(400).json({ error: 'Un producto del carrito no está disponible' })
        const p = rows[0]
        if (sede_id && p.stock < l.cantidad) {
          return res.status(400).json({ error: `Sin stock suficiente de ${p.nombre} (quedan ${p.stock})` })
        }
        const precioUnit = precioEfectivo(p.precio, p.descuento_tipo, p.descuento_valor)
        const subtotal = Math.round(precioUnit * l.cantidad * 100) / 100
        monto += subtotal
        carrito.push({ producto_id: l.producto_id, cantidad: l.cantidad, precio_unit: precioUnit, subtotal, nombre: p.nombre })
        mpItems.push({ title: p.nombre, quantity: l.cantidad, unit_price: precioUnit, currency_id: 'PEN' })
      }
      monto = Math.round(monto * 100) / 100
      concepto = carrito.length === 1
        ? `${carrito[0].nombre}${carrito[0].cantidad > 1 ? ` ×${carrito[0].cantidad}` : ''}`
        : `${carrito.reduce((n, c) => n + c.cantidad, 0)} productos`
    }

    if (!(monto > 0)) return res.status(400).json({ error: 'Monto inválido' })
    const fee = Math.round(monto * COMISION * 100) / 100

    // 3) registra la orden pendiente. Para carrito, ref_id queda null (los
    //    productos van en pago_app_item); para 1 producto conservamos ref_id.
    const refUnico = tipo === 'producto' && !esCarrito ? ref_id : (tipo === 'membresia' ? ref_id : null)
    const { rows: pagoRows } = await db().query(
      `insert into public.pago_app
         (empresa_id, sede_id, socio_id, tipo, concepto, ref_id, monto, comision_fitcore,
          fecha_inicio, estado_activacion, nuevo_nombre, nuevo_documento, nuevo_email, nuevo_telefono, canal)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [empresa_id, sede_id || null, socio_id || null, tipo, concepto, refUnico, monto, fee,
       fecha_inicio || null, socio_id ? 'no_aplica' : 'pendiente_activacion',
       nuevo?.nombre || null, nuevo?.documento || null, nuevo?.email || null, nuevo?.telefono || null, canalPago])
    const pagoId = pagoRows[0].id

    // 3b) persistimos las líneas del carrito (también para 1 producto, así el
    //     recojo/entrega/cancelación es uniforme).
    if (tipo === 'producto') {
      for (const c of carrito) {
        await db().query(
          `insert into public.pago_app_item (pago_id, producto_id, cantidad, precio_unit, subtotal)
           values ($1,$2,$3,$4,$5)`,
          [pagoId, c.producto_id, c.cantidad, c.precio_unit, c.subtotal])
      }
    }

    // 4) preferencia con split usando el token DEL GYM
    const pref = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { authorization: `Bearer ${gym.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        items: mpItems,
        marketplace_fee: fee,                       // ← el 5% para FitCore
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
