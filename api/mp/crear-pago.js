// POST /api/mp/crear-pago — el socio (desde la app) paga una membresía, un
// producto, o un CARRITO de productos. Crea una preferencia de Checkout Pro con
// marketplace_fee (5% para FitCore) usando el access_token DEL GYM. Devuelve
// init_point para la app. PEDIDO 15 Fase 1 + carrito.
//
// Body (membresía):  { empresa_id, tipo:'membresia', ref_id, socio_id?, sede_id?,
//                      fecha_inicio?, nuevo?:{nombre,documento,email,telefono} }
// Body (1 producto): { empresa_id, tipo:'producto', ref_id, socio_id?, sede_id?, nuevo? }
// Body (carrito):    { empresa_id, tipo:'producto', items:[{producto_id, cantidad}],
//                      socio_id?, sede_id?, nuevo? }
import crypto from 'node:crypto'
import { env, db, usuarioDesdeJwt } from '../_lib/db.js'

// 5% de FitCore, calculado sobre el monto BRUTO de la venta.
// Cómo reparte MP: primero descuenta SU comisión del total, y nuestro
// application_fee sale del saldo que le queda al gym. O sea el gym recibe
// (monto − comisión MP − nuestro 5%). En tickets chicos (S/30) esa doble
// comisión se siente, así que si algún día se quiere cobrar sobre el neto,
// este es el punto a cambiar.
const COMISION = 0.05

// PEDIDO 23: precio efectivo con la oferta permanente del producto (si hay).
// Misma lógica que el CASE de la RPC catalogo_app — el backend es quien decide
// el monto, nunca el cliente.
function precioEfectivo(precio, tipo, valor) {
  const p = Number(precio); const v = Number(valor)
  if (tipo === 'porcentaje' && v > 0) return Math.round(p * (1 - v / 100) * 100) / 100
  if (tipo === 'monto' && v > 0) return Math.max(0, Math.round((p - v) * 100) / 100)
  return p
}

// oauth-start consolidado aquí (?action=oauth-start) para respetar el límite de
// 12 funciones serverless de Vercel Hobby. Devuelve la URL de autorización de MP.
async function oauthStart(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user?.id) return res.status(401).json({ error: 'No autenticado' })
  const { rows } = await db().query(
    `select ue.empresa_id from public.usuario_empresa ue
       join public.rol r on r.id = ue.rol_id
      where ue.usuario_id = $1 and ue.activo and r.codigo = 'admin'
      order by ue.es_default desc, ue.created_at asc limit 1`, [user.id])
  const empresaId = rows[0]?.empresa_id
  if (!empresaId) return res.status(403).json({ error: 'Solo el administrador puede conectar los cobros' })
  const authUrl = new URL('https://auth.mercadopago.com/authorization')
  authUrl.searchParams.set('client_id', env('MP_CLIENT_ID'))
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('platform_id', 'mp')
  authUrl.searchParams.set('redirect_uri', env('MP_REDIRECT_URI'))
  authUrl.searchParams.set('state', empresaId)
  res.setHeader('Cache-Control', 'no-store')
  return res.status(200).json({ url: authUrl.toString() })
}

// ── Yape directo (PEDIDO 49) ────────────────────────────────────────────────
// La app tokeniza el Yape del socio contra MP (celular + OTP, endpoint REST, sin
// SDK ni WebView) y nos manda ese token junto al pago_app ya creado por
// crear-pago. Aquí se cobra server-side con el access_token DEL GYM y el mismo
// split del 5% para FitCore.
//
// Se consolida como ?action=pagar-yape en vez de un archivo nuevo porque Vercel
// Hobby está en el tope de 12 funciones serverless (mismo patrón que oauth-start).
//
// El resultado es SÍNCRONO: Yape es débito inmediato, solo devuelve approved o
// rejected (nunca pending), así que la app muestra el resultado al instante sin
// polling. El webhook sigue existiendo como respaldo/conciliación — y como es
// idempotente, que llegue después no duplica nada.
//
// ⚠️ ESTADO (2026-07-21): este endpoint queda DESACTIVADO por decisión de negocio.
// MP no permite el split de marketplace con Yape por Checkout API (error 2059), así
// que cobrar por aquí significaría que FitCore NO se lleva su 5% — el dinero iría
// entero al gym. Como el **Checkout Pro sí aplica el split** y ahí Yape está
// disponible igual, el flujo correcto para Yape es el `init_point` de crear-pago.
//
// Se conserva el código (no se borra) porque la tokenización de la app ya funciona:
// si MP habilita el split en Checkout API, se reactiva quitando el 501 y devolviendo
// el application_fee.
//
// Body: { token, pago_id }
async function pagarYape(req, res) {
  // Falla explícita y temprana: mejor un mensaje claro que un cobro sin comisión.
  // (El resto del cuerpo se conserva a propósito para reactivarlo sin reescribirlo.)
  if (env('MP_YAPE_DIRECTO') !== '1') {
    return res.status(501).json({
      error: 'El pago con Yape directo no está disponible; usa el checkout de MercadoPago.',
      motivo: 'mp_no_permite_split_con_yape',
    })
  }
  const { token, pago_id } = req.body || {}
  if (!token || !pago_id) return res.status(400).json({ error: 'Faltan datos del pago' })

  // El socio debe estar autenticado y el pago tiene que ser SUYO. Sin esto,
  // cualquiera con un pago_id podría (a) sondear el estado de pagos ajenos y
  // (b) pagar la orden de otro con su propio Yape: se cobra él, pero el
  // beneficio (renovar membresía, reservar stock) se activa en la orden de la
  // víctima. Mismo criterio que pagar-factura en api/culqi.
  const user = await usuarioDesdeJwt(req)
  if (!user?.id) return res.status(401).json({ error: 'No autenticado' })

  try {
    // 1) El pago debe existir, ser del usuario y estar pendiente. El monto/fee
    //    salen de la BD, NUNCA del cliente (mismo criterio que crear-pago).
    //    Un pago sin socio_id (alta de socio nuevo desde la app) se valida por
    //    el usuario que lo creó vía su socio en esa misma empresa.
    const { rows } = await db().query(
      `select p.id, p.empresa_id, p.monto, p.comision_fitcore, p.concepto, p.estado_pago,
              p.nuevo_email, s.email as socio_email
         from public.pago_app p
         left join public.socio s on s.id = p.socio_id
        where p.id = $1
          and (
            -- pago de un socio: tiene que ser el socio del usuario autenticado
            (p.socio_id is not null and s.usuario_id = $2)
            -- alta de socio nuevo (aún sin socio_id): el usuario debe tener un
            -- socio en esa misma empresa (es quien está haciendo la compra)
            or (p.socio_id is null and exists (
                  select 1 from public.socio s2
                   where s2.usuario_id = $2 and s2.empresa_id = p.empresa_id
                     and s2.deleted_at is null))
          )`,
      [pago_id, user.id])
    const pago = rows[0]
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' })
    if (pago.estado_pago === 'aprobado') {
      return res.status(200).json({ estado: 'aprobado', ya_pagado: true })
    }
    if (pago.estado_pago === 'cancelado') {
      return res.status(409).json({ error: 'Este cobro fue cancelado' })
    }

    // 2) Token del gym que cobra (el pago va a SU cuenta, con nuestro fee).
    const { rows: mpRows } = await db().query(
      `select access_token from public.empresa_mp where empresa_id = $1`, [pago.empresa_id])
    const gym = mpRows[0]
    if (!gym) return res.status(400).json({ error: 'Este gimnasio aún no habilitó los pagos en línea' })

    // MP exige un email de pagador; si el socio no tiene, uno neutro del gym.
    const email = pago.socio_email || pago.nuevo_email || `socio+${pago.id}@fitcore.pe`

    // 3) Cobro con Yape. La idempotencia se ata al PAGO **y AL TOKEN**: así un
    //    reintento por timeout de red (mismo token, mismo body) no cobra dos
    //    veces, y un reintento legítimo tras un rechazo (OTP mal, saldo) llega
    //    con un token nuevo → clave nueva → sí se procesa.
    //
    //    OJO: MP NO hace "replay" de la respuesta cacheada. Si se reusa la misma
    //    clave con un body distinto responde **422 'Idempotency key already
    //    used'** (ventana de 24h). Por eso la clave NO puede depender solo del
    //    pago_id: tras un rechazo, el socio quedaría 24h sin poder pagar y se
    //    vería como una caída del sistema.
    //    Doc: developers/pt/docs/wallet-connect/payment-flow/idempotency/responses
    const claveIdem = `yape-${pago.id}-${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16)}`
    const r = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${gym.access_token}`,
        'content-type': 'application/json',
        'X-Idempotency-Key': claveIdem,
      },
      body: JSON.stringify({
        token,
        transaction_amount: Number(pago.monto),
        installments: 1,
        payment_method_id: 'yape',
        description: pago.concepto || 'Pago FitCore',
        external_reference: pago.id,          // para casar el webhook
        // ⚠️ SIN application_fee A PROPÓSITO. Confirmado en prueba real (2026-07-21):
        // MP RECHAZA el split en Yape por Checkout API →
        //   2059 "You cannot use application_fee with this payment."
        // (mismo código que usa para "el token no es de OAuth", pero aquí el token
        // SÍ era de OAuth: Yape simplemente no admite split por esta vía).
        //
        // Dónde SÍ se cobra el 5%: en el **Checkout Pro**, vía `marketplace_fee` en
        // la preferencia (ver crear-pago más abajo). Verificado sobre pagos reales:
        // en el pago 167400024025 MP descontó `application_fee=1.25` de S/25.
        // Por eso el flujo recomendado para Yape es el checkout, no este endpoint.
        // Explícito, igual que en la preferencia de crear-pago: la ACTIVACIÓN
        // (renovar membresía / descontar stock / emitir comprobante) la hace el
        // webhook. Sin esto dependeríamos de la config del dashboard de MP y un
        // socio podría pagar y quedarse sin su beneficio.
        // MP documenta que gana la del pago: "Las URLs configuradas durante la
        // creación de un pago tendrán prioridad por sobre aquellas configuradas
        // a través de Tus integraciones".
        notification_url: `${env('PANEL_URL')}/api/mp/webhook`,
        payer: { email },
      }),
    })
    const data = await r.json().catch(() => ({}))

    if (!r.ok) {
      // El detalle de MP queda en el log, no en la respuesta: es diagnóstico de
      // integración (token inválido, permisos de la cuenta) y no le sirve al socio.
      console.error('mp pagar-yape error', data)
      return res.status(400).json({ error: 'No se pudo procesar el pago con Yape' })
    }

    const aprobado = data.status === 'approved'
    // 4) Guardamos el resultado. Si fue aprobado NO activamos aquí (renovar
    //    membresía / descontar stock / emitir comprobante): de eso ya se encarga
    //    el webhook, que es idempotente y la única fuente de esa lógica. Así no
    //    hay dos caminos que puedan divergir.
    //
    //    El guard es POSITIVO (solo 'pendiente'): si entre el SELECT y este
    //    UPDATE recepción canceló el cobro, no lo pisamos. 'cancelado' existe
    //    justo para suprimir la activación — sobrescribirlo la reactivaría.
    const { rowCount } = await db().query(
      `update public.pago_app
          set estado_pago = $1, mp_payment_id = $2, pagado_at = now()
        where id = $3 and estado_pago = 'pendiente'`,
      [aprobado ? 'aprobado' : 'rechazado', String(data.id), pago.id])

    if (rowCount === 0 && aprobado) {
      // Se canceló mientras cobrábamos y el socio YA pagó: dejamos rastro y
      // avisamos al gym para que reembolse (mismo criterio que el webhook).
      await db().query(
        `update public.pago_app set mp_payment_id = $1, pagado_at = now() where id = $2`,
        [String(data.id), pago.id])
      await db().query(
        `insert into public.notificacion
           (empresa_id, sede_id, tipo, titulo, subtitulo, nivel, ref_tipo, ref_id)
         select $1, sede_id, 'pago_cancelado_pagado', '⚠️ Pago recibido de un cobro cancelado',
                'Se recibió S/' || monto || ' por Yape de un cobro que ya estaba cancelado — reembolsar en MercadoPago',
                'warning', 'pago_app', id
           from public.pago_app where id = $2`,
        [pago.empresa_id, pago.id])
      return res.status(409).json({ error: 'El cobro fue cancelado; el pago será reembolsado' })
    }

    return res.status(200).json({
      estado: aprobado ? 'aprobado' : 'rechazado',
      mp_payment_id: data.id,
      status_detail: data.status_detail || null,
    })
  } catch (e) {
    console.error('mp pagar-yape', e)
    return res.status(500).json({ error: 'Error al procesar el pago' })
  }
}

export default async function handler(req, res) {
  if ((req.query?.action || '') === 'oauth-start') return oauthStart(req, res)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' })
  if ((req.query?.action || '') === 'pagar-yape') return pagarYape(req, res)
  const { empresa_id, tipo, ref_id, items, socio_id, sede_id, fecha_inicio, nuevo, canal } = req.body || {}
  const canalPago = ['app', 'mostrador'].includes(canal) ? canal : 'app'
  if (!empresa_id || !tipo) return res.status(400).json({ error: 'Faltan datos del pago' })
  if (!['membresia', 'producto'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' })

  // Un pago de producto trae ref_id (1 producto) o items[] (carrito).
  const esCarrito = Array.isArray(items) && items.length > 0
  if (tipo === 'producto' && !ref_id && !esCarrito) {
    return res.status(400).json({ error: 'No hay productos en el carrito' })
  }
  if (tipo === 'membresia' && !ref_id) {
    return res.status(400).json({ error: 'Falta la membresía' })
  }

  try {
    // 1) token del gym (debe tener cobros habilitados)
    const { rows: mpRows } = await db().query(
      `select access_token from public.empresa_mp where empresa_id = $1`, [empresa_id])
    const gym = mpRows[0]
    if (!gym) return res.status(400).json({ error: 'Este gimnasio aún no habilitó los pagos en línea' })

    // 2) monto REAL desde el servidor (nunca del cliente).
    //    mpItems = las líneas que verá el socio en el checkout de MP.
    //    carrito = las líneas que persistimos en pago_app_item.
    let monto, concepto, mpItems = [], carrito = []

    if (tipo === 'membresia') {
      const { rows } = await db().query(
        `select p.precio, p.nombre from public.membresia m
           join public.plan p on p.id = m.plan_id
          where m.id = $1 and m.empresa_id = $2 and m.deleted_at is null`,
        [ref_id, empresa_id])
      if (!rows[0]) return res.status(400).json({ error: 'Membresía no válida' })
      monto = Number(rows[0].precio); concepto = 'Plan ' + rows[0].nombre
      mpItems = [{ title: concepto, quantity: 1, unit_price: monto, currency_id: 'PEN' }]

    } else {
      // Producto(s): normalizamos a una lista {producto_id, cantidad}.
      const lineas = esCarrito
        ? items.map((i) => ({ producto_id: i.producto_id, cantidad: Math.max(1, parseInt(i.cantidad, 10) || 1) }))
        : [{ producto_id: ref_id, cantidad: 1 }]

      // Validamos CADA producto server-side: existe, con stock. La app solo
      // vende catálogo visible_en_app; el mostrador (POS) vende TODO el
      // inventario, igual que vender_carrito local — por eso el filtro
      // visible_en_app se relaja solo para canal 'mostrador'.
      monto = 0
      for (const l of lineas) {
        const { rows } = await db().query(
          `select p.precio, p.nombre, p.descuento_tipo, p.descuento_valor, coalesce(i.stock, 0) as stock
             from public.producto p
             left join public.inventario_sede i
               on i.producto_id = p.id and i.sede_id = $3
            where p.id = $1 and p.empresa_id = $2
              and (p.visible_en_app = true or $4 = 'mostrador') and p.deleted_at is null`,
          [l.producto_id, empresa_id, sede_id || null, canalPago])
        if (!rows[0]) return res.status(400).json({ error: 'Un producto del carrito no está disponible' })
        const p = rows[0]
        if (sede_id && p.stock < l.cantidad) {
          return res.status(400).json({ error: `Sin stock suficiente de ${p.nombre} (quedan ${p.stock})` })
        }
        // En mostrador se cobra lo que el POS muestra (precio de lista); las
        // ofertas de la app son del canal app (consistente con vender_carrito local).
        const precioUnit = canalPago === 'mostrador'
          ? Number(p.precio)
          : precioEfectivo(p.precio, p.descuento_tipo, p.descuento_valor)
        const subtotal = Math.round(precioUnit * l.cantidad * 100) / 100
        monto += subtotal
        carrito.push({ producto_id: l.producto_id, cantidad: l.cantidad, precio_unit: precioUnit, subtotal, nombre: p.nombre })
        mpItems.push({ title: p.nombre, quantity: l.cantidad, unit_price: precioUnit, currency_id: 'PEN' })
      }
      monto = Math.round(monto * 100) / 100
      concepto = carrito.length === 1
        ? `${carrito[0].nombre}${carrito[0].cantidad > 1 ? ` ×${carrito[0].cantidad}` : ''}`
        : `${carrito.reduce((n, c) => n + c.cantidad, 0)} productos`
    }

    if (!(monto > 0)) return res.status(400).json({ error: 'Monto inválido' })
    const fee = Math.round(monto * COMISION * 100) / 100

    // 3) registra la orden pendiente. Para carrito, ref_id queda null (los
    //    productos van en pago_app_item); para 1 producto conservamos ref_id.
    const refUnico = tipo === 'producto' && !esCarrito ? ref_id : (tipo === 'membresia' ? ref_id : null)
    const { rows: pagoRows } = await db().query(
      `insert into public.pago_app
         (empresa_id, sede_id, socio_id, tipo, concepto, ref_id, monto, comision_fitcore,
          fecha_inicio, estado_activacion, nuevo_nombre, nuevo_documento, nuevo_email, nuevo_telefono, canal)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
      [empresa_id, sede_id || null, socio_id || null, tipo, concepto, refUnico, monto, fee,
       fecha_inicio || null, socio_id ? 'no_aplica' : 'pendiente_activacion',
       nuevo?.nombre || null, nuevo?.documento || null, nuevo?.email || null, nuevo?.telefono || null, canalPago])
    const pagoId = pagoRows[0].id

    // 3b) persistimos las líneas del carrito (también para 1 producto, así el
    //     recojo/entrega/cancelación es uniforme).
    if (tipo === 'producto') {
      for (const c of carrito) {
        await db().query(
          `insert into public.pago_app_item (pago_id, producto_id, cantidad, precio_unit, subtotal)
           values ($1,$2,$3,$4,$5)`,
          [pagoId, c.producto_id, c.cantidad, c.precio_unit, c.subtotal])
      }
    }

    // 4) preferencia con split usando el token DEL GYM
    const pref = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { authorization: `Bearer ${gym.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        items: mpItems,
        marketplace_fee: fee,                       // ← el 5% para FitCore
        external_reference: pagoId,                 // para casar el webhook
        back_urls: { success: `${env('APP_DEEP_LINK', 'fitcore://pago')}?ok=1` },
        auto_return: 'approved',
        notification_url: `${env('PANEL_URL')}/api/mp/webhook`,
      }),
    })
    const data = await pref.json().catch(() => ({}))
    if (!pref.ok) {
      console.error('mp crear-pago pref error', data)
      return res.status(400).json({ error: data?.message || 'No se pudo crear el pago' })
    }

    await db().query(`update public.pago_app set mp_preference_id = $1 where id = $2`, [data.id, pagoId])
    return res.status(200).json({ init_point: data.init_point, pago_id: pagoId })
  } catch (e) {
    console.error('mp crear-pago', e)
    return res.status(500).json({ error: 'Error al crear el pago' })
  }
}
