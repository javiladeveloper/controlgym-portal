import { Card } from '../components/ui.jsx'
import { DocIcon } from '../components/icons.jsx'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const REPORTES = [
  { name: 'Asistencia mensual', desc: 'Check-ins por acceso, horas pico y aforo por día', iconBg: T.primaryBg, iconColor: T.primary },
  { name: 'Ingresos y cobranzas', desc: 'Pagos de membresías, ventas de Kardex y caja diaria', iconBg: T.successBg, iconColor: T.success },
  { name: 'Nuevos socios y bajas', desc: 'Altas, renovaciones y cancelaciones del mes', iconBg: T.chipNavy, iconColor: T.navy },
  { name: 'Membresías por vencer', desc: 'Socios con vencimiento próximo para campañas de renovación', iconBg: T.primaryBg, iconColor: T.primary },
  { name: 'Inventario Kardex', desc: 'Stock actual, productos con quiebre y rotación', iconBg: T.chipNavy, iconColor: T.navy },
  { name: 'Desempeño de entrenadores', desc: 'Rutinas asignadas, socios atendidos y seguimiento', iconBg: T.successBg, iconColor: T.success },
]

export default function Reportes() {
  return (
    <div className="px-7 pb-9 pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Reportes</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">Genera y descarga reportes de la sede en PDF o Excel</p>

      <div className="mt-5 grid grid-cols-3 gap-[15px]">
        {REPORTES.map((r) => (
          <Card key={r.name} className="flex flex-col gap-3 p-[19px] transition hover:border-orange">
            <div className="flex h-10 w-10 items-center justify-center rounded-[11px]" style={{ background: r.iconBg }}>
              <DocIcon stroke={r.iconColor} />
            </div>
            <div className="flex-1">
              <div className="text-[14.5px] font-extrabold">{r.name}</div>
              <div className="mt-[3px] text-[12px] font-semibold leading-[1.5] text-muted">{r.desc}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-extrabold tracking-[0.5px] text-faint">PDF · EXCEL</div>
              <button className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-4 py-2 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50">Generar</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
