// Lógica del enlace de rutina compartida. Funciones PURAS a propósito: la
// página solo llama y pinta, así esto se prueba sin montar componentes.

/** Dominio público de FitCore (el mismo que usa el enlace que se comparte). */
const BASE = 'https://fitcorecenter.com'

/** URL pública que se comparte (y que se convierte en QR). */
export function urlCompartir(token) {
  return `${BASE}/r/${token}`
}

/**
 * Token de una ruta `/r/<token>`, o null si la ruta no es de compartir.
 * Devolver null en vez de cadena vacía es deliberado: así la página distingue
 * "esta ruta no es mía" de "enlace inválido" sin llamar a la RPC con basura.
 */
export function tokenDesdeRuta(pathname) {
  const m = /^\/r\/([^/]+)\/?$/.exec(pathname || '')
  return m ? m[1] : null
}

/**
 * Días de la rutina ordenados para pintar. Defensivo con null y con días sin
 * ejercicios: el contenido viene de un jsonb congelado que puede ser de una
 * versión anterior del formato.
 */
export function diasOrdenados(contenido) {
  if (!Array.isArray(contenido)) return []
  return [...contenido].sort((a, b) => (a.dia_semana ?? 0) - (b.dia_semana ?? 0))
}
