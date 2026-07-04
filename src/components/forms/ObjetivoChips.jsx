import { useMemo, useRef, useState } from 'react'

// Selector de objetivo(s) del socio como chips con autocompletado.
// value: string ('Bajar de peso · Tonificar'), onChange(string).
// Se pueden elegir sugerencias o escribir objetivos propios (Enter para agregar).
const SUGERENCIAS = [
  'Bajar de peso', 'Ganar masa muscular', 'Tonificar', 'Definición',
  'Fuerza', 'Resistencia', 'Salud general', 'Rehabilitación',
  'Preparación deportiva', 'Flexibilidad', 'Reducir estrés', 'Post-parto',
]
const SEP = ' · '

export default function ObjetivoChips({ value = '', onChange, placeholder = 'Escribe o elige un objetivo…' }) {
  const chips = useMemo(() => value.split(SEP).map((s) => s.trim()).filter(Boolean), [value])
  const [texto, setTexto] = useState('')
  const [focus, setFocus] = useState(false)
  const inputRef = useRef(null)

  const disponibles = SUGERENCIAS.filter(
    (s) => !chips.some((c) => c.toLowerCase() === s.toLowerCase())
      && (!texto || s.toLowerCase().includes(texto.toLowerCase())),
  )

  function agregar(chip) {
    const limpio = chip.trim()
    if (!limpio || chips.some((c) => c.toLowerCase() === limpio.toLowerCase())) return
    onChange([...chips, limpio].join(SEP))
    setTexto('')
    inputRef.current?.focus()
  }
  function quitar(chip) {
    onChange(chips.filter((c) => c !== chip).join(SEP))
  }
  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (texto.trim()) agregar(texto)
      else if (disponibles[0]) agregar(disponibles[0])
    } else if (e.key === 'Backspace' && !texto && chips.length) {
      quitar(chips[chips.length - 1])
    }
  }

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 py-2 focus-within:border-orange">
        {chips.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 rounded-full bg-orange-50 py-1 pl-3 pr-1.5 text-[12px] font-extrabold text-orange">
            {c}
            <button type="button" onClick={() => quitar(c)} aria-label={`Quitar ${c}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] hover:bg-orange-100">✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          placeholder={chips.length === 0 ? placeholder : ''}
          className="min-w-[120px] flex-1 bg-transparent py-1 text-[13.5px] outline-none"
        />
      </div>
      {focus && disponibles.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[180px] overflow-auto rounded-[10px] border border-line bg-white py-1 shadow-[0_12px_30px_rgba(20,27,46,0.14)]">
          {disponibles.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => { e.preventDefault(); agregar(s) }}
              className="block w-full px-3.5 py-2 text-left text-[13px] font-bold hover:bg-orange-50 hover:text-orange">
              {s}
            </button>
          ))}
          {texto.trim() && !disponibles.some((s) => s.toLowerCase() === texto.trim().toLowerCase()) && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); agregar(texto) }}
              className="block w-full border-t border-line2 px-3.5 py-2 text-left text-[13px] font-bold text-muted hover:bg-orange-50 hover:text-orange">
              Agregar «{texto.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  )
}
