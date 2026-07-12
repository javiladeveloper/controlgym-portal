import { supabase } from './supabaseClient.js'

// Verifica un DNI contra el padrón (vía nuestro puente con MAXFIND).
// Nunca lanza: si el servicio no está, devuelve { encontrado: null } y la
// operación del gym sigue normal.
export async function verificarDni({ dni, nombre = '', alimentar = false, extra = null }) {
  try {
    const limpio = String(dni || '').replace(/\D/g, '')
    if (!/^\d{8}$/.test(limpio)) return { encontrado: null }
    const { data: sess } = await supabase.auth.getSession()
    const res = await fetch('/api/dni/verificar', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${sess?.session?.access_token || ''}`,
      },
      body: JSON.stringify({ dni: limpio, nombre, alimentar, extra }),
    })
    return await res.json()
  } catch {
    return { encontrado: null }
  }
}

// Documento del socio mientras se escribe: DNI = solo dígitos, capado a 8
// (no deja escribir el 9.º). Si trae letras (CE / pasaporte de extranjero),
// se permite alfanumérico hasta 12. Sin símbolos ni espacios en ningún caso.
export function limpiarDocumento(v) {
  const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^\d*$/.test(s) ? s.slice(0, 8) : s.slice(0, 12)
}

// Badge de resultado listo para pintar
export function textoVerificacion(v) {
  if (!v || v.encontrado === null) return null
  if (v.encontrado === false) return { tipo: 'aviso', texto: '📋 DNI no encontrado en el padrón (puede ser reciente o extranjero)' }
  if (v.coincide === false) return { tipo: 'alerta', texto: `⚠️ El nombre NO coincide con el padrón: ${v.nombre_oficial}` }
  if (v.coincide === true) return { tipo: 'ok', texto: `✓ Verificado: ${v.nombre_oficial}` }
  return { tipo: 'ok', texto: `✓ DNI existe: ${v.nombre_oficial}` }
}
