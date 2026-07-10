// POST /api/mp/webhook — MercadoPago notifica el resultado del pago.
// Confirma el pago en pago_app y activa: renueva membresía (socio existente),
// registra venta en kardex (producto), o deja socio nuevo pendiente_activacion.
// Idempotente. Siempre responde 200 (si no, MP reintenta). PEDIDO 15 Fase 1.
import { env, db } from '../_lib/db.js'

export default async function handler(req, res) {
  try {
    const topic = req.query.topic || req.query.type || req.body?.type
    const payId = req.query['data.id'] || req.query.id || req.body?.data?.id
    if (topic !== 'payment' || !payId) return res.status(200).end() // ignora otros topics

    // En un pago con SPLIT (marketplace), el payment vive en la cuenta DEL GYM,
    // no en la de FitCore: leerlo con MP_ACCESS_TOKEN (FitCore) da 404. Por eso
    // probamos leerlo con el token de FitCore primero (por si es un pago directo)
    // y, si falla, con el token de cada gym que tenga cobros conectados hasta que
    // uno lo resuelva. Así obtenemos el external_reference = pago_app.id.
    async function leerPayment(token) {
      return fetch(`https://api.mercadopago.com/v1/payments/${payId}`, {
        headers: { authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    }

    let mpPay = await leerPayment(env('MP_ACCESS_TOKEN'))
    if (!mpPay?.id) {
      // Recorremos los tokens de los gyms conectados (el pago es de uno de ellos).
      const { rows: gyms } = await db().query(`select access_token from public.empresa_mp`)
      for (const g of gyms) {
        mpPay = await leerPayment(g.access_token)
        if (mpPay?.id) break
      }
    }
    if (!mpPay?.id) return res.status(200).end()

    const pagoId = mpPay.external_reference
    if (!pagoId) return res.status(200).end()

    const { rows } = await db().query(`select * from public.pago_app where id = $1`, [pagoId])
    const pago = rows[0]
    if (!pago) return res.status(200).end()
    if (pago.estado_pago === 'aprobado') return res.status(200).end() // idempotente

    const aprobado = mpPay.status === 'approved'
    await db().query(
      `update public.pago_app
          set estado_pago = $1, mp_payment_id = $2, pagado_at = now()
        where id = $3`,
      [aprobado ? 'aprobado' : (mpPay.status === 'rejected' ? 'rechazado' : 'pendiente'),
       String(mpPay.id), pagoId])

    if (aprobado) {
      if (pago.tipo === 'membresia' && pago.socio_id) {
        // Socio existente → renovar/activar su membresía (paga completo).
        await db().query(`select public.renew_membership($1, 'mercadopago')`, [pago.ref_id])
      } else if (pago.tipo === 'producto') {
        // Compra desde la app (1 producto o carrito) → registra la venta de cada
        // ítem y descuenta su stock al pagar (reserva). La orden queda
        // 'pendiente_activacion' = por entregar; recepción la entrega completa
        // en el mostrador (o cancela y se repone todo el stock).
        const { rows: lineas } = await db().query(
          `select producto_id, cantidad, subtotal from public.pago_app_item where pago_id = $1`,
          [pago.id])
        if (lineas.length > 0) {
          for (const l of lineas) {
            await db().query(
              `select public.registrar_mov_inventario($1, $2, 'venta', $3, $4)`,
              [pago.sede_id, l.producto_id, l.cantidad, l.subtotal])
          }
        } else if (pago.ref_id) {
          // Compat: órdenes viejas sin items (1 producto en ref_id).
          await db().query(
            `select public.registrar_mov_inventario($1, $2, 'venta', 1, $3)`,
            [pago.sede_id, pago.ref_id, pago.monto])
        }
        await db().query(
          `update public.pago_app set estado_activacion = 'pendiente_activacion' where id = $1`,
          [pago.id])
      }
      // Socio nuevo → ya está pendiente_activacion; el panel (recepción) lo da de alta.

      // Comprobante electrónico (SEE/NORAC): crea el comprobante en cola y dispara el worker.
      try {
        await db().query(`select public.crear_comprobante_pago_app($1)`, [pago.id])
        // dispara el worker al vuelo (best-effort, no bloquea el 200 del webhook)
        const selfUrl = env('SELF_URL') || ''
        if (selfUrl) {
          fetch(`${selfUrl}/api/facturacion/emitir`, {
            method: 'POST', headers: { authorization: `Bearer ${env('CRON_SECRET')}` },
          }).catch(() => {})
        }
      } catch (e) {
        console.error('mp/webhook crear_comprobante', e)
      }
    }
    return res.status(200).end()
  } catch (e) {
    console.error('mp/webhook', e)
    return res.status(200).end() // 200 siempre: MP reintenta si no
  }
}
