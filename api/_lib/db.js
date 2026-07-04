// Pool de Postgres compartido entre invocaciones de la misma lambda.
// Conecta directo a Supabase (usuario postgres) — las funciones del backend
// no pasan por RLS; validan permisos explícitamente antes de escribir.
import pg from 'pg'

// Sanea variables de entorno: sin BOM ni saltos de línea colados al grabarlas
// por CLI (un header HTTP con esos bytes revienta el fetch). El trim() de JS
// elimina U+FEFF porque es whitespace según el estándar.
export function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim()
}

let pool

export function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env('DATABASE_URL'),
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
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY')
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, authorization: `Bearer ${jwt}` },
  })
  if (!res.ok) return null
  return res.json()
}
