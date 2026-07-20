// GET /api/mp/oauth-callback?code=...&state=<empresa_id>
// MercadoPago regresa con el code; lo intercambiamos por el access_token DEL
// GYM y lo guardamos en empresa_mp. PEDIDO 15 Fase 1.
import { env, db } from '../_lib/db.js'

export default async function handler(req, res) {
  const { code, state: empresaId } = req.query
  if (!code || !empresaId) return res.status(400).send('Faltan datos de la conexión')

  try {
    const r = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env('MP_CLIENT_ID'),
        client_secret: env('MP_CLIENT_SECRET'),
        grant_type: 'authorization_code',
        code,
        redirect_uri: env('MP_REDIRECT_URI'),
      }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.access_token) {
      console.error('mp oauth-callback error', data)
      return res.redirect(302, `${env('PANEL_URL', '')}/configuracion?tab=cobros&mp=error`)
    }

    // Guarda/actualiza la conexión del gym. access_token protegido por RLS
    // (esta escritura usa la conexión postgres directa, no pasa por RLS).
    // Qué medios de pago acepta esta cuenta (incluido Yape). Lo consultamos aquí
    // para que el dueño del gym NO tenga que configurar nada: si su cuenta ya
    // tiene Yape —que es lo normal en Perú— la app lo ofrece sola.
    // Best-effort: si la consulta falla, dejamos null y asumimos que sí lo tiene
    // (ver mp_public_key_de_sede); nunca bloqueamos la conexión por esto.
    let medios = null
    try {
      const rm = await fetch('https://api.mercadopago.com/v1/payment_methods', {
        headers: { authorization: `Bearer ${data.access_token}` },
      })
      if (rm.ok) {
        const lista = await rm.json()
        if (Array.isArray(lista)) medios = JSON.stringify(lista.map((m) => m.id).filter(Boolean))
      }
    } catch (e) {
      console.error('mp oauth-callback payment_methods', e.message)
    }

    // public_key: la app la necesita para tokenizar Yape contra la cuenta de
    // ESTE gym (en un marketplace cada gym tiene la suya). Es pública por
    // diseño — va en el cliente — a diferencia del access_token. MP la manda en
    // esta misma respuesta; antes la descartábamos.
    await db().query(
      `insert into public.empresa_mp
         (empresa_id, mp_user_id, access_token, refresh_token, token_expira_at, scope,
          public_key, medios_pago, medios_actualizado_at, actualizado_at)
       values ($1,$2,$3,$4, now() + (($5)::text || ' seconds')::interval, $6, $7,
               $8::jsonb, case when $8 is null then null else now() end, now())
       on conflict (empresa_id) do update set
         mp_user_id = excluded.mp_user_id,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         token_expira_at = excluded.token_expira_at,
         scope = excluded.scope,
         public_key = coalesce(excluded.public_key, public.empresa_mp.public_key),
         medios_pago = coalesce(excluded.medios_pago, public.empresa_mp.medios_pago),
         medios_actualizado_at = coalesce(excluded.medios_actualizado_at, public.empresa_mp.medios_actualizado_at),
         actualizado_at = now()`,
      [empresaId, String(data.user_id), data.access_token, data.refresh_token || null,
       String(data.expires_in ?? 15552000), data.scope || '', data.public_key || null, medios],
    )

    // De vuelta al panel con confirmación visible (Config → cobros).
    return res.redirect(302, `${env('PANEL_URL', '')}/configuracion?tab=cobros&mp=conectado`)
  } catch (e) {
    console.error('mp oauth-callback', e)
    return res.redirect(302, `${env('PANEL_URL', '')}/configuracion?tab=cobros&mp=error`)
  }
}
