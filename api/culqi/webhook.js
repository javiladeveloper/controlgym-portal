// POST /api/culqi/webhook — Culqi notifica aquí los eventos de cobro.
// Configurar en el panel de Culqi: https://fitcorecenter.com/api/culqi/webhook
//
// Estrategia defensiva: el shape del payload varía por tipo de evento, así
// que guardamos el crudo, deduplicamos por id del cargo y actualizamos la
// suscripción por su id de Culqi. Siempre respondemos 200 para no acumular
// reintentos (los errores quedan en logs).
import { db } from '../_lib/db.js'

export default async function handler(req, res) {
  try {
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    let data = body?.data ?? body?.object ?? body
    if (typeof data === 'string') { try { data = JSON.parse(data) } catch { data = {} } }

    const tipo = String(body?.type || body?.event || '').toLowerCase()
    const subId = data?.subscription_id || data?.subscription?.id
      || data?.metadata?.subscription_id || null
    const chargeId = data?.id || body?.id || null
    const montoCent = Number(data?.amount || 0)
    const exito = /succ|paid|approv|exitos/.test(tipo) || data?.outcome?.type === 'venta_exitosa'
    const fallo = /fail|reject|denied|fallid/.test(tipo)

    if (!subId && !chargeId) return res.status(200).json({ ok: true, skip: 'sin ids' })

    // Ubicar la suscripción por su id en Culqi (o por metadata.empresa_id)
    const empId = data?.metadata?.empresa_id || null
    const q = await db().query(
      `select * from public.suscripcion_plataforma
       where ($1::text is not null and proveedor_suscripcion_id = $1)
          or ($2::uuid is not null and empresa_id = $2)
       limit 1`,
      [subId, empId],
    )
    const sus = q.rows[0]
    if (!sus) return res.status(200).json({ ok: true, skip: 'suscripción no encontrada' })

    if (exito && chargeId) {
      await db().query(
        `insert into public.pago_plataforma (empresa_id, suscripcion_id, monto, moneda, estado, proveedor, proveedor_pago_id, raw)
         values ($1, $2, $3, 'PEN', 'exitoso', 'culqi', $4, $5)
         on conflict (proveedor_pago_id) do nothing`,
        [sus.empresa_id, sus.id, montoCent ? montoCent / 100 : sus.monto, String(chargeId), JSON.stringify(body).slice(0, 20000)],
      )
      await db().query(
        `update public.suscripcion_plataforma
         set estado = 'activa', proximo_cobro = (current_date + interval '1 month')::date
         where id = $1`,
        [sus.id],
      )
    } else if (fallo) {
      await db().query(
        `insert into public.pago_plataforma (empresa_id, suscripcion_id, monto, moneda, estado, proveedor, proveedor_pago_id, raw)
         values ($1, $2, $3, 'PEN', 'fallido', 'culqi', $4, $5)
         on conflict (proveedor_pago_id) do nothing`,
        [sus.empresa_id, sus.id, montoCent ? montoCent / 100 : sus.monto, chargeId ? String(chargeId) : `fail_${Date.now()}`, JSON.stringify(body).slice(0, 20000)],
      )
      await db().query(
        `update public.suscripcion_plataforma set estado = 'pendiente_pago' where id = $1`,
        [sus.id],
      )
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('webhook culqi error', err)
    return res.status(200).json({ ok: false })
  }
}
