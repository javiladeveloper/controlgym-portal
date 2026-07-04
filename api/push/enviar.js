// POST /api/push/enviar — worker de notificaciones push.
// La BD encola en push_cola (triggers de rutina/dieta enviada, vencimientos,
// cumpleaños) y pg_cron llama aquí cada minuto con un secreto compartido.
// Envía por FCM HTTP v1 firmando el JWT de la service account con crypto de
// Node (sin dependencias). Tokens muertos (UNREGISTERED) se limpian solos.
import crypto from 'node:crypto'
import { db, env } from '../_lib/db.js'

function serviceAccount() {
  return JSON.parse(Buffer.from(env('FIREBASE_SA_B64'), 'base64').toString('utf8'))
}

// OAuth de Google: JWT RS256 firmado → access token (cache en memoria de la lambda)
let tokenCache = { token: null, exp: 0 }
async function accessToken(sa) {
  if (tokenCache.token && Date.now() / 1000 < tokenCache.exp - 60) return tokenCache.token
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const sinFirmar = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })
  const firma = crypto.createSign('RSA-SHA256').update(sinFirmar).sign(sa.private_key).toString('base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${sinFirmar}.${firma}`,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('OAuth Google: ' + (data.error_description || res.status))
  tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) }
  return tokenCache.token
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  if ((req.headers['x-push-secret'] || '') !== env('PUSH_WORKER_SECRET')) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  try {
    const sa = serviceAccount()

    // Pendientes (máx 50 por corrida) con sus tokens
    const { rows } = await db().query(
      `select c.id, c.titulo, c.cuerpo, c.data, t.token
       from public.push_cola c
       join public.push_token t on t.usuario_id = c.usuario_id
       where c.enviado_at is null and c.creado_at > now() - interval '2 days'
       order by c.creado_at
       limit 50`,
    )
    if (rows.length === 0) return res.status(200).json({ ok: true, enviados: 0 })

    const auth = await accessToken(sa)
    let enviados = 0
    const hechas = new Set()

    for (const r of rows) {
      // FCM exige data con valores string
      const data = Object.fromEntries(
        Object.entries({ ...(r.data || {}), titulo: r.titulo, cuerpo: r.cuerpo })
          .map(([k, v]) => [k, String(v)]),
      )
      const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: r.token,
            notification: { title: r.titulo, body: r.cuerpo },
            data,
            android: { priority: 'high' },
          },
        }),
      })
      if (resp.ok) {
        enviados++
        hechas.add(r.id)
      } else {
        const err = await resp.json().catch(() => ({}))
        const code = err?.error?.details?.find((d) => d.errorCode)?.errorCode || err?.error?.status
        if (code === 'UNREGISTERED' || resp.status === 404) {
          // token muerto (app desinstalada): fuera, y la notificación se da por cerrada
          await db().query('delete from public.push_token where token = $1', [r.token])
          hechas.add(r.id)
        } else {
          console.error('FCM error', resp.status, JSON.stringify(err).slice(0, 300))
          // se reintenta en la próxima corrida (hasta 2 días)
        }
      }
    }

    if (hechas.size > 0) {
      await db().query('update public.push_cola set enviado_at = now() where id = any($1)', [[...hechas]])
    }
    return res.status(200).json({ ok: true, enviados, pendientes: rows.length - hechas.size })
  } catch (err) {
    console.error('push worker error', err)
    return res.status(500).json({ error: err.message })
  }
}
