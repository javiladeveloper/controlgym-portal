// Endpoint Leadia (bot IA). Todas las acciones en un solo archivo (Vercel Hobby
// limita el nº de funciones serverless — ya estamos en el tope):
//   POST /api/leadia?action=ingresar-lead → LO LLAMA EL BOT, no el panel: al
//     escalar un lead caliente lo empuja aquí en el momento. Sin JWT (se
//     autentica con el secreto compartido). Es el complemento en caliente de
//     `sync`, que es manual.
//   POST /api/leadia?action=link-pago     → LO LLAMA EL BOT cuando el
//     interesado dice que sí quiere matricularse. Igual que ingresar-lead, sin
//     JWT (secreto compartido). Devuelve el link de MercadoPago para pagar.
//   POST /api/leadia?action=evento        → LO LLAMA EL MOTOR: los salientes que
//     NO nacen de un request de ?action=chat (seguimientos del cron,
//     reactivación, handoffs). Sin JWT, secreto compartido. Dedupe por mensajeId.
//   POST /api/leadia?action=aprovisionar  → admin activa el add-on para una sede:
//     crea el tenant en Leadia (alta atómica del ecosistema, que además ENCIENDE
//     el rubro gimnasio) + crea el flujo plantilla y guarda todo cifrado.
//     Requiere la admin key de plataforma (secreto).
//   POST /api/leadia?action=guardar-flujo → el gym editó su árbol → PATCH a Leadia.
//   GET  /api/leadia?action=estado        → trae el flujo actual de Leadia.
//   POST /api/leadia?action=chat          → la app manda el mensaje del socio y
//     FitCore lo reenvía a Leadia con la api_key descifrada (la app no la ve).
import { db, env, usuarioDesdeJwt } from '../_lib/db.js'
import { FLUJO_PLANTILLA_GYM } from './_plantilla.js'

export default async function handler(req, res) {
  const action = (req.query?.action || '').toString()
  if (action === 'aprovisionar') return aprovisionar(req, res)
  if (action === 'guardar-flujo') return guardarFlujo(req, res)
  if (action === 'estado') return estado(req, res)
  if (action === 'chat') return chat(req, res)
  if (action === 'leads-frios') return leadsFrios(req, res)
  if (action === 'sync') return sync(req, res)
  if (action === 'ingresar-lead') return ingresarLead(req, res)
  if (action === 'link-pago') return linkPago(req, res)
  if (action === 'evento') return evento(req, res)
  if (action === 'canales') return canales(req, res)
  if (action === 'bandeja') return bandeja(req, res)
  if (action === 'campanias') return campanias(req, res)
  if (action === 'destinatarios') return campaniaDestinatarios(req, res)
  return res.status(400).json({ error: 'Acción no reconocida' })
}

// ── Entrada EN CALIENTE desde Leadia (push) ────────────────────────────────
// La llama el propio motor del bot en el momento en que escala un lead, no un
// usuario del panel: por eso NO lleva JWT, se autentica con el secreto
// compartido `leadia_ingest_key` que valida la propia RPC.
//
// Existe porque `sync` (más abajo) es PULL y manual: alguien tiene que pulsar
// "sincronizar" en el CRM. Para vender eso no alcanza — quien pregunta el
// precio un domingo a las 9 de la noche necesita que su lead llegue en el
// momento, no cuando el admin se acuerde. Las dos vías conviven: el push trae
// el caliente al instante, y el sync sigue sirviendo para recuperar lo que se
// haya perdido (bot caído, panel caído, tibios que maduraron).
async function ingresarLead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' })
  const b = req.body || {}
  if (!b.secret) return res.status(401).json({ error: 'Falta el secreto' })
  if (!b.empresa_id) return res.status(400).json({ error: 'Falta empresa_id' })
  if (!b.nombre && !b.telefono) {
    return res.status(400).json({ error: 'Falta nombre o teléfono' })
  }

  const pool = db()
  try {
    const { rows } = await pool.query(
      `select public.leadia_ingresar_lead($1,$2,$3,$4,$5,$6,$7,$8,$9) as r`,
      [
        b.secret,
        b.empresa_id,
        b.nombre || 'Contacto sin nombre',
        b.telefono || null,
        b.canal || 'whatsapp',
        b.resumen || null,
        b.sede_id || null,
        b.nivel || 'caliente',
        b.leadia_lead_id || null,
      ],
    )
    const r = rows[0]?.r
    // La RPC valida el secreto por dentro; si no cuadra, devuelve ok:false.
    if (!r?.ok) return res.status(403).json({ error: r?.error || 'Rechazado' })
    return res.status(200).json(r)
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo ingresar el lead: ' + e.message })
  }
}

// ── Link de pago para Finny ────────────────────────────────────────────────
// La llama el bot cuando el interesado dice que sí quiere matricularse. Como
// ingresar-lead, va sin JWT: se autentica con el secreto compartido.
//
// IDEMPOTENCIA: un lead + un plan = UN solo link vivo. Ingresar-lead
// duplicando una entrada al CRM solo molesta; aquí duplicar significa que
// alguien pague dos veces. Si el bot vuelve a pedirlo (reintento, ráfaga de
// mensajes, el cliente que dice "no me llegó"), se devuelve EL MISMO link.
async function linkPago(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' })
  const b = req.body || {}
  if (!b.secret) return res.status(401).json({ error: 'Falta el secreto' })
  if (!b.empresa_id || !b.plan_id) {
    return res.status(400).json({ error: 'Falta empresa_id o plan_id' })
  }

  const pool = db()
  try {
    // 1) ¿Puede cobrar este gym, existe el plan, cuánto sale? finny_preparar_cobro
    //    también avisa si hay una promo vigente que NO cambia el precio (2x1,
    //    grupal, semana gratis) para que el bot no invente un descuento.
    const { rows: pre } = await pool.query(
      `select public.finny_preparar_cobro($1,$2,$3,$4) as r`,
      [b.secret, b.empresa_id, b.plan_id, b.promocion_id || null],
    )
    const info = pre[0]?.r
    if (!info?.ok) return res.status(403).json({ error: info?.error || 'Rechazado' })
    if (!info.puede_cobrar) {
      // No es un error del bot: es que este gym no cobra por chat. Finny debe
      // caer al modo visita, así que se le dice explícitamente.
      return res.status(200).json({ ok: true, puede_cobrar: false, error: info.error })
    }

    // 2) ¿Ya hay un link vivo para este lead y plan? (idempotencia).
    //
    //    "Vivo" = el cobro sigue abierto (estado_pago 'pendiente') Y el link
    //    todavía es pagable según SU vencimiento real (init_point_vence_at, el
    //    que se le pidió a MercadoPago). Antes esto era `creado_at > now() -
    //    interval '1 hour'`, un plazo inventado aquí: como la preferencia de MP
    //    no caducaba, a las 11:05 se emitía un segundo link y los dos seguían
    //    cobrando — justo el doble cobro que la ventana pretendía evitar.
    //
    //    Este select es la ruta rápida (evita ir a crear-pago para nada); la
    //    garantía dura contra la ráfaga de mensajes NO está aquí, sino en el
    //    índice único de pago_app: dos peticiones simultáneas pasan las dos por
    //    este select antes de que ninguna haya insertado.
    if (b.leadia_lead_id) {
      const { rows: prev } = await pool.query(
        `select id, init_point, monto
           from public.pago_app
          where empresa_id = $1
            and finny_lead_id = $2
            and ref_id = $3
            and estado_pago = 'pendiente'
            and init_point is not null
            and (init_point_vence_at is null or init_point_vence_at > now())
          order by creado_at desc
          limit 1`,
        [b.empresa_id, b.leadia_lead_id, b.plan_id],
      )
      if (prev.length > 0) {
        return res.status(200).json({
          ok: true, puede_cobrar: true, ya_existia: true,
          link: prev[0].init_point,
          // El monto del cobro que ya existe, no lo que la RPC cotiza AHORA: el
          // link viejo va a cobrar su precio viejo aunque el plan haya subido.
          precio_final: Number(prev[0].monto),
          plan_nombre: info.plan_nombre,
          promo_nombre: info.promo_nombre || null,
          promo_sin_descuento_en_precio: info.promo_sin_descuento_en_precio || null,
        })
      }
    }

    // 3) Generar el link nuevo reusando el endpoint de pagos que ya existe.
    //    El secreto viaja: es lo que le da a crear-pago.js permiso para tratar
    //    ref_id como PLAN (el interesado todavía no es socio, no hay ninguna
    //    membresía que referenciar) y para aplicar la promoción. Sin secreto,
    //    ese endpoint no acepta ninguna palanca de descuento de quien llama —
    //    y no debe: es público (el POS del panel no manda JWT).
    //    El precio NO se manda: lo recalcula crear-pago.js con la MISMA RPC que
    //    se acaba de consultar arriba. El checkout nunca confía en un monto que
    //    le llegue por el cuerpo del request.
    // SELF_URL (no VERCEL_URL): esa var da la URL de ESTE deploy específico,
    // no el dominio estable — mismo criterio que usa el webhook para
    // dispararse a sí mismo (api/mp/webhook.js).
    const base = env('SELF_URL', 'https://fitcorecenter.com')
    const r = await fetch(`${base}/api/mp/crear-pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresa_id: b.empresa_id,
        sede_id: b.sede_id || null,
        tipo: 'membresia',
        ref_id: b.plan_id,
        promocion_id: b.promocion_id || null,
        finny_secret: b.secret,
        nuevo: { nombre: b.nombre || 'Interesado', telefono: b.telefono || null },
        canal: 'finny',
        finny_lead_id: b.leadia_lead_id || null,
      }),
    })
    const out = await r.json().catch(() => ({}))
    if (!r.ok || !out.init_point) {
      return res.status(400).json({ error: out.error || 'No se pudo generar el link' })
    }

    // El precio que se le informa al bot es el que quedó REALMENTE en el cobro,
    // leído de pago_app — no el `precio_final` que cotizó la RPC más arriba.
    // Son el mismo número mientras nada cambie entre las dos llamadas (misma
    // RPC), pero si algo cambia (el gym edita el plan o vence la promo justo en
    // el medio) manda lo que MercadoPago va a cobrar: que Finny diga una cifra
    // y el checkout muestre otra es la peor forma de enterarse.
    const { rows: cobro } = await pool.query(
      `select monto from public.pago_app where id = $1`, [out.pago_id])
    const montoReal = cobro[0]?.monto != null ? Number(cobro[0].monto) : info.precio_final

    return res.status(200).json({
      ok: true, puede_cobrar: true, ya_existia: !!out.ya_existia,
      link: out.init_point,
      precio_final: montoReal,
      plan_nombre: info.plan_nombre,
      promo_nombre: info.promo_nombre || null,
      promo_sin_descuento_en_precio: info.promo_sin_descuento_en_precio || null,
    })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo preparar el cobro: ' + e.message })
  }
}

// ── Evento asíncrono desde el motor de Finny (push) ────────────────────────
// El chat normal es síncrono: la app manda el mensaje por ?action=chat y la
// respuesta vuelve en el mismo request. Pero hay salientes que NO nacen de un
// request nuestro — el seguimiento que dispara el cron del motor, la
// reactivación de un tibio, el handoff cuando la IA se rinde y pide un humano.
// Hasta hoy esos mensajes MORÍAN EN SILENCIO: el motor los emitía y FitCore no
// tenía dónde recibirlos, así que el gimnasio nunca se enteraba de que su bot
// había escrito.
//
// Como ingresar-lead y link-pago: lo llama el motor, no un usuario → sin JWT,
// se autentica con el secreto compartido que valida la propia RPC.
//
// DEDUPE por `mensajeId`: el motor avisa que la respuesta síncrona de /api/chat
// puede traer el MISMO texto que el evento, y el id es lo que desempata. Lo
// resuelve un índice único en lead_tarea, no un select previo: dos entregas en
// paralelo (reintento del motor mientras la primera aún no commitea) pasarían
// las dos por cualquier chequeo optimista.
//
// CONTRATO: 2xx = entregado. Si respondemos error, el motor deja el mensaje
// 'fallido' de su lado. Por eso los casos que NO son culpa del motor (un evento
// de un contacto que nunca llegó a ser lead en el CRM) devuelven 200: un
// reintento no los va a arreglar, y marcarlos fallidos solo ensucia su panel.
async function evento(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' })
  const b = req.body || {}
  if (!b.secret) return res.status(401).json({ error: 'Falta el secreto' })
  if (!b.empresa_id) return res.status(400).json({ error: 'Falta empresa_id' })
  if (!b.tipo) return res.status(400).json({ error: 'Falta tipo' })

  const pool = db()
  try {
    const { rows } = await pool.query(
      `select public.finny_registrar_evento($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as r`,
      [
        b.secret,
        b.empresa_id,
        b.tipo,
        b.texto || null,
        b.origen || 'ia',
        b.mensajeId || null,
        b.leadId || null,
        b.sujeto || null,
        b.sede_id || null,
        b.nivelInteres || null,
        b.resumen || null,
      ],
    )
    const r = rows[0]?.r
    // La RPC valida el secreto por dentro; si no cuadra, devuelve ok:false.
    if (!r?.ok) return res.status(403).json({ error: r?.error || 'Rechazado' })
    return res.status(200).json(r)
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo registrar el evento: ' + e.message })
  }
}

// Config de plataforma (secretos): base de la API + admin key de Leadia +
// el secreto compartido. El ingestKey se trae acá porque el alta atómica
// (POST /ecosistema/gimnasios) tiene que ENTREGÁRSELO al tenant: es con ese
// secreto que el motor nos va a llamar de vuelta (ingresar-lead, link-pago y
// el nuevo action=evento). Antes solo lo leía `sync` con su propia consulta.
async function configLeadia(pool) {
  const { rows } = await pool.query(
    `select clave, valor from privado.secreto
      where clave in ('leadia_api_base','leadia_admin_key','leadia_ingest_key')`)
  const m = Object.fromEntries(rows.map((r) => [r.clave, r.valor]))
  return {
    base: m.leadia_api_base || 'https://api.leadai-pe.com',
    adminKey: m.leadia_admin_key,
    ingestKey: m.leadia_ingest_key,
  }
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

  const { base, adminKey, ingestKey } = await configLeadia(pool)
  if (!adminKey || adminKey.startsWith('CONFIGURAR')) {
    return res.status(400).json({ error: 'Leadia no está configurado en la plataforma (falta la admin key)' })
  }
  // Sin el secreto compartido el tenant nacería SORDO: podría contestar, pero no
  // tendría con qué llamarnos de vuelta (ingresar-lead, link-pago, evento).
  // Preferimos fallar acá antes que crear un tenant a medias en Leadia.
  if (!ingestKey) {
    return res.status(400).json({ error: 'Leadia no está configurado en la plataforma (falta la admin key)' })
  }

  // plan de Leadia según el tier del add-on
  // Mapeo tier de FitCore → plan de Leadia (confirmado por LeadAI 13-jul):
  // Básica→light, Pro→pro, Full→business. Ojo: NO es 1:1 con el nombre del tier.
  const planLeadia = { basica: 'light', pro: 'pro', full: 'business' }[tier]
  try {
    // 1) ALTA ATÓMICA del gimnasio: un solo request en vez de los 3 de antes
    //    (crear tenant → emitir api key → …).
    //
    //    POR QUÉ SE MIGRÓ (2026-08-28): el alta vieja creaba el tenant con
    //    `objetivo` vacío y SIN los campos fitcore*, que son justo los que
    //    ENCIENDEN el comportamiento del rubro gimnasio en el motor (escalera
    //    de precios de 3 peldaños, regla de salud, cierre de visita) y el
    //    puente de vuelta hacia acá. Resultado: todo ese comportamiento estaba
    //    construido y desplegado del lado de LeadAI, pero nunca se ejecutaba —
    //    se probó contra el tenant real y respondía por el pipeline genérico.
    //    Esta ruta setea objetivo='matricular_socio' + los 4 fitcore* de una.
    //
    //    fitcoreApiKey NO es la api key del tenant: es el secreto COMPARTIDO
    //    con el que el motor nos autentica cuando nos llama de vuelta. Es el
    //    mismo `leadia_ingest_key` que ya valida leadia_ingresar_lead.
    //
    //    fitcoreUrl tiene que ser una URL válida (el motor la valida con zod) y
    //    ser el dominio ESTABLE, no el del deploy: el motor la guarda y la usa
    //    meses después. Mismo criterio que link-pago con SELF_URL.
    const rT = await fetch(`${base}/ecosistema/gimnasios`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        nombre: `${info.empresa_nombre} · ${info.sede_nombre}`,
        plan: planLeadia,
        fitcoreUrl: env('SELF_URL', 'https://fitcorecenter.com'),
        fitcoreApiKey: ingestKey,
        fitcoreEmpresaId: info.empresa_id,
        fitcoreSedeId: sedeId,
        rubro: 'gimnasio',
      }),
    })
    // Se conserva el mismo texto de error que veía el panel: menciona /tenants
    // porque es lo que el admin ya conoce del mensaje anterior, y el status es
    // lo único accionable acá.
    if (!rT.ok) return res.status(400).json({ error: `Leadia /tenants respondió ${rT.status}` })
    const alta = await rT.json()
    // La ruta devuelve {tenantId, apiKey} — no {id}. La apiKey se muestra UNA
    // sola vez, así que de acá en adelante solo existe en `sede_leadia` cifrada.
    const tenantId = alta.tenantId
    const apiKey = alta.apiKey
    if (!tenantId || !apiKey) {
      return res.status(400).json({ error: 'Leadia /tenants respondió sin tenant o sin api key' })
    }

    // 2) crear el flujo plantilla del gym con la api key recién emitida.
    //
    //    POR QUÉ SE MANTIENE aunque el alta nueva no lo cree: el flujo y el
    //    comportamiento del rubro son dos cosas distintas y conviven. El rubro
    //    (objetivo=matricular_socio) es lo que la IA hace cuando conversa; el
    //    flujo es el árbol determinista de la ANTESALA — el saludo, el menú de
    //    "Precios / Horarios / Quiero inscribirme" y la rama que decide cuándo
    //    entra la IA. Además el panel lo depende de forma dura: la pestaña
    //    "🌳 Ajustar el flujo del bot" (src/pages/config/TabLeadia.jsx) lo lista
    //    con ?action=estado y lo edita con ?action=guardar-flujo. Borrarlo acá
    //    dejaría esa pantalla vacía con el cartel "Esta sede aún no tiene un
    //    flujo". Sigue siendo best-effort: si falla, el gym lo crea después.
    let flujoId = null
    try {
      const rF = await fetch(`${base}/flujos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ nombre: 'Flujo del gimnasio', grafo: FLUJO_PLANTILLA_GYM }),
      })
      if (rF.ok) { const f = await rF.json(); flujoId = f.id || null }
    } catch { /* el flujo se puede crear después desde el panel */ }

    // 3) guardar credenciales cifradas + marcar el tier en la suscripción.
    //    set_leadia_tier se queda: es el enlace con el cobro del add-on.
    await pool.query('select public.guardar_leadia_credenciales($1,$2,$3,$4,$5)',
      [sedeId, info.empresa_id, tenantId, apiKey, flujoId])
    await pool.query('select public.set_leadia_tier($1,$2)', [sedeId, tier])

    return res.status(200).json({ ok: true, tenant_id: tenantId, flujo_id: flujoId, tier })
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

// ── CANALES: conectar las redes del gimnasio a Finny ────────────────────────
//
// POR QUÉ ESTE PROXY EXISTE (2026-09-02).
//
// Finny estaba construido y desplegado pero NO podía atender a nadie: el panel
// hablaba de "un asistente que atiende tu WhatsApp 24/7" y no tenía un solo
// botón para conectarlo. El motor (LeadAI) sí expone /canales completo — OAuth,
// Embedded Signup de Meta, elección de cuenta — pero FitCore nunca construyó el
// puente. Por eso la pestaña vivía detrás de LEADIA_VISIBLE=false.
//
// LA REGLA DE ORO: la api key del tenant NO baja al navegador. Vive cifrada en
// sede_leadia y solo se descifra acá (leadia_credenciales), igual que en
// `estado` y `guardar-flujo`. Un canal conectado es el buzón por donde entran
// los clientes del gimnasio: con esa key en el front, cualquiera con la consola
// abierta podría leer conversaciones o desconectar el número.
//
// Todas las sub-acciones exigen ser ADMIN DE ESA SEDE (adminYSede), no solo
// estar logueado: conectar/desconectar un canal es una operación de dueño.

// Las redes que el motor sabe conectar. Se valida contra esta lista antes de
// interpolar el tipo en la URL del motor.
const TIPOS_CANAL = ['whatsapp', 'instagram', 'messenger', 'tiktok']

// Forma de un uuid. Se valida ANTES de tocar la BD: `sede.id` es uuid y un
// valor malformado revienta en Postgres fuera del try, devolviendo un 500 crudo
// donde correspondía un 400.
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function canales(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const sedeId = (req.query?.sedeId || req.body?.sedeId || '').toString()
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' })
  if (!ES_UUID.test(sedeId)) return res.status(400).json({ error: 'sedeId inválido' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  // Sin add-on no hay tenant al que conectarle nada. 200 y no 400: el panel
  // muestra "activa Finny primero", que es información, no un error del usuario.
  if (!cred?.encontrado) return res.status(200).json({ activo: false, canales: [] })

  const { base } = await configLeadia(pool)
  const auth = { authorization: `Bearer ${cred.api_key}` }
  const op = (req.query?.op || 'listar').toString()

  try {
    // ── Listar lo conectado ──
    if (op === 'listar') {
      const r = await fetch(`${base}/canales`, { headers: auth })
      if (!r.ok) return res.status(200).json({ activo: true, canales: [] })
      return res.status(200).json({ activo: true, canales: await r.json() })
    }

    // ── De qué origen viene el aviso del popup de OAuth ──
    // El panel necesita saberlo para validar el postMessage: el mensaje lo emite
    // la página de callback del motor, y sin este dato tendría que confiar en
    // cualquiera. Se devuelve solo el ORIGEN (esquema+host), nunca la key.
    if (op === 'origen') {
      try {
        return res.status(200).json({ origen: new URL(base).origin })
      } catch {
        return res.status(200).json({ origen: null })
      }
    }

    // ── URL de autorización OAuth (Instagram/Messenger/TikTok) ──
    if (op === 'oauth-url') {
      const tipo = (req.query?.tipo || '').toString()
      if (!TIPOS_CANAL.includes(tipo)) return res.status(400).json({ error: 'Red no válida' })
      const r = await fetch(`${base}/canales/${tipo}/oauth/url`, { headers: auth })
      if (!r.ok) return res.status(502).json({ error: 'El motor no devolvió la URL' })
      return res.status(200).json(await r.json())
    }

    // ── Cuentas que autorizó y aún no eligió ──
    // Meta devuelve TODAS las páginas que administra; con más de una el motor no
    // guarda ninguna y las deja pendientes 10 minutos. Sin esta rama el usuario
    // ve que "no pasó nada" tras autorizar (el hueco que hoy tiene el panel de
    // Sania, según la exploración del 2026-09-02).
    if (op === 'pendientes') {
      const tipo = (req.query?.tipo || '').toString()
      if (!TIPOS_CANAL.includes(tipo)) return res.status(400).json({ error: 'Red no válida' })
      const r = await fetch(`${base}/canales/${tipo}/pendientes`, { headers: auth })
      if (!r.ok) return res.status(200).json({ cuentas: [] })
      return res.status(200).json(await r.json())
    }

    // ── De aquí abajo todo MODIFICA: solo POST ──
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

    // ── Conectar LA cuenta que eligió ──
    if (op === 'elegir') {
      const tipo = (req.body?.tipo || '').toString()
      const cuentaExterna = (req.body?.cuentaExterna || '').toString()
      if (!TIPOS_CANAL.includes(tipo)) return res.status(400).json({ error: 'Red no válida' })
      if (!cuentaExterna) return res.status(400).json({ error: 'Falta la cuenta' })
      const r = await fetch(`${base}/canales/${tipo}/elegir`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ cuentaExterna }),
      })
      // El 410 del motor ("se venció el tiempo para elegir") se pasa TAL CUAL:
      // el panel lo distingue para decir "vuelve a conectar la red".
      const cuerpo = await r.json().catch(() => ({}))
      return res.status(r.status).json(cuerpo)
    }

    // ── WhatsApp por Embedded Signup ──
    // El popup de Meta devuelve un `code`; el canje lo hace el MOTOR (es quien
    // tiene el APP_SECRET). `redirectUri` viaja porque Meta exige al canjear el
    // mismo valor que generó el SDK, y es dinámico — si no cuadra, error 100.
    if (op === 'whatsapp-embedded') {
      const { code, wabaId, phoneNumberId, redirectUri, featureType } = req.body || {}
      if (!code) return res.status(400).json({ error: 'Falta el code de Meta' })
      const r = await fetch(`${base}/canales/whatsapp/embedded-signup`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ code, wabaId, phoneNumberId, redirectUri, featureType }),
      })
      const cuerpo = await r.json().catch(() => ({}))
      return res.status(r.status).json(cuerpo)
    }

    // ── Encender/apagar o renombrar ──
    if (op === 'actualizar') {
      const id = (req.body?.id || '').toString()
      if (!id) return res.status(400).json({ error: 'Falta el canal' })
      const cambios = {}
      if (typeof req.body?.activo === 'boolean') cambios.activo = req.body.activo
      if (typeof req.body?.nombre === 'string') cambios.nombre = req.body.nombre
      if (!Object.keys(cambios).length) return res.status(400).json({ error: 'Nada que cambiar' })
      const r = await fetch(`${base}/canales/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify(cambios),
      })
      const cuerpo = await r.json().catch(() => ({}))
      return res.status(r.status).json(cuerpo)
    }

    // ── Desconectar ──
    if (op === 'eliminar') {
      const id = (req.body?.id || '').toString()
      if (!id) return res.status(400).json({ error: 'Falta el canal' })
      const r = await fetch(`${base}/canales/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: auth,
      })
      if (!r.ok) return res.status(r.status).json({ error: 'No se pudo desconectar' })
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Operación no reconocida' })
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo hablar con el motor: ' + e.message })
  }
}

// ── BANDEJA: ver y responder las conversaciones de Finny ───────────────────
//
// POR QUÉ (2026-09-02).
//
// Finny quedó atendiendo el WhatsApp del gimnasio y el gym NO tenía dónde ver
// esas conversaciones. Un bot que habla con tus clientes sin que puedas leer lo
// que dice — ni meter mano cuando hace falta — es una caja negra: la primera
// vez que un interesado pregunte algo raro, el dueño se entera cuando ya perdió
// la venta.
//
// Mismo patrón de seguridad que el resto del proxy: ADMIN DE ESA SEDE y la api
// key se descifra en el servidor (leadia_credenciales), nunca baja al navegador.
async function bandeja(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const sedeId = (req.query?.sedeId || req.body?.sedeId || '').toString()
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' })
  if (!ES_UUID.test(sedeId)) return res.status(400).json({ error: 'sedeId inválido' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  if (!cred?.encontrado) return res.status(200).json({ activo: false, items: [] })

  const { base } = await configLeadia(pool)
  const auth = { authorization: `Bearer ${cred.api_key}` }
  const op = (req.query?.op || 'listar').toString()

  try {
    // ── Lista de conversaciones ──
    if (op === 'listar') {
      const q = new URLSearchParams({ limit: '30' })
      const nivel = (req.query?.nivel || '').toString()
      const estado = (req.query?.estado || '').toString()
      const cursor = (req.query?.cursor || '').toString()
      if (['frio', 'tibio', 'caliente'].includes(nivel)) q.set('nivel', nivel)
      if (estado) q.set('estado', estado)
      if (cursor) q.set('cursor', cursor)

      const r = await fetch(`${base}/leads?${q}`, { headers: auth })
      if (!r.ok) return res.status(200).json({ activo: true, items: [] })
      const out = await r.json()
      return res.status(200).json({ activo: true, ...out })
    }

    // ── Un hilo con todos sus mensajes ──
    if (op === 'hilo') {
      const id = (req.query?.id || '').toString()
      if (!id) return res.status(400).json({ error: 'Falta la conversación' })
      const r = await fetch(`${base}/leads/${encodeURIComponent(id)}`, { headers: auth })
      if (r.status === 404) return res.status(404).json({ error: 'Conversación no encontrada' })
      if (!r.ok) return res.status(502).json({ error: 'El motor no devolvió el hilo' })
      return res.status(200).json(await r.json())
    }

    // ── De aquí abajo todo MODIFICA: solo POST ──
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

    // ── Responder a mano ──
    // Por defecto PAUSA el bot de esa conversación: si una persona entró a
    // hablar, que la IA no le pise la respuesta a mitad de frase.
    if (op === 'responder') {
      const sujeto = (req.body?.sujeto || '').toString()
      const mensaje = (req.body?.mensaje || '').toString().trim()
      if (!sujeto) return res.status(400).json({ error: 'Falta el contacto' })
      if (!mensaje) return res.status(400).json({ error: 'El mensaje está vacío' })
      const r = await fetch(`${base}/api/chat/humano`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          sujeto,
          mensaje,
          // Quién contestó, para que el hilo no diga solo "humano". Sale del
          // JWT de Supabase (user_metadata), no de nuestra tabla.
          nombre: user.user_metadata?.full_name || user.user_metadata?.name || undefined,
          // Explícito aunque sea el default del motor: que se lea en el código
          // de qué lado está la decisión.
          pausarBot: req.body?.pausarBot !== false,
        }),
      })
      const cuerpo = await r.json().catch(() => ({}))
      return res.status(r.status).json(cuerpo)
    }

    // ── Encender/pausar el bot en UNA conversación ──
    if (op === 'bot') {
      const sujeto = (req.body?.sujeto || '').toString()
      if (!sujeto) return res.status(400).json({ error: 'Falta el contacto' })
      if (typeof req.body?.pausado !== 'boolean') {
        return res.status(400).json({ error: 'Falta indicar si se pausa' })
      }
      const r = await fetch(`${base}/api/chat/bot`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ sujeto, pausado: req.body.pausado }),
      })
      const cuerpo = await r.json().catch(() => ({}))
      return res.status(r.status).json(cuerpo)
    }

    return res.status(400).json({ error: 'Operación no reconocida' })
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo hablar con el motor: ' + e.message })
  }
}

// ── CAMPAÑAS: escribirle a toda la base de una vez ─────────────────────────
//
// POR QUÉ (2026-09-02).
//
// El gimnasio ya tenía un botón "Campañas" DESHABILITADO desde julio, esperando
// que el dueño decidiera "correo gratis vs WhatsApp API (~S/0.25/msj)". La
// decisión resultó ser una falsa disyuntiva: el mensaje de WhatsApp **se lo
// cobra Meta a la tarjeta del gimnasio**, no a FitCore. Ofrecerlo no nos cuesta
// nada, y para un gym es la venta más barata que existe — escribirle al que ya
// fue socio y dejó de venir.
//
// Mismo patrón de seguridad que `canales` y `bandeja`: ADMIN DE ESA SEDE, y la
// api key del tenant se descifra en el servidor.
//
// OJO con el 402: el motor corta con `requiereMarketing` si el plan del tenant
// no incluye marketing. Ese código se pasa TAL CUAL al panel para que muestre
// "tu plan no incluye campañas" en vez de un error genérico.
async function campanias(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const sedeId = (req.query?.sedeId || req.body?.sedeId || '').toString()
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' })
  if (!ES_UUID.test(sedeId)) return res.status(400).json({ error: 'sedeId inválido' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  const { rows } = await pool.query('select public.leadia_credenciales($1) as c', [sedeId])
  const cred = rows[0].c
  if (!cred?.encontrado) return res.status(200).json({ activo: false, items: [] })

  const { base } = await configLeadia(pool)
  const auth = { authorization: `Bearer ${cred.api_key}` }
  const op = (req.query?.op || 'listar').toString()

  // Reenvía al motor y devuelve su cuerpo y su código tal cual. Los 402
  // (plan sin marketing, cupo excedido) y 409 (sin WhatsApp conectado) llevan
  // información que el panel necesita para explicar qué hacer.
  const pasar = async (ruta, init) => {
    const r = await fetch(`${base}${ruta}`, init)
    const cuerpo = await r.json().catch(() => ({}))
    return res.status(r.status).json(cuerpo)
  }

  try {
    // ── Lecturas ──
    if (op === 'listar') {
      const r = await fetch(`${base}/campanias`, { headers: auth })
      if (!r.ok) return res.status(r.status).json(await r.json().catch(() => ({ items: [] })))
      return res.status(200).json({ activo: true, ...(await r.json()) })
    }

    if (op === 'plantillas') {
      return pasar('/campanias/plantillas', { headers: auth })
    }

    // Cupo del mes y si la WABA tiene tarjeta registrada en Meta. Van juntos
    // porque el panel los muestra en la misma fila y sin ellos no puede decir
    // ni cuántos envíos quedan ni por qué fallarían.
    if (op === 'estado') {
      const [cupoR, pagoR] = await Promise.all([
        fetch(`${base}/campanias/cupo`, { headers: auth }),
        fetch(`${base}/campanias/estado-pago`, { headers: auth }),
      ])
      const cupo = cupoR.ok ? await cupoR.json().catch(() => null) : null
      const pago = pagoR.ok ? await pagoR.json().catch(() => null) : null
      // Si el motor corta por plan, se dice: el panel muestra el candado.
      if (cupoR.status === 402) {
        return res.status(200).json({ activo: true, sinMarketing: true, cupo: null, pago: null })
      }
      return res.status(200).json({ activo: true, cupo, pago })
    }

    if (op === 'detalle') {
      const id = (req.query?.id || '').toString()
      if (!id) return res.status(400).json({ error: 'Falta la campaña' })
      return pasar(`/campanias/${encodeURIComponent(id)}`, { headers: auth })
    }

    // ── De aquí abajo todo MODIFICA: solo POST ──
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })

    // ── Crear plantilla (la aprueba Meta, no nosotros) ──
    if (op === 'crear-plantilla') {
      const { nombre, categoria, cuerpo, encabezado } = req.body || {}
      if (!nombre || !cuerpo) return res.status(400).json({ error: 'Falta el nombre o el mensaje' })
      if (!['MARKETING', 'UTILITY'].includes(categoria)) {
        return res.status(400).json({ error: 'Tipo de plantilla no válido' })
      }
      return pasar('/campanias/plantillas', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ nombre, categoria, cuerpo, idioma: 'es', encabezado }),
      })
    }

    if (op === 'borrar-plantilla') {
      const nombre = (req.body?.nombre || '').toString()
      if (!nombre) return res.status(400).json({ error: 'Falta la plantilla' })
      const r = await fetch(`${base}/campanias/plantillas/${encodeURIComponent(nombre)}`, {
        method: 'DELETE', headers: auth,
      })
      if (r.status === 204) return res.status(200).json({ ok: true })
      return res.status(r.status).json(await r.json().catch(() => ({ error: 'No se pudo borrar' })))
    }

    // ── Lanzar la campaña ──
    if (op === 'crear') {
      const { nombre, plantillaNombre, cuerpoVista, contactos, programadaPara, encabezado } = req.body || {}
      if (!nombre || !plantillaNombre) {
        return res.status(400).json({ error: 'Falta el nombre o la plantilla' })
      }
      if (!Array.isArray(contactos) || contactos.length === 0) {
        return res.status(400).json({ error: 'No hay destinatarios' })
      }
      return pasar('/campanias', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({
          nombre, plantillaNombre, cuerpoVista, contactos, encabezado,
          plantillaIdioma: 'es',
          ...(programadaPara ? { programadaPara } : {}),
        }),
      })
    }

    if (op === 'pausar' || op === 'reanudar') {
      const id = (req.body?.id || '').toString()
      if (!id) return res.status(400).json({ error: 'Falta la campaña' })
      return pasar(`/campanias/${encodeURIComponent(id)}/${op}`, { method: 'POST', headers: auth })
    }

    return res.status(400).json({ error: 'Operación no reconocida' })
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo hablar con el motor: ' + e.message })
  }
}

// ── Destinatarios: los socios del gym, ya segmentados ──────────────────────
//
// La diferencia con LeadAI: allá se pegan teléfonos a mano en un textarea. Acá
// el gimnasio YA tiene su base — y los segmentos que de verdad importan (el que
// se le venció, el que está por vencer, el que se dio de baja) salen de la
// misma tabla que usa el resto del panel. Pedirle al dueño que copie teléfonos
// de una pantalla a otra sería absurdo.
async function campaniaDestinatarios(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user) return res.status(401).json({ error: 'No autenticado' })

  const sedeId = (req.query?.sedeId || '').toString()
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' })
  if (!ES_UUID.test(sedeId)) return res.status(400).json({ error: 'sedeId inválido' })

  const segmento = (req.query?.segmento || '').toString()
  const SEGMENTOS = ['vencidos', 'por_vencer', 'activos', 'de_baja']
  if (!SEGMENTOS.includes(segmento)) return res.status(400).json({ error: 'Segmento no válido' })

  const pool = db()
  const info = await adminYSede(pool, user, sedeId)
  if (!info) return res.status(403).json({ error: 'Solo el administrador de esa sede' })

  // Un solo query por segmento, siempre acotado a la sede y con teléfono real:
  // un contacto sin número no es un destinatario, es un envío que va a fallar
  // y a gastar el cupo igual.
  const COMUN = `
    from public.socio s
    where s.empresa_id = $1 and s.sede_id = $2 and s.deleted_at is null
      and s.telefono is not null and length(trim(s.telefono)) >= 6`

  const SQL = {
    // Se le venció y no renovó: el que más rinde de todos.
    vencidos: `select s.nombre, s.telefono ${COMUN}
      and exists (select 1 from public.membresia m where m.socio_id = s.id and m.deleted_at is null)
      and not exists (select 1 from public.membresia m2 where m2.socio_id = s.id
                        and m2.deleted_at is null and m2.fecha_fin >= current_date)`,
    // Le quedan 7 días o menos: atajarlo ANTES de que se caiga.
    por_vencer: `select distinct s.nombre, s.telefono ${COMUN}
      and exists (select 1 from public.membresia m where m.socio_id = s.id and m.deleted_at is null
                    and m.fecha_fin between current_date and current_date + 7)`,
    activos: `select distinct s.nombre, s.telefono ${COMUN}
      and exists (select 1 from public.membresia m where m.socio_id = s.id and m.deleted_at is null
                    and m.fecha_fin >= current_date)`,
    // Nunca tuvo membresía: se registró y no llegó a comprar.
    de_baja: `select s.nombre, s.telefono ${COMUN}
      and not exists (select 1 from public.membresia m where m.socio_id = s.id and m.deleted_at is null)`,
  }

  try {
    const { rows: dest } = await pool.query(
      `${SQL[segmento]} order by 1 limit 500`,
      [info.empresa_id, sedeId],
    )
    return res.status(200).json({
      segmento,
      total: dest.length,
      contactos: dest.map((d) => ({ telefono: d.telefono, nombre: d.nombre })),
    })
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo armar la lista: ' + e.message })
  }
}
