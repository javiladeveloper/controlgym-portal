import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'

// Búsqueda global (Ctrl+K / Cmd+K): socios y prospectos por nombre, código o
// teléfono, desde cualquier módulo. Enter o clic → va directo a la ficha.
export default function BuscadorGlobal() {
  const navigate = useNavigate()
  const [abierto, setAbierto] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState({ socios: [], leads: [] })
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)

  // Atajo global
  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAbierto((s) => !s)
        setQ(''); setRes({ socios: [], leads: [] }); setSel(0)
      }
      if (e.key === 'Escape') setAbierto(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (abierto) setTimeout(() => inputRef.current?.focus(), 50) }, [abierto])

  // Buscar con debounce
  useEffect(() => {
    if (!abierto || q.trim().length < 2) { setRes({ socios: [], leads: [] }); return }
    const t = setTimeout(async () => {
      const like = `%${q.trim()}%`
      const [socios, leads] = await Promise.all([
        supabase.from('socio').select('id, nombre, codigo, telefono, estado')
          .or(`nombre.ilike.${like},codigo.ilike.${like},telefono.ilike.${like}`)
          .is('deleted_at', null).limit(6),
        supabase.from('lead').select('id, nombre, telefono, etapa')
          .or(`nombre.ilike.${like},telefono.ilike.${like}`)
          .is('deleted_at', null).limit(4),
      ])
      setRes({ socios: socios.data || [], leads: leads.data || [] })
      setSel(0)
    }, 220)
    return () => clearTimeout(t)
  }, [q, abierto])

  const plano = [
    ...res.socios.map((s) => ({ ...s, _tipo: 'socio' })),
    ...res.leads.map((l) => ({ ...l, _tipo: 'lead' })),
  ]

  function ir(item) {
    setAbierto(false)
    if (item._tipo === 'socio') navigate(`/clientes?socio=${item.id}`)
    else navigate('/crm')
  }

  if (!abierto) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-4 pt-[12vh]" onClick={() => setAbierto(false)}>
      <div className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <span className="text-[16px]">🔍</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, plano.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              if (e.key === 'Enter' && plano[sel]) ir(plano[sel])
            }}
            placeholder="Busca un socio o prospecto por nombre, código o teléfono…"
            className="min-w-0 flex-1 border-none bg-transparent text-[14.5px] font-semibold outline-none" />
          <kbd className="rounded-md border border-line bg-surface px-2 py-0.5 text-[10px] font-extrabold text-faint">ESC</kbd>
        </div>

        <div className="max-h-[46vh] overflow-auto py-2">
          {q.trim().length < 2 && (
            <div className="px-5 py-6 text-center text-[12.5px] font-semibold text-faint">
              Escribe al menos 2 letras… <span className="ml-1 rounded-md bg-surface px-2 py-0.5 text-[10.5px] font-extrabold">Ctrl+K</span> abre esta búsqueda desde cualquier lugar
            </div>
          )}
          {res.socios.length > 0 && <div className="px-4 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-wide text-faint">Socios</div>}
          {res.socios.map((s, i) => (
            <button key={s.id} onClick={() => ir({ ...s, _tipo: 'socio' })}
              className={`flex w-full cursor-pointer items-center gap-3 border-none px-4 py-2.5 text-left ${sel === i ? 'bg-orange-50' : 'bg-transparent hover:bg-surface'}`}>
              <span className="text-[15px]">💪</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-extrabold">{s.nombre}</span>
                <span className="block text-[11px] font-semibold text-muted">N.º {s.codigo} · {s.telefono || 'sin teléfono'} · {s.estado}</span>
              </span>
              <span className="text-[11px] font-extrabold text-orange">Ver ficha →</span>
            </button>
          ))}
          {res.leads.length > 0 && <div className="px-4 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-wide text-faint">Prospectos (CRM)</div>}
          {res.leads.map((l, i) => (
            <button key={l.id} onClick={() => ir({ ...l, _tipo: 'lead' })}
              className={`flex w-full cursor-pointer items-center gap-3 border-none px-4 py-2.5 text-left ${sel === res.socios.length + i ? 'bg-orange-50' : 'bg-transparent hover:bg-surface'}`}>
              <span className="text-[15px]">🎯</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-extrabold">{l.nombre}</span>
                <span className="block text-[11px] font-semibold capitalize text-muted">{l.etapa.replace('_', ' ')} · {l.telefono || 'sin teléfono'}</span>
              </span>
              <span className="text-[11px] font-extrabold text-orange">Ir al CRM →</span>
            </button>
          ))}
          {q.trim().length >= 2 && plano.length === 0 && (
            <div className="px-5 py-6 text-center text-[12.5px] font-semibold text-faint">Sin resultados para «{q}»</div>
          )}
        </div>
      </div>
    </div>
  )
}
