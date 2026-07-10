import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Avatar } from '../ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { descargarCSV } from '../../lib/csv.js'
import { iniciales, fechaLocal, fechaCorta } from '../../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'
import RangoFechas, { rangoPreset } from './RangoFechas.jsx'
import { StatCard, Barras } from './charts.jsx'

function rpcFaltante(error) {
  if (!error) return false
  const m = `${error.code || ''} ${error.message || ''}`.toLowerCase()
  return m.includes('pgrst202') || m.includes('does not exist') || m.includes('could not find') || m.includes('not find the function')
}

const MEDALLA = ['🥇', '🥈', '🥉']
const TIPOS = [['ayuda', 'Ayudas'], ['carga', 'Cargas'], ['rutina', 'Rutinas'], ['dieta', 'Dietas']]

export default function ReporteAtenciones() {
  const [rango, setRango] = useState(() => rangoPreset('30'))

  const q = useQuery({
    queryKey: ['reporte-atenciones', rango.desde, rango.hasta],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reporte_atenciones', { p_desde: rango.desde, p_hasta: rango.hasta })
      if (error) throw error
      return (data || []).map((r) => ({ ...r, total: Number(r.total) }))
    },
    retry: false,
  })

  const rows = q.data || []

  // Ranking por persona con desglose por tipo
  const map = {}
  for (const r of rows) {
    const t = (map[r.usuario_id] ||= { usuario_id: r.usuario_id, nombre: r.nombre, rol: r.rol, ayuda: 0, carga: 0, rutina: 0, dieta: 0, total: 0 })
    t[r.tipo] += r.total
    t.total += r.total
  }
  const personas = Object.values(map).sort((a, b) => b.total - a.total)

  // Totales por tipo y tendencia diaria
  const tot = { ayuda: 0, carga: 0, rutina: 0, dieta: 0 }
  for (const r of rows) tot[r.tipo] += r.total
  const totalAtenciones = tot.ayuda + tot.carga + tot.rutina + tot.dieta

  const diaMap = {}
  for (const r of rows) diaMap[r.fecha] = (diaMap[r.fecha] || 0) + r.total
  const porDia = Object.entries(diaMap).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([fecha, total]) => ({ fecha, total }))

  function exportar() {
    const filas = personas.map((p) => ({
      Entrenador: p.nombre, Rol: p.rol, Ayudas: p.ayuda, Cargas: p.carga,
      Rutinas: p.rutina, Dietas: p.dieta, Total: p.total,
    }))
    descargarCSV(`atenciones-entrenadores-${rango.desde}_a_${rango.hasta}`, filas)
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-extrabold">🏅 Atenciones de entrenadores</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Ayudas y cargas atendidas + rutinas y dietas enviadas, por persona y período.</div>
        </div>
        <button onClick={exportar} disabled={!personas.length}
          className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-4 py-2 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-40">⬇ Exportar</button>
      </div>

      <div className="mt-4">
        <RangoFechas value={rango} onChange={setRango} defaultPreset="30" />
      </div>

      {q.isLoading && <div className="py-10 text-center text-[12.5px] font-semibold text-muted">Cargando…</div>}

      {q.error && rpcFaltante(q.error) && (
        <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-semibold text-amber-800">
          Este reporte necesita que se aplique la migración de base de datos en Supabase
          (<span className="font-mono text-[11.5px]">reporte_atenciones</span>). Una vez aplicada, aparecerá aquí.
        </div>
      )}
      {q.error && !rpcFaltante(q.error) && (
        <div className="mt-4 rounded-[10px] bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red">No se pudo cargar: {q.error.message}</div>
      )}

      {!q.isLoading && !q.error && totalAtenciones === 0 && (
        <div className="mt-4 rounded-[10px] bg-surface px-4 py-8 text-center text-[12.5px] font-semibold text-muted">
          Sin atenciones registradas en este período.
        </div>
      )}

      {!q.isLoading && !q.error && totalAtenciones > 0 && (
        <div className="mt-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Total atenciones" valor={totalAtenciones} color={T.primary} />
            {TIPOS.map(([k, l]) => <StatCard key={k} label={l} valor={tot[k]} />)}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse">
              <thead>
                <tr className="text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-muted">
                  <th className="px-2 py-2 text-left">Entrenador</th>
                  <th className="px-2 py-2 text-center">Ayudas</th>
                  <th className="px-2 py-2 text-center">Cargas</th>
                  <th className="px-2 py-2 text-center">Rutinas</th>
                  <th className="px-2 py-2 text-center">Dietas</th>
                  <th className="px-2 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {personas.map((p, i) => (
                  <tr key={p.usuario_id} className="border-t border-line2">
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 text-center text-[13px]">{MEDALLA[i] || `${i + 1}.`}</span>
                        <Avatar ini={iniciales(p.nombre)} bg={T.chipNavy} color={T.navy} size={30} fontSize={11} />
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-extrabold">{p.nombre}</div>
                          <div className="text-[10.5px] font-bold capitalize text-faint">{p.rol}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center text-[13px] font-bold">{p.ayuda || '—'}</td>
                    <td className="px-2 py-2.5 text-center text-[13px] font-bold">{p.carga || '—'}</td>
                    <td className="px-2 py-2.5 text-center text-[13px] font-bold">{p.rutina || '—'}</td>
                    <td className="px-2 py-2.5 text-center text-[13px] font-bold">{p.dieta || '—'}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[12.5px] font-extrabold text-orange">{p.total}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {porDia.length > 1 && (
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Atenciones por día</div>
              <Barras datos={porDia.map((x) => ({ label: fechaLocal(x.fecha).getDate().toString(), title: fechaCorta(x.fecha), total: x.total }))} />
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
