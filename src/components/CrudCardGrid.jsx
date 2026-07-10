import { useState } from 'react'
import { LoadingState, ErrorState, EmptyState } from './states.jsx'

// Chrome compartido de las páginas tipo catálogo (Promociones, Sponsors):
// cabecera con botón "Nuevo", estados de carga/error/vacío y grid de tarjetas.
// Cada página pasa su cuerpo de tarjeta en `renderCard(item)` y sus modales como
// children. Así se comparte todo lo repetido sin acoplar el contenido propio.
export function CrudCardGrid({
  title, subtitle, nuevoLabel, onNuevo,
  isLoading, error, onRetry, emptyMessage,
  items, renderCard, children,
}) {
  const lista = items || []
  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] font-semibold text-muted">{subtitle}</p>}
        </div>
        <button onClick={onNuevo}
          className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">{nuevoLabel}</button>
      </div>

      {children /* modales de la página */}

      {isLoading && <LoadingState variant="cards" rows={4} />}
      {error && <ErrorState error={error} onRetry={onRetry} />}
      {!isLoading && lista.length === 0 && <EmptyState message={emptyMessage} />}

      {lista.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-[15px] md:grid-cols-2">
          {lista.map(renderCard)}
        </div>
      )}
    </div>
  )
}

// Fila de acciones de una tarjeta: pausar/activar + editar + eliminar (con
// confirmación inline). Maneja su propio estado de confirmación para que cada
// tarjeta sea independiente. Los clics no propagan al onClick de la tarjeta
// porque el contenedor filtra por `closest('button,a')`.
export function AccionesCard({ puedePausar, puedeActivar, onPausar, onActivar, onEditar, onEliminar }) {
  const [confirmar, setConfirmar] = useState(false)

  if (confirmar) return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10.5px] font-extrabold text-red">¿Eliminar?</span>
      <button onClick={onEliminar} className="cursor-pointer rounded-[8px] border-none bg-red px-2.5 py-1 text-[10.5px] font-extrabold text-white">Sí</button>
      <button onClick={() => setConfirmar(false)} className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[10.5px] font-extrabold text-muted">No</button>
    </div>
  )

  return (
    <div className="flex items-center gap-1.5">
      {puedePausar && (
        <button onClick={onPausar} title="Pausar (deja de aplicar y sale de tu página web)"
          className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[10.5px] font-extrabold text-muted hover:border-amber-400 hover:text-amber-600">⏸ Pausar</button>
      )}
      {puedeActivar && (
        <button onClick={onActivar} title="Reactivar"
          className="cursor-pointer rounded-[8px] border border-green-300 bg-green-50 px-2.5 py-1 text-[10.5px] font-extrabold text-green-600">▶ Activar</button>
      )}
      <button onClick={onEditar} title="Editar"
        className="cursor-pointer rounded-[8px] border-none bg-transparent px-1.5 py-1 text-[12px] text-faint hover:text-orange">✏️</button>
      <button onClick={() => setConfirmar(true)} title="Eliminar"
        className="cursor-pointer rounded-[8px] border-none bg-transparent px-1.5 py-1 text-[11.5px] font-extrabold text-faint hover:text-red">🗑</button>
    </div>
  )
}
