// ============================================================================
// FUENTE ÚNICA DE VERDAD DEL DISEÑO (Design Tokens)
//
// Aquí viven TODOS los colores, radios y tokens de la marca. Este archivo es
// el contrato compartido entre:
//   · el portal web (Tailwind + CSS variables)
//   · la app móvil (consume los mismos nombres vía la API / empresa_tema)
//   · la BD (tabla empresa_tema usa exactamente estos nombres de color)
//
// Regla: NO hardcodear colores en componentes. Usar los tokens (clases Tailwind
// como `bg-primary`, `text-navy`, o la variable CSS `var(--color-primary)`).
//
// Para white-label: cada empresa puede sobreescribir estos valores en
// `empresa_tema`; el ThemeProvider los aplica como CSS variables en runtime.
// ============================================================================

// Tokens base de FitCore. Los nombres coinciden 1:1 con las columnas de empresa_tema.
export const BASE_TOKENS = {
  // Colores de marca / acción
  primary: '#FF6B35', // naranja de acción (botones primarios, activos)
  primaryHover: '#F05E28',
  primarySoft: '#FFA37D',
  primaryTint: '#FFD9C6',
  primaryBg: '#FFF0E8', // fondo suave naranja (cards de alerta)

  // Superficies oscuras (sidebar, tarjetas destacadas)
  navy: '#141B2E',
  navySoft: '#1D2740',

  // Semánticos
  success: '#1D9E75',
  successDark: '#116B4E',
  successSoft: '#3FCB9C',
  successBg: '#E6F5EF',
  danger: '#E24B4A',
  dangerBg: '#FCEAEA',
  dangerTint: '#F5CFCF',

  // Neutros / texto
  ink: '#141B2E', // texto principal
  muted: '#5B6472', // texto secundario
  faint: '#9AA3B5', // texto terciario / labels

  // Líneas y fondos
  line: '#E5E7EB',
  line2: '#F0F1F4',
  surface: '#F5F6F8',
  canvas: '#E9EBF0',
  chipNavy: '#EDF0F7',
  white: '#FFFFFF',
}

// Mapa: nombre de columna en empresa_tema  ->  clave de token CSS.
// Permite tomar el tema que envía la API y volcarlo en CSS variables.
export const DB_TO_TOKEN = {
  color_primary: 'primary',
  color_primary_hover: 'primaryHover',
  color_navy: 'navy',
  color_navy_soft: 'navySoft',
  color_success: 'success',
  color_danger: 'danger',
  color_muted: 'muted',
  color_faint: 'faint',
  color_line: 'line',
  color_surface: 'surface',
  color_canvas: 'canvas',
}

// Convierte un token (camelCase) a nombre de CSS variable: primaryHover -> --color-primary-hover
export function cssVarName(token) {
  return '--color-' + token.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

// Genera el objeto de CSS variables a partir de un set de tokens.
export function tokensToCssVars(tokens) {
  const vars = {}
  for (const [key, value] of Object.entries(tokens)) {
    vars[cssVarName(key)] = value
  }
  return vars
}

// Aplica los tokens de una empresa (fila empresa_tema) sobre los base y los
// escribe como CSS variables en :root. Usado por el ThemeProvider.
export function applyEmpresaTema(empresaTema) {
  const merged = { ...BASE_TOKENS }
  if (empresaTema) {
    for (const [col, token] of Object.entries(DB_TO_TOKEN)) {
      if (empresaTema[col]) merged[token] = empresaTema[col]
    }
    // tokens extra libres (jsonb)
    if (empresaTema.tokens && typeof empresaTema.tokens === 'object') {
      Object.assign(merged, empresaTema.tokens)
    }
  }
  const root = document.documentElement
  for (const [name, value] of Object.entries(tokensToCssVars(merged))) {
    root.style.setProperty(name, value)
  }
  return merged
}
