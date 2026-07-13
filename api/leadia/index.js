// Endpoint Leadia (bot IA). Cuatro acciones en un solo archivo (Vercel Hobby
// limita el nº de funciones serverless — ya estamos en el tope):
//   POST /api/leadia?action=aprovisionar  → admin activa el add-on para una sede:
//     crea el tenant en Leadia + emite su api key + crea el flujo plantilla y
//     guarda todo cifrado. Requiere la admin key de plataforma (secreto).
//   POST /api/leadia?action=guardar-flujo → el gym editó su árbol → PATCH a Leadia.
//   GET  /api/leadia?action=estado        → trae el flujo actual de Leadia.
//   POST /api/leadia?action=chat          → la app manda el mensaje del socio y
//     FitCore lo reenvía a Leadia con la api_key descifrada (la app no la ve).
import { db, usuarioDesdeJwt } from '../_lib/db.js'
import { FLUJO_PLANTILLA_GYM } from './_plantilla.js'

export default async function handler(req, res) {
  const action = (req.query?.action || '').toString()
  if (action === 'aprovisionar') return aprovisionar(req, res)
  if (action === 'guardar-flujo') return guardarFlujo(req, res)
  if (action === 'estado') return estado(req, res)
  if (action === 'chat') return chat(req, res)
  if (action === 'leads-frios') return leadsFrios(req, res)
  if (action === 'sync') return sync(req, res)
  return res.status(400).json({ error: 'Acción no reconocida' })
}

// Config de plataforma (secretos): base de la API + admin key de Leadia.
async function configLeadia(pool) {
  const { rows } = await pool.query(
    `select clave, valor from privado.secreto where clave in ('leadia_api_base','leadia_admin_key')`)
  const m = Object.fromEntries(rows.map((r) => [r.clave, r.valor]))
  return { base: m.leadia_api_base || 'https://api.leadai-pe.com', adminKey: m.leadia_admin_key }
}

// El admin de la empresa activa del usuario, y que la sede sea suya.
async function adminYSede(pool, user, sedeId) {
  const { rows } = await pool.query(
    `select s.empresa_id, s.nombre as sede_nombre, e.nombre as empresa_nombre
       from public.sede s join public.empresa e on e.id = s.empresa_id
      where s.id = $1
        and s.empresa_id in (
          select ue.empresa_id from public.usuario_empresa ue
          where ue.usuario_id = $2 and ue.activo = true
            and ue.rol_id in (select id from public.rol where codigo = 'admin'))
      limit 1`, [sedeId, user.id])
  return rows[0] || null
}

// ── Aprovisionar: activar el add-on de IA para una sede ─────────────────────
async function aprovisionar(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const { sedeId, tier } = req.body || {}
  if (!sedeId || !['basica', 'pro', 'full'].includes(tier)) {
    return res.status(400).json({ error: 'Falta sedeId o tier válido (basica/pro/full)' })
  }

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { base, adminKey } = await configLeadia(pool)
  if (!adminKey || adminKey.startsWith('CONFIGURAR')) {
    return res.status(400).json({ error: 'Leadia no está configurado en la plataforma (falta la admin key)' })
  }

  // plan de Leadia según el tier del add-on
  const planLeadia = { basica: 'basico', pro: 'pro', full: 'full' }[tier]
  try {
    // 1) crear el tenant en Leadia (nombre = empresa · sede)
    const rT = await fetch(`${base}/tenants`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: `${info.empresa_nombre} · ${info.sede_nombre}`, plan: planLeadia }),
    })
    if (!rT.ok) return res.status(400).json({ error: `Leadia /tenants respondió ${rT.status}` })
    const tenant = await rT.json()

    // 2) emitir la api key del tenant
    const rK = await fetch(`${base}/tenants/${tenant.id}/api-keys`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'FitCore' }),
    })
    if (!rK.ok) return res.status(400).json({ error: `Leadia api-keys respondió ${rK.status}` })
    const key = await rK.json()

    // 3) crear el flujo plantilla del gym con la api key recién emitida
    let flujoId = null
    try {
      const rF = await fetch(`${base}/flujos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ nombre: 'Flujo del gimnasio', grafo: FLUJO_PLANTILLA_GYM }),
      })
      if (rF.ok) { const f = await rF.json(); flujoId = f.id || null }
    } catch { /* el flujo se puede crear después desde el panel */ }

    // 4) guardar credenciales cifradas + marcar el tier en la suscripción
    await pool.query('select public.guardar_leadia_credenciales($1,$2,$3,$4,$5)',
      [sedeId, info.empresa_id, tenant.id, key.apiKey, flujoId])
    await pool.query('select public.set_leadia_tier($1,$2)', [sedeId, tier])

    return res.status(200).json({ ok: true, tenant_id: tenant.id, flujo_id: flujoId, tier })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo activar Leadia: ' + e.message })
  }
}

// ── Estado: trae el flujo (árbol) actual de la sede desde Leadia ────────────
async function estado(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })
  const sedeId = (req.query?.sedeId || '').toString()
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  if (!cred?.encontrado) return res.status(200).json({ activo: false })

  const { base } = await configLeadia(pool)
  try {
    const r = await fetch(`${base}/flujos`, { headers: { authorization: `Bearer ${cred.api_key}` } })
    if (!r.ok) return res.status(200).json({ activo: true, flujos: [] })
    const flujos = await r.json()
    return res.status(200).json({ activo: true, flujo_id: cred.flujo_id, flujos })
  } catch (e) {
    return res.status(200).json({ activo: true, flujos: [], error: e.message })
  }
}

// ── Guardar flujo: el gym ajustó su árbol → PATCH a Leadia ──────────────────
async function guardarFlujo(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const { sedeId, flujoId, grafo } = req.body || {}
  if (!sedeId || !flujoId || !grafo) return res.status(400).json({ error: 'Falta sedeId, flujoId o grafo' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  if (!cred?.encontrado) return res.status(400).json({ error: 'Esta sede no tiene la IA activa' })

  const { base } = await configLeadia(pool)
  try {
    const r = await fetch(`${base}/flujos/${flujoId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${cred.api_key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ grafo }),
    })
    if (!r.ok) return res.status(400).json({ error: `Leadia respondió ${r.status}` })
    return res.status(200).json({ ok: true })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo guardar el flujo: ' + e.message })
  }
}

// ── Chat: la app manda el mensaje del socio → FitCore lo reenvía a Leadia con
// la api_key descifrada de la sede (así la app NUNCA maneja la key). PEDIDO 34.
// Auth: el socio de la app (JWT). Devuelve la respuesta de la IA tal cual.
async function chat(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const { sedeId, sujeto, mensaje, nombre, origen } = req.body || {}
  if (!sedeId || !sujeto || !mensaje) return res.status(400).json({ error: 'Falta sedeId, sujeto o mensaje' })

  const pool = db()
  // el que consulta debe ser socio de esa empresa (la sede resuelve la empresa)
  const { rows: srows } = await pool.query(
    `select s.empresa_id from public.sede s
      where s.id = $1 and exists (
        select 1 from public.socio so where so.usuario_id = $2 and so.empresa_id = s.empresa_id and so.deleted_at is null)
      limit 1`, [sedeId, user.id])
  if (!srows.length) return res.status(403).json({ error: 'No autorizado para esta sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  if (!cred?.encontrado) return res.status(400).json({ error: 'Esta sede no tiene la IA activa' })

  const { base } = await configLeadia(pool)
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cred.api_key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sujeto, mensaje, nombre, origen }),
    })
    const out = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(r.status).json({ error: out.error || `Leadia respondió ${r.status}` })
    return res.status(200).json(out)  // {respuesta, nivelInteres, accion, escalar, resumen, leadId}
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo contactar a la IA: ' + e.message })
  }
}

// ── Sync PULL: trae de Leadia los calientes+tibios de la sede y los ingresa al
// CRM (idempotente por leadia_lead_id). El modelo es pull — Leadia no empuja;
// FitCore consulta al abrir el CRM. Solo admin de la sede.
async function sync(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })
  const sedeId = (req.body?.sedeId || req.query?.sedeId || '').toString()
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  if (!cred?.encontrado) return res.status(200).json({ activo: false, creados: 0, actualizados: 0 })

  // secreto compartido para llamar al conector leadia_ingresar_lead
  const { rows: sk } = await pool.query(
    `select valor from privado.secreto where clave = 'leadia_ingest_key'`)
  const ingestKey = sk[0]?.valor
  if (!ingestKey) return res.status(500).json({ error: 'Falta leadia_ingest_key en la plataforma' })

  const { base } = await configLeadia(pool)

  // Trae TODOS los items de un nivel paginando por cursor (Leadia filtra un solo
  // nivel por request; tope de páginas por si acaso, para no colgar el request).
  async function traerNivel(nivel) {
    const items = []
    let cursor = null
    for (let pag = 0; pag < 20; pag++) {
      const url = new URL(`${base}/leads`)
      url.searchParams.set('nivel', nivel)
      url.searchParams.set('limit', '100')
      if (cursor) url.searchParams.set('cursor', cursor)
      const r = await fetch(url, { headers: { authorization: `Bearer ${cred.api_key}` } })
      if (!r.ok) break
      const out = await r.json()
      items.push(...(out.items || []))
      cursor = out.siguienteCursor
      if (!cursor) break
    }
    return items
  }

  try {
    const [calientes, tibios] = await Promise.all([traerNivel('caliente'), traerNivel('tibio')])
    const todos = [...calientes, ...tibios]

    let creados = 0, actualizados = 0
    for (const it of todos) {
      // WhatsApp: el contactoExterno suele ser el número; IG/FB no es teléfono.
      const canal = (it.canalOrigen || 'whatsapp').toString().toLowerCase()
      const telefono = canal === 'whatsapp' ? (it.contactoExterno || null) : null
      const { rows: rr } = await pool.query(
        `select public.leadia_ingresar_lead($1,$2,$3,$4,$5,$6,$7,$8,$9) as r`,
        [ingestKey, info.empresa_id, it.nombre || '', telefono, canal,
         it.resumenIA || null, sedeId, it.nivelInteres || 'caliente', it.id])
      const r = rr[0].r
      if (r?.ok) { r.duplicado ? actualizados++ : creados++ }
    }
    return res.status(200).json({ activo: true, creados, actualizados, total: todos.length })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo sincronizar con Leadia: ' + e.message })
  }
}

// ── Leads fríos: los que el bot IGNORÓ (no entraron al CRM). El gym los ve para
// saber a quién descartó Leadia y rescatar alguno si cree que vale. GET a Leadia
// /leads?nivel=frio por sede, con la api_key descifrada. Solo admin.
async function leadsFrios(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })
  const sedeId = (req.query?.sedeId || '').toString()
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  if (!cred?.encontrado) return res.status(200).json({ activo: false, items: [] })

  const { base } = await configLeadia(pool)
  try {
    const r = await fetch(`${base}/leads?nivel=frio&limit=50`, {
      headers: { authorization: `Bearer ${cred.api_key}` },
    })
    if (!r.ok) return res.status(200).json({ activo: true, items: [] })
    const out = await r.json()
    return res.status(200).json({ activo: true, items: out.items || [] })
  } catch (e) {
    return res.status(200).json({ activo: true, items: [], error: e.message })
  }
}
