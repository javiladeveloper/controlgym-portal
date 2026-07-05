// Inline SVG icons ported from the FitCore prototype.
// Each accepts { size, className, ...props } and inherits color via currentColor where relevant.

function svgProps(size, props) {
  return { width: size, height: size, viewBox: '0 0 24 24', ...props }
}

export function LogoMark({ size = 19, color = '#FFFFFF' }) {
  return (
    <svg {...svgProps(size)} fill={color} aria-hidden>
      <rect x="1" y="8" width="3.5" height="8" rx="1.2" />
      <rect x="5.5" y="5.5" width="3.5" height="13" rx="1.2" />
      <rect x="15" y="5.5" width="3.5" height="13" rx="1.2" />
      <rect x="19.5" y="8" width="3.5" height="8" rx="1.2" />
      <rect x="9" y="10.5" width="6" height="3" rx="1" />
    </svg>
  )
}

// Marca de FitControl (la plataforma): mancuerna que se convierte en flecha de
// crecimiento. Redibujo vectorial del logo — navy + naranja sobre cualquier fondo.
// Logo FitControl: mancuerna cuya barra es una línea de pulso (fitness + control
// en vivo). Placa naranja redondeada con discos y pulso en blanco.
export function FitControlLogo({ size = 22, orange = '#FF6B35', ink = '#FFFFFF', badge = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      {badge && <rect width="48" height="48" rx="10.5" fill={orange} />}
      <rect x="6.5" y="13.8" width="4.8" height="20.4" rx="2.4" fill={ink} />
      <rect x="36.7" y="13.8" width="4.8" height="20.4" rx="2.4" fill={ink} />
      <polyline
        points="11.3,24 18.9,24 21.7,16.7 25.7,30.2 28.5,24 36.7,24"
        fill="none" stroke={ink} strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function BellIcon({ size = 18, stroke = 'currentColor' }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 9a6 6 0 10-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M10.3 20a2 2 0 003.4 0" />
    </svg>
  )
}

export function ChevronLeft({ size = 14, stroke = 'currentColor' }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

export function CheckIcon({ size = 13, stroke = '#FFFFFF', opacity = 1 }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity }} aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  )
}

// Logo de WhatsApp: que se note QUÉ canal se está usando
export function WhatsAppIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <svg {...svgProps(size)} fill={color} aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.1c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.7.8 1.8.1.1.1.3 0 .4-.1.2-.1.3-.3.5l-.4.5c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1.1.9 2 1.2 2.3 1.4.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.3.1 1.7.8 2 1 .3.1.5.2.5.3.1.1.1.7-.1 1.4z" />
    </svg>
  )
}

export function TargetIcon({ size = 17, stroke = 'currentColor' }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  )
}

export function BoxIcon({ size = 17, stroke = 'currentColor' }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5" />
      <path d="M12 13v8" />
    </svg>
  )
}

export function DocIcon({ size = 17, stroke = 'currentColor' }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  )
}

export function ClockIcon({ size = 17, stroke = 'currentColor' }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

export function FingerprintIcon({ size = 24, stroke = 'currentColor' }) {
  return (
    <svg {...svgProps(size)} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M12 11c0 4-0.8 7-2.4 9" />
      <path d="M8 6.6C9.1 5.6 10.5 5 12 5c3.9 0 7 3.1 7 7 0 2.6-0.3 4.8-0.9 6.6" />
      <path d="M5.6 9.8C5.2 10.5 5 11.2 5 12c0 3-0.5 5.6-1.4 7.6" />
      <path d="M15.5 12.5c0 2.8-0.4 5.2-1.1 7.1" />
    </svg>
  )
}
