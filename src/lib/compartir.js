// Lógica del enlace de rutina compartida. Funciones PURAS a propósito: la
// página solo llama y pinta, así esto se prueba sin montar componentes.
//
// La URL pública (dominio + `/r/<token>`) NO se arma aquí: la construye el
// backend (`compartir_mi_rutina`, en SQL) y la app la consume tal cual desde
// `enlace.url`. Tener una segunda función que rearme el mismo string era una
// fuente de verdad duplicada — si cambia el dominio, hay que acordarse de
// tocar dos sitios, y un test aquí seguiría verde con el valor viejo.

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
