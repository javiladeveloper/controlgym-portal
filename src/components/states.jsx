// Estados de carga y error reutilizables, respetando la grilla de cada página.

export function LoadingState({ variant = 'cards', rows = 4 }) {
  if (variant === 'kpis') {
    return (
      <div className="mt-[22px] grid grid-cols-4 gap-[15px]">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-card border border-line bg-white" />
        ))}
      </div>
    )
  }
  if (variant === 'table') {
    return (
      <div className="mt-[18px] overflow-hidden rounded-card border border-line bg-white">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line2 px-5 py-4">
            <div className="h-9 w-9 animate-pulse rounded-full bg-surface" />
            <div className="h-3 flex-1 animate-pulse rounded bg-surface" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="mt-5 grid grid-cols-2 gap-[15px]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-[110px] animate-pulse rounded-card border border-line bg-white" />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="mt-6 rounded-card border border-red-100 bg-red-50 px-5 py-4">
      <div className="text-[13.5px] font-extrabold text-red">No se pudieron cargar los datos</div>
      <div className="mt-1 text-[12.5px] font-semibold text-muted">{error?.message || 'Error desconocido'}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 cursor-pointer rounded-[9px] border border-red bg-white px-3.5 py-2 text-[12px] font-extrabold text-red hover:bg-red-50"
        >
          Reintentar
        </button>
      )}
    </div>
  )
}

export function EmptyState({ message = 'Nada que mostrar aún.' }) {
  return (
    <div className="mt-6 rounded-card border border-line bg-white px-5 py-10 text-center text-[13px] font-semibold text-muted">
      {message}
    </div>
  )
}
