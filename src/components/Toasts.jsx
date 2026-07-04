import { useEffect, useState } from 'react'

// Contenedor de toasts (se monta una vez en el layout del panel).
// Escucha los eventos de src/lib/toast.js y los apila abajo al centro.
const ESTILO = {
  ok: { bg: '#0F9D58', icon: '✓' },
  error: { bg: '#D93025', icon: '✕' },
  info: { bg: '#1F293D', icon: 'ℹ' },
}

export default function Toasts() {
  const [items, setItems] = useState([])

  useEffect(() => {
    function onToast(e) {
      const t = e.detail
      setItems((s) => [...s, t])
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), t.duracion || 3800)
    }
    window.addEventListener('fc-toast', onToast)
    return () => window.removeEventListener('fc-toast', onToast)
  }, [])

  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4">
      {items.map((t) => {
        const est = ESTILO[t.tipo] || ESTILO.info
        return (
          <div key={t.id}
            className="pointer-events-auto flex max-w-[440px] items-center gap-3 rounded-xl px-4 py-3 text-[13px] font-bold text-white shadow-2xl"
            style={{ background: est.bg }}>
            <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/20 text-[11px]">{est.icon}</span>
            <span className="min-w-0">{t.texto}</span>
            {t.onUndo && (
              <button
                onClick={() => { t.onUndo(); setItems((s) => s.filter((x) => x.id !== t.id)) }}
                className="ml-1 flex-shrink-0 cursor-pointer rounded-lg border border-white/40 bg-transparent px-3 py-1 text-[12px] font-extrabold text-white hover:bg-white/15">
                Deshacer
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
