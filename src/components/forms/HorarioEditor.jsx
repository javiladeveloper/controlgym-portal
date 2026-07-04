// Editor de horario de atención estructurado: 7 días con hora de apertura,
// cierre y "cerrado". Reemplaza el texto libre — el resumen legible
// ("Lun–Vie 6:00–22:00 · Dom cerrado") se genera solo y es lo que se muestra
// en la página pública.

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export const HORARIO_DEFAULT = [
  { abre: '06:00', cierra: '22:00', cerrado: false },
  { abre: '06:00', cierra: '22:00', cerrado: false },
  { abre: '06:00', cierra: '22:00', cerrado: false },
  { abre: '06:00', cierra: '22:00', cerrado: false },
  { abre: '06:00', cierra: '22:00', cerrado: false },
  { abre: '08:00', cierra: '13:00', cerrado: false },
  { abre: '08:00', cierra: '13:00', cerrado: true },
]

const fmt = (t) => (t || '').replace(/^0/, '')

// Agrupa días consecutivos con el mismo horario: "Lun–Vie 6:00–22:00 · Dom cerrado"
export function resumenHorario(h) {
  if (!Array.isArray(h) || h.length !== 7) return ''
  const grupos = []
  h.forEach((d, i) => {
    const key = d.cerrado ? 'cerrado' : `${fmt(d.abre)}–${fmt(d.cierra)}`
    const g = grupos[grupos.length - 1]
    if (g && g.key === key) g.fin = i
    else grupos.push({ ini: i, fin: i, key })
  })
  return grupos.map((g) => `${CORTO[g.ini]}${g.fin > g.ini ? '–' + CORTO[g.fin] : ''} ${g.key}`).join(' · ')
}

export default function HorarioEditor({ value, onChange }) {
  const h = Array.isArray(value) && value.length === 7 ? value : HORARIO_DEFAULT
  const upd = (i, patch) => onChange(h.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const copiarLunes = () => onChange(h.map((d, j) => (j >= 1 && j <= 4 ? { ...h[0] } : d)))

  return (
    <div className="rounded-[10px] border border-line bg-white p-3">
      {h.map((d, i) => (
        <div key={i} className="flex items-center gap-2.5 py-1">
          <span className="w-[74px] flex-shrink-0 text-[12.5px] font-extrabold">{DIAS[i]}</span>
          {d.cerrado ? (
            <span className="flex-1 text-[12px] font-bold text-faint">Cerrado</span>
          ) : (
            <span className="flex flex-1 items-center gap-1.5 text-[12px] font-bold text-muted">
              <input type="time" value={d.abre} onChange={(e) => upd(i, { abre: e.target.value })}
                className="rounded-[8px] border border-line bg-white px-2 py-1 text-[12.5px] font-bold outline-none focus:border-orange" />
              a
              <input type="time" value={d.cierra} onChange={(e) => upd(i, { cierra: e.target.value })}
                className="rounded-[8px] border border-line bg-white px-2 py-1 text-[12.5px] font-bold outline-none focus:border-orange" />
            </span>
          )}
          <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] font-bold text-muted">
            <input type="checkbox" checked={d.cerrado} onChange={(e) => upd(i, { cerrado: e.target.checked })}
              className="h-3.5 w-3.5 accent-orange-600" />
            Cerrado
          </label>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between border-t border-line2 pt-2">
        <button type="button" onClick={copiarLunes}
          className="cursor-pointer border-none bg-transparent p-0 text-[11.5px] font-extrabold text-orange hover:underline">
          Copiar lunes a Mar–Vie
        </button>
        <span className="text-[11.5px] font-bold text-faint">{resumenHorario(h)}</span>
      </div>
    </div>
  )
}
