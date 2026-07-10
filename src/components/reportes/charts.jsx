// Piezas de gráfica compartidas por los reportes (asistencias, atenciones).
import { BASE_TOKENS as T } from '../../theme/tokens.js'

export function StatCard({ label, valor, sub, color }) {
  return (
    <div className="rounded-[12px] border border-line p-3.5">
      <div className="text-[22px] font-extrabold" style={color ? { color } : undefined}>{valor}</div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] font-semibold text-faint">{sub}</div>}
    </div>
  )
}

// Barras verticales. `datos` = [{ label, total, title?, on? }]. `on === false`
// atenúa la barra (para resaltar una selección).
export function Barras({ datos, alto = 96 }) {
  const max = Math.max(1, ...datos.map((d) => d.total))
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1">
      {datos.map((d, i) => (
        <div key={i} className="flex min-w-[20px] flex-1 flex-col items-center gap-1" title={`${d.title || d.label}: ${d.total}`}>
          <div className="text-[9px] font-bold text-faint">{d.total || ''}</div>
          <div className="w-full rounded-t" style={{
            height: `${Math.round((d.total / max) * alto) + 2}px`,
            background: d.on === false ? T.primaryTint : T.primary,
          }} />
          <div className="text-[9px] font-bold text-muted">{d.label}</div>
        </div>
      ))}
    </div>
  )
}
