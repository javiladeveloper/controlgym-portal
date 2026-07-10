import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { usePanel } from '../../store.jsx'
import { descargarCSV } from '../../lib/csv.js'
import { fechaLocal, fechaCorta, DAY_NAMES, DAY_LETTER } from '../../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'
import RangoFechas, { rangoPreset } from './RangoFechas.jsx'
import { StatCard, Barras } from './charts.jsx'

// ¿El error es "la RPC no existe todavía" (migración sin aplicar)?
function rpcFaltante(error) {
  if (!error) return false
  const m = `${error.code || ''} ${error.message || ''}`.toLowerCase()
  return m.includes('pgrst202') || m.includes('does not exist') || m.includes('could not find') || m.includes('not find the function')
}

const dowDe = (fecha) => ((fechaLocal(fecha).getDay() + 6) % 7) + 1 // 1=Lunes … 7=Domingo
const fmtHora = (h) => `${String(h).padStart(2, '0')}:00`

// Mapa de calor día de la semana (filas) × hora (columnas).
function Heatmap({ heat, heatMax, horas }) {
  const color = (v) => (!v ? T.surface : `rgba(255,107,53,${(0.15 + 0.85 * (v / heatMax)).toFixed(2)})`)
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex gap-[3px] pl-7">
          {horas.map((h) => <div key={h} className="w-[18px] text-center text-[8.5px] font-bold text-faint">{h}</div>)}
        </div>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => (
          <div key={d} className="mt-[3px] flex items-center gap-[3px]">
            <div className="w-6 text-[10px] font-extrabold text-muted">{DAY_LETTER[d]}</div>
            {horas.map((h) => {
              const v = heat[`${d}-${h}`] || 0
              return <div key={h} className="h-[18px] w-[18px] rounded-[3px]" style={{ background: color(v) }} title={`${DAY_NAMES[d]} ${fmtHora(h)}: ${v}`} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ReporteAsistencias() {
  const { sedeId, sedeNombre } = usePanel()
  const [rango, setRango] = useState(() => rangoPreset('30'))
  const [hDesde, setHDesde] = useState(0)
  const [hHasta, setHHasta] = useState(23)

  const q = useQuery({
    queryKey: ['reporte-asistencias', sedeId, rango.desde, rango.hasta],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reporte_asistencias', {
        p_sede_id: sedeId, p_desde: rango.desde, p_hasta: rango.hasta,
      })
      if (error) throw error
      return (data || []).map((r) => ({ ...r, total: Number(r.total) }))
    },
    retry: false,
  })

  const rows = q.data || []
  const enHoras = rows.filter((r) => r.hora >= hDesde && r.hora <= hHasta)

  // Rango de horas con actividad (para no dibujar 24 columnas vacías)
  const horasAct = rows.filter((r) => r.total > 0).map((r) => r.hora)
  const hMin = horasAct.length ? Math.min(...horasAct) : 6
  const hMax = horasAct.length ? Math.max(...horasAct) : 22
  const horasEje = Array.from({ length: hMax - hMin + 1 }, (_, i) => hMin + i)

  const totalFiltrado = enHoras.reduce((s, r) => s + r.total, 0)
  const diasRango = Math.max(1, Math.round((fechaLocal(rango.hasta) - fechaLocal(rango.desde)) / 86400000) + 1)
  const promedioDia = Math.round(totalFiltrado / diasRango)

  const porHora = horasEje.map((h) => ({ h, total: rows.filter((r) => r.hora === h).reduce((s, r) => s + r.total, 0) }))
  const horaPico = porHora.reduce((a, b) => (b.total > a.total ? b : a), { h: null, total: 0 })

  const dowTot = {}
  for (const r of enHoras) { const d = dowDe(r.fecha); dowTot[d] = (dowTot[d] || 0) + r.total }
  const porDow = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ d, total: dowTot[d] || 0 }))
  const dowPico = porDow.reduce((a, b) => (b.total > a.total ? b : a), { d: null, total: 0 })

  const diaMap = {}
  for (const r of enHoras) diaMap[r.fecha] = (diaMap[r.fecha] || 0) + r.total
  const porDia = Object.entries(diaMap).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([fecha, total]) => ({ fecha, total }))
  const diaPico = porDia.reduce((a, b) => (b.total > a.total ? b : a), { fecha: null, total: 0 })

  const heat = {}; let heatMax = 0
  for (const r of rows) { const k = `${dowDe(r.fecha)}-${r.hora}`; heat[k] = (heat[k] || 0) + r.total; if (heat[k] > heatMax) heatMax = heat[k] }

  const filtraHoras = hDesde > 0 || hHasta < 23

  function exportar() {
    const filas = porDia.map((d) => ({ Fecha: d.fecha, 'Día': DAY_NAMES[dowDe(d.fecha)], Asistencias: d.total }))
    descargarCSV(`asistencias-${sedeNombre?.replace(/\s+/g, '-').toLowerCase() || 'sede'}-${rango.desde}_a_${rango.hasta}`, filas)
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-extrabold">📊 Asistencias</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Entradas registradas en {sedeNombre}. Elige el período y, si quieres, un rango de horas.</div>
        </div>
        <button onClick={exportar} disabled={!porDia.length}
          className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-4 py-2 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-40">⬇ Exportar</button>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <RangoFechas value={rango} onChange={setRango} defaultPreset="30" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Horas</span>
          <select value={hDesde} onChange={(e) => setHDesde(Math.min(Number(e.target.value), hHasta))}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-bold outline-none focus:border-orange">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHora(h)}</option>)}
          </select>
          <span className="text-[12px] font-bold text-faint">a</span>
          <select value={hHasta} onChange={(e) => setHHasta(Math.max(Number(e.target.value), hDesde))}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12.5px] font-bold outline-none focus:border-orange">
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{fmtHora(h)}</option>)}
          </select>
          {filtraHoras && <button onClick={() => { setHDesde(0); setHHasta(23) }} className="cursor-pointer text-[11.5px] font-extrabold text-orange">Todo el día</button>}
        </div>
      </div>

      {q.isLoading && <div className="py-10 text-center text-[12.5px] font-semibold text-muted">Cargando…</div>}

      {q.error && rpcFaltante(q.error) && (
        <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-semibold text-amber-800">
          Este reporte necesita que se aplique la migración de base de datos en Supabase
          (<span className="font-mono text-[11.5px]">reporte_asistencias</span>). Una vez aplicada, aparecerá aquí.
        </div>
      )}
      {q.error && !rpcFaltante(q.error) && (
        <div className="mt-4 rounded-[10px] bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red">No se pudo cargar: {q.error.message}</div>
      )}

      {!q.isLoading && !q.error && totalFiltrado === 0 && (
        <div className="mt-4 rounded-[10px] bg-surface px-4 py-8 text-center text-[12.5px] font-semibold text-muted">
          Sin asistencias en este período{filtraHoras ? ' y rango de horas' : ''}.
        </div>
      )}

      {!q.isLoading && !q.error && totalFiltrado > 0 && (
        <div className="mt-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total asistencias" valor={totalFiltrado} color={T.primary} />
            <StatCard label="Promedio por día" valor={promedioDia} sub={`${diasRango} días`} />
            <StatCard label="Día más concurrido" valor={diaPico.fecha ? fechaCorta(diaPico.fecha) : '—'} sub={diaPico.fecha ? `${diaPico.total} asistencias` : ''} />
            <StatCard label="Hora pico" valor={horaPico.h != null ? fmtHora(horaPico.h) : '—'} sub={dowPico.d ? `Día top: ${DAY_NAMES[dowPico.d]}` : ''} />
          </div>

          <div>
            <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Por hora del día</div>
            <Barras datos={porHora.map((x) => ({ label: `${x.h}`, title: fmtHora(x.h), total: x.total, on: x.h >= hDesde && x.h <= hHasta }))} />
            {filtraHoras && <p className="mt-1 text-[11px] font-semibold text-faint">En naranja fuerte, el rango de horas seleccionado.</p>}
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Por día de la semana</div>
              <Barras datos={porDow.map((x) => ({ label: DAY_LETTER[x.d], title: DAY_NAMES[x.d], total: x.total }))} />
            </div>
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Mapa de calor · día × hora</div>
              <Heatmap heat={heat} heatMax={heatMax} horas={horasEje} />
            </div>
          </div>

          {porDia.length > 1 && (
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Por día{filtraHoras ? ` (${fmtHora(hDesde)}–${fmtHora(hHasta)})` : ''}</div>
              <Barras datos={porDia.map((x) => ({ label: fechaLocal(x.fecha).getDate().toString(), title: fechaCorta(x.fecha), total: x.total }))} />
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
