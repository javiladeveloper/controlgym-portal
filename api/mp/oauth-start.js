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

  // Redirige DIRECTO a la authorization de MercadoPago. (Antes anteponíamos
  // `mercadopago.com.pe/logout?go=...` para forzar el selector de cuenta, pero
  // MP no expone ese logout público con `go`: devolvía "esta página no existe" y
  // rompía el flujo de conexión.) MP no tiene un `prompt=select_account`; para
  // que el dueño no vincule por error la cuenta de la sesión activa, el panel
  // recomienda hacer "Conectar cobros" en ventana de incógnito.
  return res.status(200).json({ url: authUrl.toString() })
}
