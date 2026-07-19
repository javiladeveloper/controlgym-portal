// Global setup de la suite E2E del panel.
//
// El access_token de Supabase dura 1 hora, así que un storageState guardado se
// vence solito y toda la suite del panel empieza a fallar con "Cargando…" (la
// sesión ya no es válida). Esto renueva el token con el refresh_token guardado
// ANTES de cada corrida, para que los fallos sean siempre del panel y nunca de
// una credencial vencida.
//
// Si no hay storageState (nadie se logueó todavía) no hace nada: los tests del
// panel se saltan solos.
import fs from 'node:fs'
import path from 'node:path'

const AUTH = path.resolve('tests/e2e/.auth/admin.json')
const SUPA_URL = 'https://zlmqdubrjzmagslcsqvb.supabase.co'

export default async function globalSetup() {
  if (!fs.existsSync(AUTH)) return

  const anon = leerAnonKey()
  if (!anon) {
    console.warn('[e2e] sin VITE_SUPABASE_ANON_KEY: no puedo renovar la sesión')
    return
  }

  const state = JSON.parse(fs.readFileSync(AUTH, 'utf8'))
  const entry = state.origins?.[0]?.localStorage?.[0]
  if (!entry) return
  const prev = JSON.parse(entry.value)

  // Si al token le queda buena vida, no gastamos una llamada.
  const restante = (prev.expires_at || 0) - Math.floor(Date.now() / 1000)
  if (restante > 15 * 60) return

  try {
    const res = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anon, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: prev.refresh_token }),
    })
    const data = await res.json()
    if (!data.access_token) {
      console.warn('[e2e] no se pudo renovar la sesión:', data?.error_description || data?.msg || res.status)
      return
    }
    const value = JSON.stringify({
      access_token: data.access_token,
      token_type: 'bearer',
      expires_in: data.expires_in,
      expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      refresh_token: data.refresh_token,
      user: data.user || prev.user,
    })
    for (const o of state.origins) o.localStorage[0].value = value
    fs.writeFileSync(AUTH, JSON.stringify(state, null, 2))
    console.log('[e2e] sesión renovada para', (data.user || prev.user)?.email)
  } catch (e) {
    console.warn('[e2e] error renovando la sesión:', e.message)
  }
}

// La anon key sale del entorno o del .env local (no se commitea).
function leerAnonKey() {
  if (process.env.VITE_SUPABASE_ANON_KEY) return process.env.VITE_SUPABASE_ANON_KEY
  const envPath = path.resolve('.env')
  if (!fs.existsSync(envPath)) return null
  const m = fs.readFileSync(envPath, 'utf8').match(/VITE_SUPABASE_ANON_KEY\s*=\s*(\S+)/)
  return m ? m[1] : null
}
