import ReporteAsistencias from '../components/reportes/ReporteAsistencias.jsx'
import ReporteAtenciones from '../components/reportes/ReporteAtenciones.jsx'
import { usePanel } from '../store.jsx'

// Reportes para tomar decisiones. Consultan datos reales vía RPC (Supabase):
//  · Asistencias (check-ins): por hora, día de la semana, mapa de calor, rango
//    de horas y serie por día.
//  · Atenciones de entrenadores: ayudas/cargas atendidas + rutinas/dietas
//    enviadas, ranking por persona y tendencia diaria.
export default function Reportes() {
  const { sedeNombre } = usePanel()

  return (
    <div className="flex flex-col gap-5 px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Reportes</h1>
        <p className="mt-0.5 text-[13px] font-semibold text-muted">
          Indicadores de {sedeNombre} para tomar decisiones.
        </p>
      </div>

      <ReporteAsistencias />
      <ReporteAtenciones />
    </div>
  )
}
