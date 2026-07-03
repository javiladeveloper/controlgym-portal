// Helpers de PRESENTACIÓN: mapean datos de dominio → colores/labels de UI.
// No son datos ni tokens; son cómo el diseño interpreta el estado. Se calculan
// en el frontend a partir de los datos reales (la BD guarda solo lo semántico).
import { BASE_TOKENS as T } from '../theme/tokens.js'

export const DAY_NAMES = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' }
export const DAY_LETTER = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' }

export function claseDot(nombre = '') {
  if (nombre.startsWith('Baile')) return T.navy
  if (nombre.startsWith('Spinning')) return T.success
  if (nombre.startsWith('Yoga')) return '#8A93A3'
  return T.primary
}

// Estado de socio/membresía → badge
export function estadoBadge(estado) {
  switch (estado) {
    case 'activo':
    case 'activa':
      return { bg: T.successBg, color: T.success, label: 'Activa' }
    case 'vencida':
    case 'moroso':
      return { bg: T.dangerBg, color: T.danger, label: estado === 'moroso' ? 'Morosa' : 'Vencida' }
    case 'congelada':
      return { bg: T.chipNavy, color: T.navy, label: 'Congelada' }
    default:
      return { bg: T.surface, color: T.muted, label: estado || '—' }
  }
}

// Colores de avatar por estado/id (determinístico)
export function avatarColors({ estado, destacado } = {}) {
  if (estado === 'vencida' || estado === 'moroso') return { bg: T.dangerBg, color: T.danger }
  if (destacado) return { bg: T.primaryBg, color: T.primary }
  return { bg: T.chipNavy, color: T.navy }
}

// Iniciales a partir de un nombre
export function iniciales(nombre = '') {
  return nombre.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'
}

// Formatea dinero con la moneda de la empresa (default PEN → 'S/')
export function money(monto, moneda = 'PEN') {
  const simbolo = moneda === 'PEN' ? 'S/' : moneda === 'USD' ? '$' : ''
  const n = Number(monto || 0).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${simbolo} ${n}`.trim()
}

// Estado de máquina → badge/label
export function maquinaEstado(estado) {
  if (estado === 'operativa') return { label: 'Operativa', bg: T.successBg, color: T.success }
  if (estado === 'mantenimiento') return { label: 'En mantenimiento', bg: T.primaryBg, color: T.primary }
  return { label: 'Fuera de servicio', bg: T.dangerBg, color: T.danger }
}
