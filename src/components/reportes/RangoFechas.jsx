// Control de rango de fechas para los reportes: presets (Hoy, Esta semana, Este
// mes, últimos 7/30/90 días) + Personalizado con dos fechas. Emite {desde, hasta}
// como 'YYYY-MM-DD' en hora local.
import { useState } from 'react'

export function isoLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

// Devuelve {desde, hasta} para un preset dado.
export function rangoPreset(key) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const desde = new Date(hoy)
  if (key === 'semana') { const dow = (hoy.getDay() + 6) % 7; desde.setDate(hoy.getDate() - dow) } // lunes de esta semana
  else if (key === 'mes') desde.setDate(1)
  else if (key === '7') desde.setDate(hoy.getDate() - 6)
  else if (key === '30') desde.setDate(hoy.getDate() - 29)
  else if (key === '90') desde.setDate(hoy.getDate() - 89)
  // 'hoy' → desde = hoy
  return { desde: isoLocal(desde), hasta: isoLocal(hoy) }
}

const PRESETS = [
  ['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'],
  ['7', '7 días'], ['30', '30 días'], ['90', '90 días'], ['custom', 'Personalizado'],
]

export default function RangoFechas({ value, onChange, defaultPreset = '30' }) {
  const [activo, setActivo] = useState(defaultPreset)
  const [d1, setD1] = useState(value?.desde || '')
  const [d2, setD2] = useState(value?.hasta || '')

  function elegir(key) {
    setActivo(key)
    if (key === 'custom') {
      const base = value || rangoPreset('30')
      setD1(base.desde); setD2(base.hasta)
      onChange({ desde: base.desde, hasta: base.hasta })
    } else {
      onChange(rangoPreset(key))
    }
  }

  function custom(desde, hasta) {
    setD1(desde); setD2(hasta)
    if (desde && hasta && desde <= hasta) onChange({ desde, hasta })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map(([k, l]) => (
        <button key={k} onClick={() => elegir(k)}
          className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition-colors ${activo === k ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
          {l}
        </button>
      ))}
      {activo === 'custom' && (
        <div className="flex items-center gap-2">
          <input type="date" value={d1} max={d2 || undefined} onChange={(e) => custom(e.target.value, d2)}
            className="rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-orange" />
          <span className="text-[12px] font-bold text-faint">→</span>
          <input type="date" value={d2} min={d1 || undefined} onChange={(e) => custom(d1, e.target.value)}
            className="rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12.5px] outline-none focus:border-orange" />
        </div>
      )}
    </div>
  )
}
