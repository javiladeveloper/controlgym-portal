// Compresión de imágenes en el navegador antes de subir a Storage.
// Redimensiona al tamaño máximo del destino y convierte a WebP (~80% calidad).
// Así el gym puede subir fotos de celular (5-10MB) sin chocar con límites.

export async function comprimirImagen(file, { maxWidth = 1920, maxHeight = 1920, quality = 0.82 } = {}) {
  // SVG y GIF se suben tal cual (vectores / animaciones)
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality))
    if (!blob || blob.size >= file.size) return file // si no mejora, usar original

    const nombre = file.name.replace(/\.\w+$/, '') + '.webp'
    return new File([blob], nombre, { type: 'image/webp' })
  } catch {
    return file // ante cualquier fallo, subir el original
  }
}

// Presets por tipo de imagen del branding
export const PRESETS = {
  logo: { maxWidth: 512, maxHeight: 512, quality: 0.9 },
  favicon: { maxWidth: 256, maxHeight: 256, quality: 0.9 },
  hero: { maxWidth: 1920, maxHeight: 1200, quality: 0.82 },
  galeria: { maxWidth: 1600, maxHeight: 1600, quality: 0.8 },
  sede: { maxWidth: 1600, maxHeight: 1200, quality: 0.8 },
}
