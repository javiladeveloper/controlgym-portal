import { useState } from 'react'
import { Card, Avatar } from '../ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { descargarCSV } from '../../lib/csv.js'
import { iniciales, money } from '../../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'
import { StatCard } from './charts.jsx'
import RangoFechas, { rangoPreset } from './RangoFechas.jsx'
import { useReporteComercial } from '../../hooks/useReportes.js'

function rpcFaltante(error) {
  if (!error) return false
  const m = `${error.code || ''} ${error.message || ''}`.toLowerCase()
  return m.includes('pgrst202') || m.includes('does not exist') || m.includes('could not find') || m.includes('not find the function')
}

const MEDALLA = ['🥇', '🥈', '🥉']

function conversionBadge(conversion) {
  if (conversion === null || conversion === undefined) return { bg: T.surface, color: T.muted, label: '—' }
  const pct = Math.round(conversion * 100)
  if (conversion >= 0.30) return { bg: T.successBg, color: T.success, label: `${pct}%` }
  if (conversion >= 0.15) return { bg: T.warningBg, color: T.warning, label: `${pct}%` }
  return { bg: T.dangerBg, color: T.danger, label: `${pct}%` }
}

export default function ReporteComercial() {
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'

  const [rango, setRango] = useState(() => rangoPreset('mes'))

  const q = useReporteComercial(rango.desde, rango.hasta)

  const vendedores = q.data?.vendedores || []
  const ordenados = [...vendedores].sort((a, b) => Number(b.ventas_total || 0) - Number(a.ventas_total || 0))

  const ventasEquipo = ordenados.reduce((s, v) => s + Number(v.ventas_total || 0), 0)
  const mejorVendedor = ordenados[0]?.nombre
  const conConversion = ordenados.filter((v) => v.conversion !== null && v.conversion !== undefined)
  const conversionPromedio = conConversion.length
    ? conConversion.reduce((s, v) => s + Number(v.conversion), 0) / conConversion.length
    : null

  function exportar() {
    const filas = ordenados.map((v) => ({
      Vendedor: v.nombre,
      Ventas: Number(v.ventas_total || 0),
      'N° cobros': v.n_ventas || 0,
      'Leads asignados': v.leads_asignados || 0,
      'Leads convertidos': v.leads_convertidos || 0,
      'Conversión': v.conversion !== null && v.conversion !== undefined ? `${Math.round(v.conversion * 100)}%` : '',
      'Meta diaria': v.meta_diaria || '',
    }))
    descargarCSV(`comercial-${rango.desde}_a_${rango.hasta}`, filas)
  }

  const cargando = q.isLoading
  const error = q.error

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-extrabold">🎯 Comercial</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Ranking de vendedores, ventas y conversión de leads por asesor.</div>
        </div>
        <button onClick={exportar} disabled={!ordenados.length}
          className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-4 py-2 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-40">⬇ Exportar</button>
      </div>

      <div className="mt-4"><RangoFechas value={rango} onChange={setRango} defaultPreset="mes" /></div>

      {cargando && <div className="py-10 text-center text-[12.5px] font-semibold text-muted">Cargando…</div>}

      {error && rpcFaltante(error) && (
        <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-semibold text-amber-800">
          Este reporte necesita que se aplique la migración de base de datos en Supabase
          (<span className="font-mono text-[11.5px]">reporte_comercial</span>). Una vez aplicada, aparecerá aquí.
        </div>
      )}
      {error && !rpcFaltante(error) && (
        <div className="mt-4 rounded-[10px] bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red">No se pudo cargar: {error.message}</div>
      )}

      {!cargando && !error && ordenados.length === 0 && (
        <div className="mt-4 rounded-[10px] bg-surface px-4 py-8 text-center text-[12.5px] font-semibold text-muted">
          Aún no hay ventas en el período.
        </div>
      )}

      {!cargando && !error && ordenados.length > 0 && (
        <div className="mt-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Ventas del equipo" valor={money(ventasEquipo, moneda)} color={T.primary} />
            <StatCard label="Mejor vendedor" valor={mejorVendedor || '—'} />
            <StatCard label="Conversión promedio" valor={conversionPromedio !== null ? `${Math.round(conversionPromedio * 100)}%` : '—'} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr className="text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-muted">
                  <th className="px-2 py-2 text-left">Vendedor</th>
                  <th className="px-2 py-2 text-right">Ventas</th>
                  <th className="px-2 py-2 text-center">Nº cobros</th>
                  <th className="px-2 py-2 text-center">Conversión</th>
                  <th className="px-2 py-2 text-right">Meta diaria</th>
                </tr>
              </thead>
              <tbody>
                {ordenados.map((v, i) => {
                  const badge = conversionBadge(v.conversion)
                  return (
                    <tr key={v.usuario_id} className="border-t border-line2">
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className="w-5 text-center text-[13px]">{MEDALLA[i] || `${i + 1}.`}</span>
                          <Avatar ini={iniciales(v.nombre)} bg={T.chipNavy} color={T.navy} size={30} fontSize={11} />
                          <div className="min-w-0 truncate text-[13px] font-extrabold">{v.nombre}</div>
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right text-[13px] font-extrabold text-ink">{money(v.ventas_total, moneda)}</td>
                      <td className="px-2 py-2.5 text-center text-[13px] font-bold">{v.n_ventas || '—'}</td>
                      <td className="px-2 py-2.5 text-center">
                        <span className="rounded-full px-2.5 py-0.5 text-[12px] font-extrabold" style={{ background: badge.bg, color: badge.color }}>{badge.label}</span>
                      </td>
                      <td className="px-2 py-2.5 text-right text-[13px] font-bold text-muted">{v.meta_diaria ? money(v.meta_diaria, moneda) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] font-semibold text-faint">Las ventas se atribuyen a quien registró el cobro.</div>
        </div>
      )}
    </Card>
  )
}
