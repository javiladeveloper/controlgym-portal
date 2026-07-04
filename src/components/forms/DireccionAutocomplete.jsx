import { useEffect, useRef, useState } from 'react'
import { inputCls } from '../Modal.jsx'

// Autocompletado de direcciones (Photon/OpenStreetMap, hecho para typeahead).
// Restringe a Perú y, si hay coordenadas base (bias), prioriza lo cercano
// (la sede/ciudad del negocio). onPick entrega { direccion, lat, lng, ciudad }.
const PERU_BBOX = '-81.5,-18.4,-68.6,0.1'

function etiqueta(p) {
  const via = [p.name, p.street, p.housenumber].filter(Boolean)
  // El nombre a veces ya es la calle: no repetir
  const linea = p.name && p.street && p.name !== p.street ? `${p.name}, ${p.street}` : via[0] || ''
  const zona = [p.district, p.city || p.county, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)
  return [linea + (p.housenumber ? ' ' + p.housenumber : ''), ...zona].filter(Boolean).join(', ')
}

export default function DireccionAutocomplete({ value, onChange, onPick, bias, placeholder, className }) {
  const [sug, setSug] = useState([])
  const [abierto, setAbierto] = useState(false)
  const timer = useRef(null)
  const ctrl = useRef(null)
  const caja = useRef(null)

  useEffect(() => {
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  function buscar(q) {
    clearTimeout(timer.current)
    if (!q || q.trim().length < 3) { setSug([]); setAbierto(false); return }
    timer.current = setTimeout(async () => {
      try {
        ctrl.current?.abort()
        ctrl.current = new AbortController()
        const sesgo = bias && Number(bias.lat) && Number(bias.lng) ? `&lat=${bias.lat}&lon=${bias.lng}&zoom=12` : ''
        const r = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&bbox=${PERU_BBOX}${sesgo}`,
          { signal: ctrl.current.signal }
        )
        const j = await r.json()
        const items = (j.features || [])
          .filter((f) => f.properties?.countrycode === 'PE')
          .map((f) => ({
            direccion: etiqueta(f.properties),
            ciudad: f.properties.city || f.properties.county || '',
            lat: String(f.geometry.coordinates[1]),
            lng: String(f.geometry.coordinates[0]),
          }))
          .filter((s, i, a) => s.direccion && a.findIndex((x) => x.direccion === s.direccion) === i)
        setSug(items)
        setAbierto(items.length > 0)
      } catch { /* abortado o sin red: silencio */ }
    }, 350)
  }

  return (
    <div ref={caja} className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); buscar(e.target.value) }}
        onFocus={() => sug.length > 0 && setAbierto(true)}
        placeholder={placeholder || 'Av. Principal 123, Tacna'}
        className={className || inputCls}
        autoComplete="off"
      />
      {abierto && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-[10px] border border-line bg-white shadow-lg">
          {sug.map((s) => (
            <button key={s.direccion} type="button"
              onClick={() => { onChange(s.direccion); onPick?.(s); setAbierto(false); setSug([]) }}
              className="block w-full cursor-pointer border-none bg-transparent px-3.5 py-2.5 text-left text-[13px] font-semibold hover:bg-[#FFF4EC]">
              📍 {s.direccion}
            </button>
          ))}
          <div className="border-t border-line2 px-3.5 py-1.5 text-[10px] font-bold text-faint">OpenStreetMap</div>
        </div>
      )}
    </div>
  )
}
