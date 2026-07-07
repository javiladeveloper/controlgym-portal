// Shared presentational primitives for the FitCore panel.

export function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-card border border-line bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-[13px] font-semibold text-muted">{subtitle}</p>
        )}
      </div>
      {actions}
    </div>
  )
}

export function PrimaryButton({ className = '', children, ...props }) {
  return (
    <button
      className={`cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white shadow-[0_4px_12px_rgba(255,107,53,0.3)] transition-colors hover:bg-orange-600 active:scale-[0.98] ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function GhostButton({ className = '', children, ...props }) {
  return (
    <button
      className={`cursor-pointer rounded-[9px] border border-orange bg-transparent px-3.5 py-2 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

// Colored pill / badge. Pass explicit bg + text colors (hex) from the data layer.
export function Badge({ bg, color, className = '', children }) {
  return (
    <span
      className={`inline-block rounded-full px-[11px] py-[5px] text-[11px] font-extrabold ${className}`}
      style={{ background: bg, color }}
    >
      {children}
    </span>
  )
}

// KPI stat card. variant: 'default' | 'accent' | 'danger'
export function StatCard({ label, value, delta, deltaColor, variant = 'default' }) {
  const styles = {
    default: 'bg-white border-line',
    accent: 'bg-orange-50 border-orange-100',
    danger: 'bg-red-50 border-red-100',
  }[variant]
  const labelColor = variant === 'accent' ? 'text-orange' : variant === 'danger' ? 'text-red' : 'text-muted'
  const valueColor = variant === 'accent' ? 'text-orange' : variant === 'danger' ? 'text-red' : 'text-ink'
  return (
    <div className={`rounded-card border p-[17px] shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)] transition-shadow hover:shadow-[0_4px_12px_rgba(16,24,40,0.08)] ${styles}`}>
      <div className={`text-[11px] font-extrabold uppercase tracking-[0.6px] ${labelColor}`}>
        {label}
      </div>
      <div className={`mt-1.5 text-[27px] font-extrabold tabular-nums ${valueColor}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {delta && (
        <div
          className="mt-0.5 text-[12px] font-bold"
          style={{ color: deltaColor || '#5B6472' }}
        >
          {delta}
        </div>
      )}
    </div>
  )
}

// Circular avatar with initials.
export function Avatar({ ini, bg, color, size = 36, fontSize = 12.5 }) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full font-extrabold"
      style={{ width: size, height: size, background: bg, color, fontSize }}
    >
      {ini}
    </div>
  )
}

// Section title used inside cards.
export function CardTitle({ title, subtitle, right }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[14.5px] font-extrabold">{title}</div>
        {subtitle && <div className="mt-0.5 text-[12px] font-semibold text-muted">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}
