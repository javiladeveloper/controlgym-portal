// Endpoint de facturación. Varias acciones en un solo archivo (el plan Hobby de
// Vercel limita el nº de funciones serverless y ya estamos en el tope):
//   POST /api/facturacion?action=probar      → prueba la conexión a NORAC (admin)
//   POST /api/facturacion?action=cierre-mes  → cierre del plan 'miembros': emite
//     las facturas del mes cerrado y bloquea las impagas (cron diario).
//   POST /api/facturacion                    → worker: emite los comprobantes
//     pendientes (cron con CRON_SECRET, o disparo al vuelo tras el cobro).
import { db, env, usuarioDesdeJwt } from '../_lib/db.js'
import { emitirEnNorac } from './_norac.js'

const MAX_INTENTOS = 10

export default async function handler(req, res) {
  const action = (req.query?.action || '').toString()
  if (action === 'probar') return probar(req, res)
  if (action === 'cierre-mes') return cierreMes(req, res)
  return emitir(req, res)
}

// ── Cierre mensual del plan 'miembros' ──────────────────────────────────────
// Corre a diario y se guía por fechas, no por "hoy es 1": si el cron falla un
// día, al siguiente emite y vence igual lo que tocaba. Ambos pasos son
// idempotentes en BD (unique(sede_id, periodo) y filtros por estado).
async function cierreMes(req, res) {
  // Solo el cron. A diferencia del worker de comprobantes, esto EMITE DEUDA y
  // BLOQUEA gimnasios: no se acepta un JWT de usuario, únicamente el secreto.
  //
  // REQUIERE la env var CRON_SECRET en Vercel: si está definida, Vercel la manda
  // sola como `Authorization: Bearer <secret>` al invocar el cron. Sin ella el
  // endpoint responde 401 y el cierre NO corre — falla cerrado a propósito:
  // dejarlo abierto permitiría a cualquiera emitir facturas y bloquear sedes.
  const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!env('CRON_SECRET') || secret !== env('CRON_SECRET')) {
    return res.status(401).json({ error: 'no autorizado' })
  }

  const pool = db()
  // Emite TODO periodo cerrado que falte, no solo el mes anterior: Vercel
  // documenta que la entrega del cron es best-effort y puede saltarse días. Si
  // falla el cambio de mes, con "solo el mes anterior" ese periodo no se
  // emitiría nunca. Idempotente por unique(sede_id, periodo).
  const { rows: em } = await pool.query('select public.emitir_facturas_pendientes() as r')
  // Marca los trials de sede vencidos (antes lo hacía estado_suscripcion_sede
  // al vuelo, pero un SELECT no puede escribir: la policy de la app lo invoca).
  const { rows: tr } = await pool.query('select public.vencer_trials_sede() as r')
  // Vence las facturas que pasaron su plazo → la sede queda en solo lectura.
  const { rows: ve } = await pool.query('select public.vencer_facturas() as r')
  // NOTA: el aviso de "rutina por vencer" YA NO se encola aquí. Este cron corre a
  // las 4am UTC (11pm Perú) y mandaba el push al trainer a esa hora nocturna. Se
  // movió al pg_cron diurno `fitcontrol-rutinas-por-vencer` (10:05am Perú). Ver
  // migración 20260728110000_notificaciones_horario_diurno.sql.

  return res.status(200).json({ ok: true, emision: em[0].r, trials: tr[0].r, vencimiento: ve[0].r })
}

// ── Probar conexión a NORAC del gym del usuario autenticado (admin) ──────────
async function probar(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const pool = db()
  // empresa activa del usuario (admin). Un admin puede pertenecer a varias
  // empresas: filtramos membresías activas y priorizamos la empresa default.
  const { rows: emp } = await pool.query(
    `select ue.empresa_id from public.usuario_empresa ue
     where ue.usuario_id = $1 and ue.activo = true and ue.rol_id in
       (select id from public.rol where codigo = 'admin')
     order by ue.es_default desc nulls last limit 1`, [user.id])
  if (!emp.length) return res.status(403).json({ error: 'Solo el administrador' })

  const { rows } = await pool.query('select public.facturacion_credenciales($1) as c', [emp[0].empresa_id])
  const cred = rows[0].c
  if (!cred?.ok) return res.status(400).json({ error: 'Falta configurar el RUC y la API key de NORAC' })

  try {
    const r = await fetch(`${cred.url}/api/documents?limit=1`, {
      headers: { 'X-API-Key': cred.api_key },
    })
    if (r.status === 401 || r.status === 403)
      return res.status(400).json({ error: 'La API key de NORAC no es válida' })
    if (!r.ok) return res.status(400).json({ error: `NORAC respondió ${r.status}` })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo conectar con NORAC: ' + e.message })
  }
}

// ── Worker: emite los comprobantes pendientes a NORAC (best-effort, idempotente) ──
async function emitir(req, res) {
  // Auth: el cron y el webhook mandan Bearer CRON_SECRET; el POS (frontend)
  // manda el JWT del usuario logueado — no puede tener el CRON_SECRET.
  // Aceptar ambos es seguro: el worker es idempotente (claim atómico por
  // comprobante), así que una invocación de más no duplica emisiones.
  const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (env('CRON_SECRET') && secret !== env('CRON_SECRET')) {
    const user = await usuarioDesdeJwt(req)
    if (!user) return res.status(401).json({ error: 'no autorizado' })
  }

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
