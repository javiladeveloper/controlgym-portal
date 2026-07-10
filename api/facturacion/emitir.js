// Worker: emite los comprobantes pendientes a NORAC. Best-effort + idempotente.
// Disparado por Vercel Cron (protegido con CRON_SECRET) o al vuelo tras el cobro.
import { db, env } from '../_lib/db.js'
import { emitirEnNorac } from './_norac.js'

const MAX_INTENTOS = 10

export default async function handler(req, res) {
  // Auth: cron manda Bearer CRON_SECRET; el disparo al vuelo también.
  const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (env('CRON_SECRET') && secret !== env('CRON_SECRET'))
    return res.status(401).json({ error: 'no autorizado' })

  const pool = db()
  // Toma hasta 20 pendientes (todos los gyms) sin bloquear entre invocaciones.
  const { rows: pend } = await pool.query(
    `select * from public.comprobante where estado = 'pendiente'
       and intentos < $1 order by creado_at limit 20`, [MAX_INTENTOS])

  let emitidos = 0
  for (const comp of pend) {
    // Claim atómico: solo procesa si sigue 'pendiente' (evita doble emisión si
    // el cron y el disparo al vuelo corren a la vez sobre el mismo comprobante).
    const { rows: claim } = await pool.query(
      `update public.comprobante set estado='emitiendo', actualizado_at=now()
         where id=$1 and estado='pendiente' returning id`, [comp.id])
    if (!claim.length) continue // otro worker ya lo tomó

    const { rows: cr } = await pool.query('select public.facturacion_credenciales($1) as c', [comp.empresa_id])
    const cred = cr[0].c
    if (!cred?.ok) {
      // Libera el claim (vuelve a 'pendiente') para no dejarlo atascado en 'emitiendo'.
      await pool.query(`update public.comprobante set estado = 'pendiente', intentos = intentos + 1, error_msg = 'gym sin credenciales', actualizado_at = now() where id = $1`, [comp.id])
      continue
    }
    // Líneas: para 'venta' se leen de movimiento_financiero por venta_id; para
    // membresia/pago_app es una sola línea con el concepto.
    let lineas
    if (comp.ref_tipo === 'venta') {
      const { rows: items } = await pool.query(
        `select descripcion, 1 as cantidad, monto as subtotal
           from public.movimiento_financiero where venta_id = $1 and tipo = 'ingreso'`, [comp.ref_id])
      lineas = items.length ? items : [{ descripcion: 'Venta', cantidad: 1, subtotal: comp.total }]
    } else {
      lineas = [{ descripcion: comp.origen === 'membresia' ? 'Membresía' : 'Compra', cantidad: 1, subtotal: comp.total }]
    }

    const r = await emitirEnNorac(cred, comp, lineas)
    if (r.estado === 'emitido') {
      await pool.query(
        `update public.comprobante set estado='emitido', norac_id=$2, serie_numero=$3,
           response_code=$4, actualizado_at=now() where id=$1`,
        [comp.id, r.norac_id, r.serie_numero, r.response_code || null])
      emitidos++
    } else if (r.estado === 'error') {
      await pool.query(
        `update public.comprobante set estado='error', error_msg=$2, intentos=intentos+1, actualizado_at=now() where id=$1`,
        [comp.id, r.error])
    } else {
      // pendiente (red o queued): vuelve a 'pendiente' (libera el claim) e
      // incrementa intentos, guardando norac_id si vino
      await pool.query(
        `update public.comprobante set estado='pendiente', intentos=intentos+1,
           norac_id=coalesce($2,norac_id), error_msg=$3, actualizado_at=now() where id=$1`,
        [comp.id, r.norac_id || null, r.error || null])
    }
  }
  return res.status(200).json({ ok: true, procesados: pend.length, emitidos })
}
