// Normaliza links de YouTube / Vimeo a su forma EMBEBIBLE (iframe), para que
// el video de técnica se vea dentro de la ficha del ejercicio — no como un
// enlace que saca al usuario a otra pestaña.
//
// Acepta las formas comunes que pega la gente:
//   https://www.youtube.com/watch?v=ID
//   https://youtu.be/ID
//   https://www.youtube.com/shorts/ID
//   https://vimeo.com/ID
//   ...y las que ya vienen como /embed/ las deja igual.

export function parseVideo(url) {
  const u = String(url || '').trim()
  if (!u) return null

  // Búsqueda embebida de YouTube: "yt-search:sentadilla con barra tecnica".
  // YouTube resuelve al mejor resultado del término — útil para contenido
  // genérico que no depende de un ID que pueda caerse.
  let m = u.match(/^yt-search:(.+)$/i)
  if (m) {
    const q = encodeURIComponent(m[1].trim())
    return {
      proveedor: 'youtube',
      id: null,
      embed: `https://www.youtube.com/embed?listType=search&list=${q}`,
      thumb: null,
    }
  }

  // YouTube
  m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)
  if (m) {
    const id = m[1]
    return {
      proveedor: 'youtube',
      id,
      embed: `https://www.youtube.com/embed/${id}`,
      thumb: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    }
  }

  // Vimeo
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (m) {
    const id = m[1]
    return {
      proveedor: 'vimeo',
      id,
      embed: `https://player.vimeo.com/video/${id}`,
      thumb: null, // Vimeo no da thumbnail por URL directa (requiere API)
    }
  }

  // TikTok: https://www.tiktok.com/@usuario/video/1234567890123456789
  // (o el link corto vm.tiktok.com/XXXX, que hay que resolver aparte).
  // TikTok NO embebe por iframe simple: usa su player oficial por ID de video.
  m = u.match(/tiktok\.com\/(?:@[\w.-]+\/video\/|v\/)(\d+)/)
  if (m) {
    const id = m[1]
    return {
      proveedor: 'tiktok',
      id,
      // Player oficial de TikTok (v1) — se puede meter en un iframe/WebView.
      embed: `https://www.tiktok.com/player/v1/${id}`,
      thumb: null,
    }
  }

  return null // no reconocido
}

// ¿Es un link de video válido y embebible?
export function esVideoValido(url) {
  return !!parseVideo(url)
}
