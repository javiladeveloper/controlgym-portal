// GET /api/mp/oauth-start — el gym (admin) inicia la conexión de su cuenta
// MercadoPago para cobrar membresías/productos con split. Devuelve la URL de
// autorización de MercadoPago. PEDIDO 15 Fase 1.
import { db, usuarioDesdeJwt, env } from '../_lib/db.js'

export default async function handler(req, res) {
  const user = await usuarioDesdeJwt(req)
  if (!user?.id) return res.status(401).json({ error: 'No autenticado' })

  // Empresa activa del usuario, y que sea admin (solo el dueño conecta cobros).
  const { rows } = await db().query(
    `select ue.empresa_id
       from public.usuario_empresa ue
       join public.rol r on r.id = ue.rol_id
      where ue.usuario_id = $1 and ue.activo and r.codigo = 'admin'
      order by ue.es_default desc, ue.created_at asc
      limit 1`,
    [user.id],
  )
  const empresaId = rows[0]?.empresa_id
  if (!empresaId) return res.status(403).json({ error: 'Solo el administrador puede conectar los cobros' })

  const authUrl = new URL('https://auth.mercadopago.com/authorization')
  authUrl.searchParams.set('client_id', env('MP_CLIENT_ID'))
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('platform_id', 'mp')
  authUrl.searchParams.set('redirect_uri', env('MP_REDIRECT_URI'))
  authUrl.searchParams.set('state', empresaId) // qué gym volvió (firmar/verificar en prod)

  // Forzar el SELECTOR de cuenta: MP no expone prompt=select_account. Anteponemos
  // el logout de MP (dominio Perú) que, al terminar, redirige a la authorization,
  // para que el dueño del gym elija/inicie sesión con SU cuenta en vez de que MP
  // reuse la sesión activa del navegador y vincule la equivocada. El parámetro de
  // retorno de este logout es `go`. Si en algún flujo el logout no cortara la
  // sesión, el panel recomienda además "Conectar cobros" en ventana de incógnito.
  const url = new URL('https://www.mercadopago.com.pe/logout')
  url.searchParams.set('go', authUrl.toString())

  return res.status(200).json({ url: url.toString() })
}
