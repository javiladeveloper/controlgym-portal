// Pool de Postgres compartido entre invocaciones de la misma lambda.
// Conecta directo a Supabase (usuario postgres) — las funciones del backend
// no pasan por RLS; validan permisos explícitamente antes de escribir.
import pg from 'pg'

let pool

export function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: (process.env.DATABASE_URL || '').trim(),
      ssl: { rejectUnauthorized: false },
      max: 1,
    })
  }
  return pool
}

// Resuelve el usuario de Supabase a partir del JWT que envía el frontend.
export async function usuarioDesdeJwt(req) {
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, authorization: `Bearer ${jwt}` },
  })
  if (!res.ok) return null
  return res.json()
}
