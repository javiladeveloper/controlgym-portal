import { useState } from 'react'
import { Card } from '../ui.jsx'
import RangoFechas, { rangoPreset } from './RangoFechas.jsx'
import { usePanel } from '../../store.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { descargarCSV } from '../../lib/csv.js'
import { fechaLocal, fechaCorta, money } from '../../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'
import { StatCard, Barras } from './charts.jsx'
import { useVentasSerie, useSociosKpis } from '../../hooks/useReportes.js'

function rpcFaltante(error) {
  if (!error) return false
  const m = `${error.code || ''} ${error.message || ''}`.toLowerCase()
  return m.includes('pgrst202') || m.includes('does not exist') || m.includes('could not find') || m.includes('not find the function')
}

const METODOS = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }
const hoyStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function ReporteVentas() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'

  const [rango, setRango] = useState(() => rangoPreset('30'))
  const q = useVentasSerie(sedeId, rango.desde, rango.hasta)
  const kpis = useSociosKpis(sedeId)

  const rows = q.data || []
  const hoy = fechaLocal(hoyStr())
  const dowHoy = (hoy.getDay() + 6) % 7 // 0=lunes
  const inicioSemana = new Date(hoy); inicioSemana.setDate(hoy.getDate() - dowHoy)
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1)

  const totalHoy = rows.filter((r) => fechaLocal(r.fecha).getTime() === hoy.getTime()).reduce((s, r) => s + r.total, 0)
  const totalSemana = rows.filter((r) => fechaLocal(r.fecha) >= inicioSemana && fechaLocal(r.fecha) <= hoy).reduce((s, r) => s + r.total, 0)
  const filasMes = rows.filter((r) => fechaLocal(r.fecha) >= inicioMes && fechaLocal(r.fecha) <= hoy)
  const totalMes = filasMes.reduce((s, r) => s + r.total, 0)

  const porMetodoMes = {}
  for (const r of filasMes) {
    for (const [metodo, monto] of Object.entries(r.por_metodo || {})) {
      porMetodoMes[metodo] = (porMetodoMes[metodo] || 0) + monto
    }
  }
  const metodosOrdenados = Object.entries(porMetodoMes).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])

  const totalPeriodo = rows.reduce((s, r) => s + r.total, 0)

  const proy = kpis.data?.proyeccion_mes

  function exportar() {
    const filas = rows.map((r) => ({ Fecha: r.fecha, Total: r.total, ...r.por_metodo }))
    descargarCSV(`ventas-${sedeNombre?.replace(/\s+/g, '-').toLowerCase() || 'sede'}`, filas)
  }

  const cargando = q.isLoading
  const error = q.error

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-extrabold">💰 Ventas</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Ingresos registrados en {sedeNombre} — {rango.desde} → {rango.hasta}.</div>
        </div>
        <button onClick={exportar} disabled={!rows.length}
          className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-4 py-2 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-40">⬇ Exportar</button>
      </div>

      <div className="mt-4"><RangoFechas value={rango} onChange={setRango} defaultPreset="30" /></div>

      {cargando && <div className="py-10 text-center text-[12.5px] font-semibold text-muted">Cargando…</div>}

      {error && rpcFaltante(error) && (
        <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-semibold text-amber-800">
          Este reporte necesita que se aplique la migración de base de datos en Supabase
          (<span className="font-mono text-[11.5px]">reporte_ventas_serie</span>). Una vez aplicada, aparecerá aquí.
        </div>
      )}
      {error && !rpcFaltante(error) && (
        <div className="mt-4 rounded-[10px] bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red">No se pudo cargar: {error.message}</div>
      )}

      {!cargando && !error && totalPeriodo === 0 && (
        <div className="mt-4 rounded-[10px] bg-surface px-4 py-8 text-center text-[12.5px] font-semibold text-muted">
          Sin ventas registradas en los últimos 30 días.
        </div>
      )}

      {!cargando && !error && totalPeriodo > 0 && (
        <div className="mt-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Hoy" valor={money(totalHoy, moneda)} color={T.primary} />
            <StatCard label="Esta semana" valor={money(totalSemana, moneda)} />
            <StatCard label="Este mes" valor={money(totalMes, moneda)} />
          </div>

          {metodosOrdenados.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Por método de pago (este mes)</div>
              <div className="flex flex-wrap gap-2">
                {metodosOrdenados.map(([metodo, monto]) => (
                  <span key={metodo} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-muted">
                    {METODOS[metodo] || metodo}: <span className="font-extrabold text-ink">{money(monto, moneda)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {rows.length > 1 && (
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Serie diaria</div>
              <Barras datos={rows.map((r) => ({ label: fechaLocal(r.fecha).getDate().toString(), title: `${fechaCorta(r.fecha)}: ${money(r.total, moneda)}`, total: r.total }))} />
            </div>
          )}

          {proy && (
            <div className="rounded-[12px] border border-orange-100 bg-orange-50 p-4">
              <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-orange">Proyección del mes</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] font-bold text-muted">
                <span>Ingresado <span className="font-extrabold text-ink">{money(proy.ingresado, moneda)}</span></span>
                <span className="text-faint">+</span>
                <span>Por renovar <span className="font-extrabold text-ink">{money(proy.por_renovar, moneda)}</span></span>
                <span className="text-faint">=</span>
                <span>Total esperado <span className="font-extrabold text-orange">{money(proy.total, moneda)}</span></span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
