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

// Estado EFECTIVO de una membresía considerando su fecha de fin. El campo
// membresia.estado solo pasa a 'vencida' cuando corre el cron diario; entre
// tanto una membresía ya vencida seguiría en verde. Esto lo corrige en vivo:
// si está 'activa' pero su fecha_fin ya pasó, se trata como 'vencida'.
export function estadoMembresiaVivo(mem) {
  if (!mem) return null
  const est = mem.estado
  if (est === 'activa' && mem.fecha_fin) {
    const fin = fechaLocal(mem.fecha_fin)
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    if (fin && fin < hoy) return 'vencida'
  }
  return est
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

// Parsea una fecha de Postgres SIN desfase de zona horaria. Un date
// 'YYYY-MM-DD' con new Date() se interpreta como medianoche UTC y en Perú
// (UTC-5) retrocede un día. Esto lo parsea como fecha LOCAL. Acepta también
// timestamps completos (los deja tal cual).
export function fechaLocal(f) {
  if (!f) return null
  if (f instanceof Date) return f
  const s = String(f)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(s)
}

// ¿Dos fechas caen el MISMO día del calendario local?
export function mismoDia(a, b) {
  const x = fechaLocal(a), y = fechaLocal(b)
  if (!x || !y) return false
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

// ¿La fecha cae en el mismo MES y AÑO que la referencia (hoy por defecto)?
export function mismoMesAnio(f, ref = new Date()) {
  const x = fechaLocal(f)
  if (!x) return false
  return x.getFullYear() === ref.getFullYear() && x.getMonth() === ref.getMonth()
}

// Estado de máquina → badge/label
export function maquinaEstado(estado) {
  if (estado === 'operativa') return { label: 'Operativa', bg: T.successBg, color: T.success }
  if (estado === 'mantenimiento') return { label: 'En mantenimiento', bg: T.primaryBg, color: T.primary }
  return { label: 'Fuera de servicio', bg: T.dangerBg, color: T.danger }
}
