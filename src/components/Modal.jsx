// Modal + campos de formulario reutilizables para las altas del panel.

export default function Modal({ title, subtitle, onClose, children, width = 460 }) {
  return (
    // En móvil el modal sube desde abajo (bottom sheet) y usa todo el ancho;
    // en pantallas grandes queda centrado como siempre.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:px-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-7 shadow-2xl sm:max-h-[90vh] sm:rounded-2xl sm:p-6 sm:pb-6"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[17px] font-extrabold">{title}</div>
            {subtitle && <div className="mt-0.5 text-[12.5px] font-semibold text-muted">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-lg border-none bg-surface px-2.5 py-1 text-[13px] font-extrabold text-muted hover:text-ink">✕</button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

export function Campo({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] font-semibold text-faint">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange w-full'

export function BotonesModal({ onCancel, onSubmit, busy, submitLabel = 'Guardar', disabled }) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2.5">
      <button onClick={onCancel} type="button"
        className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted hover:border-orange">
        Cancelar
      </button>
      <button onClick={onSubmit} type="submit" disabled={busy || disabled}
        className="cursor-pointer rounded-[10px] border-none bg-orange px-5 py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
        {busy ? 'Guardando…' : submitLabel}
      </button>
    </div>
  )
}
