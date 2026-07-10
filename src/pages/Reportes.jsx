import { Card } from '../components/ui.jsx'
import { usePanel } from '../store.jsx'
import DesempenoTrainers from '../components/DesempenoTrainers.jsx'

// Reportes del gym. Las descargas CSV que solo repetían datos ya visibles en
// otros módulos (ingresos→Finanzas, padrón→Clientes, inventario→Kardex,
// prospectos→CRM, deudores/por-vencer→Membresías) se retiraron para no duplicar.
// Este módulo queda como base para sumar reportes que aporten análisis nuevo.
export default function Reportes() {
  const { sedeNombre } = usePanel()

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Reportes</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">
        Indicadores de {sedeNombre}. Iremos sumando más reportes aquí.
      </p>

      <div className="mt-5">
        <DesempenoTrainers />
      </div>

      <Card className="mt-5 p-[19px]">
        <div className="text-[14.5px] font-extrabold">Más reportes en camino 📊</div>
        <p className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
          Retiramos los reportes que solo repetían datos de otros módulos (los ingresos ya se
          exportan desde Finanzas, el padrón desde Clientes, el inventario desde Kardex y los
          prospectos desde CRM). Aquí sumaremos reportes nuevos con análisis que hoy no existe.
        </p>
      </Card>
    </div>
  )
}
