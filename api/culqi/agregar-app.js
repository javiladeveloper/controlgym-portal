// POST /api/culqi/agregar-app — el negocio ya paga su plan base y quiere
// sumar la App del socio. Con la tarjeta ya guardada: se cancela la
// suscripción Culqi actual y se crea la del plan con app. El nuevo plan
// también trae su primer ciclo gratis, así que el siguiente cobro (ya con
// el precio nuevo) sale 1 mes después del upgrade.
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
