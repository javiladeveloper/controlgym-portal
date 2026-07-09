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

    // Buscamos primero el pago local por el payment id (si ya lo teníamos) o,
    // más común, leemos el payment en MP para obtener el external_reference.
    // Para leer el payment usamos el access_token de la app FitCore (marketplace);
    // si no alcanza, resolvemos por external_reference → empresa_mp (token del gym).
    let mpPay = await fetch(`https://api.mercadopago.com/v1/payments/${payId}`, {
      headers: { authorization: `Bearer ${env('MP_ACCESS_TOKEN')}` },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

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
        // Venta desde la app → registra en kardex y descuenta stock (RPC valida).
        await db().query(
          `select public.registrar_mov_inventario($1, $2, 'venta', 1, $3)`,
          [pago.sede_id, pago.ref_id, pago.monto])
      }
      // Socio nuevo → ya está pendiente_activacion; el panel (recepción) lo da de alta.

      // TODO Fase 1.c: emitir comprobante del gym (SEE) y guardar comprobante_url + push al socio.
    }
    return res.status(200).end()
  } catch (e) {
    console.error('mp/webhook', e)
    return res.status(200).end() // 200 siempre: MP reintenta si no
  }
}
