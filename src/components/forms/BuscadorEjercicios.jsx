import { useState } from 'react'
import { useBuscarEjercicios } from '../../hooks/useCatalogoEjercicios.js'
import { LoadingState, ErrorState } from '../states.jsx'

// Taxonomías del dataset (fijas). Se muestran en español donde aplica.
const BODY_PARTS = ['back','cardio','chest','lower arms','lower legs','neck','shoulders','upper arms','upper legs','waist']
const EQUIPOS = ['assisted','band','barbell','body weight','bosu ball','cable','dumbbell','kettlebell','leverage machine','medicine ball','resistance band','smith machine','stability ball','weighted']

export default function BuscadorEjercicios({ onElegir }) {
  const [texto, setTexto] = useState('')
  const [bodyPart, setBodyPart] = useState('')
  const [equipo, setEquipo] = useState('')
  const q = useBuscarEjercicios({ texto, body_part: bodyPart, equipment: equipo, limit: 30 })
  const items = q.data || []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar ejercicio…"
          className="min-w-[180px] flex-1 rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange" />
        <select value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} className="cursor-pointer rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold">
          <option value="">Zona</option>
          {BODY_PARTS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={equipo} onChange={(e) => setEquipo(e.target.value)} className="cursor-pointer rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold">
          <option value="">Equipo</option>
          {EQUIPOS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      {q.isLoading && <LoadingState variant="cards" rows={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {!q.isLoading && !q.isError && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((ej) => (
            <button key={ej.id} onClick={() => onElegir?.(ej)}
              className="flex cursor-pointer flex-col overflow-hidden rounded-[12px] border border-line bg-white text-left transition-colors hover:border-orange">
              {ej.gif_url
                ? <img src={ej.gif_url} alt="" loading="lazy" className="h-[130px] w-full bg-[#0B0E14] object-contain" />
                : <div className="flex h-[130px] items-center justify-center bg-surface text-[11px] font-bold text-faint">Sin GIF</div>}
              <div className="p-2.5">
                <div className="line-clamp-2 text-[12.5px] font-extrabold leading-tight">{ej.nombre}</div>
                <div className="mt-1 text-[10.5px] font-bold text-muted">{ej.target || ej.body_part} · {ej.equipment || ''}</div>
              </div>
            </button>
          ))}
          {items.length === 0 && <div className="col-span-full py-6 text-center text-[12.5px] font-semibold text-muted">Sin resultados. Prueba otro filtro.</div>}
        </div>
      )}
    </div>
  )
}
