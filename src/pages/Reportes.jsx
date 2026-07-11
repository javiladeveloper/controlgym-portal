import { useState } from 'react'
import ReporteVentas from '../components/reportes/ReporteVentas.jsx'
import ReporteSocios from '../components/reportes/ReporteSocios.jsx'
import ReporteAsistencias from '../components/reportes/ReporteAsistencias.jsx'
import ReporteAtenciones from '../components/reportes/ReporteAtenciones.jsx'
import { usePanel } from '../store.jsx'

// Reportes para tomar decisiones, agrupados por categoría en pestañas:
//  · Ventas: ingresos hoy/semana/mes, desglose por método, serie diaria y
//    proyección del mes (ingresado + por renovar).
//  · Socios: activos/nuevos/congeladas, churn de los últimos 6 meses y
//    socios ausentes (con acción directa de WhatsApp).
//  · Asistencias (check-ins): por hora, día de la semana, mapa de calor,
//    rango de horas y serie por día.
//  · Personal: atenciones de entrenadores — ayudas/cargas atendidas +
//    rutinas/dietas enviadas, ranking por persona y tendencia diaria.
const TABS = [
  { key: 'ventas', label: 'Ventas 💰', Comp: ReporteVentas },
  { key: 'socios', label: 'Socios 👥', Comp: ReporteSocios },
  { key: 'asistencia', label: 'Asistencias 📊', Comp: ReporteAsistencias },
  { key: 'personal', label: 'Personal 🏋️', Comp: ReporteAtenciones },
]

export default function Reportes() {
  const { sedeNombre } = usePanel()

  // Deep-link: /reportes?tab=socios abre esa pestaña directo
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((x) => x.key === t) ? t : 'ventas'
  })
  const Active = TABS.find((t) => t.key === tab)?.Comp

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Reportes</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">
        Indicadores de {sedeNombre} para tomar decisiones.
      </p>

      {/* Pestañas */}
      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative flex-shrink-0 whitespace-nowrap px-3 py-2.5 text-[13.5px] font-extrabold transition-colors sm:px-4 ${
              tab === t.key ? 'text-orange' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-orange" />}
          </button>
        ))}
      </div>

      <div className="mt-5">{Active && <Active />}</div>
    </div>
  )
}
