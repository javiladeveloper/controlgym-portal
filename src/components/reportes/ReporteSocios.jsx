import { useState } from 'react'
import { Card } from '../ui.jsx'
import { usePanel } from '../../store.jsx'
import { descargarCSV } from '../../lib/csv.js'
import { fechaCorta } from '../../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'
import { StatCard } from './charts.jsx'
import { useSociosKpis, useAusentes } from '../../hooks/useReportes.js'

function rpcFaltante(error) {
  if (!error) return false
  const m = `${error.code || ''} ${error.message || ''}`.toLowerCase()
  return m.includes('pgrst202') || m.includes('does not exist') || m.includes('could not find') || m.includes('not find the function')
}

const DIAS_OPCIONES = [7, 15, 30]

function soloDigitos(tel) {
  return (tel || '').replace(/\D/g, '')
}

function linkWhatsapp(tel, nombre) {
  const digitos = soloDigitos(tel)
  if (!digitos) return null
  const msg = `¡Hola ${nombre ? nombre.split(' ')[0] : ''}! Te extrañamos en el gym 💪 ¿Todo bien? Nos encantaría verte de nuevo por aquí.`
  return `https://wa.me/51${digitos}?text=${encodeURIComponent(msg)}`
}

export default function ReporteSocios() {
  const { sedeId, sedeNombre } = usePanel()
  const [dias, setDias] = useState(15)

  const kpis = useSociosKpis(sedeId)
  const ausentes = useAusentes(sedeId, dias)

  const data = kpis.data
  const nuevos30d = (data?.nuevos_30d || []).reduce((s, r) => s + Number(r.n || 0), 0)
  const congeladas = data?.congeladas || []
  const churn = data?.churn_6m || []

  function exportarAusentes() {
    const filas = (ausentes.data || []).map((a) => ({
      Socio: a.nombre, Código: a.codigo, Teléfono: a.telefono || '',
      'Última visita': a.ultima_visita || 'Nunca vino', 'Días ausente': a.dias_ausente ?? '',
    }))
    descargarCSV(`ausentes-${dias}d-${sedeNombre?.replace(/\s+/g, '-').toLowerCase() || 'sede'}`, filas)
  }

  const cargando = kpis.isLoading
  const error = kpis.error

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-extrabold">👥 Socios</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Actividad, permanencia y socios que hay que recuperar en {sedeNombre}.</div>
        </div>
      </div>

      {cargando && <div className="py-10 text-center text-[12.5px] font-semibold text-muted">Cargando…</div>}

      {error && rpcFaltante(error) && (
        <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-semibold text-amber-800">
          Este reporte necesita que se aplique la migración de base de datos en Supabase
          (<span className="font-mono text-[11.5px]">reporte_socios_kpis</span>). Una vez aplicada, aparecerá aquí.
        </div>
      )}
      {error && !rpcFaltante(error) && (
        <div className="mt-4 rounded-[10px] bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red">No se pudo cargar: {error.message}</div>
      )}

      {!cargando && !error && data && (
        <div className="mt-5 flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Activos" valor={data.total_activos ?? 0} color={T.primary} />
            <StatCard label="Nuevos (30 días)" valor={nuevos30d} />
            <StatCard label="Congeladas" valor={congeladas.length} />
          </div>

          {churn.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Vencimientos y renovación · últimos 6 meses</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse">
                  <thead>
                    <tr className="text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-muted">
                      <th className="px-2 py-2 text-left">Mes</th>
                      <th className="px-2 py-2 text-center">Vencidas</th>
                      <th className="px-2 py-2 text-center">No renovadas</th>
                      <th className="px-2 py-2 text-center">Tasa de renovación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {churn.map((c) => {
                      const tasaRenovacion = 1 - Number(c.tasa || 0)
                      return (
                        <tr key={c.mes} className="border-t border-line2">
                          <td className="px-2 py-2.5 text-[13px] font-extrabold">{c.mes}</td>
                          <td className="px-2 py-2.5 text-center text-[13px] font-bold">{c.vencidas}</td>
                          <td className="px-2 py-2.5 text-center text-[13px] font-bold">{c.no_renovadas}</td>
                          <td className="px-2 py-2.5 text-center">
                            <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-extrabold ${tasaRenovacion >= 0.7 ? 'bg-green-50 text-green' : tasaRenovacion >= 0.4 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red'}`}>
                              {Math.round(tasaRenovacion * 100)}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Ausentes</div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1">
                  {DIAS_OPCIONES.map((d) => (
                    <button key={d} onClick={() => setDias(d)}
                      className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition-colors ${dias === d ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
                      {d} días
                    </button>
                  ))}
                </div>
                <button onClick={exportarAusentes} disabled={!ausentes.data?.length}
                  className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-3.5 py-1.5 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-40">⬇ Exportar</button>
              </div>
            </div>

            {ausentes.isLoading && <div className="py-8 text-center text-[12.5px] font-semibold text-muted">Cargando…</div>}
            {ausentes.error && !rpcFaltante(ausentes.error) && (
              <div className="mt-3 rounded-[10px] bg-red-50 px-4 py-3 text-[12.5px] font-bold text-red">No se pudo cargar: {ausentes.error.message}</div>
            )}
            {!ausentes.isLoading && !ausentes.error && (ausentes.data || []).length === 0 && (
              <div className="mt-3 rounded-[10px] bg-surface px-4 py-8 text-center text-[12.5px] font-semibold text-muted">
                Nadie lleva {dias} días o más sin venir. 🎉
              </div>
            )}
            {!ausentes.isLoading && !ausentes.error && (ausentes.data || []).length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr className="text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-muted">
                      <th className="px-2 py-2 text-left">Socio</th>
                      <th className="px-2 py-2 text-left">Última visita</th>
                      <th className="px-2 py-2 text-center">Días ausente</th>
                      <th className="px-2 py-2 text-right">Contacto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ausentes.data.map((a) => {
                      const wa = linkWhatsapp(a.telefono, a.nombre)
                      const nuncaVino = a.ultima_visita == null
                      return (
                        <tr key={a.socio_id} className="border-t border-line2">
                          <td className="px-2 py-2.5">
                            <div className="text-[13px] font-extrabold">{a.nombre}</div>
                            <div className="text-[10.5px] font-bold text-faint">{a.codigo}</div>
                          </td>
                          <td className="px-2 py-2.5 text-[12.5px] font-semibold text-muted">
                            {nuncaVino ? <span className="font-bold text-amber-700">Nunca vino</span> : fechaCorta(a.ultima_visita)}
                          </td>
                          <td className="px-2 py-2.5 text-center text-[13px] font-bold">
                            {nuncaVino ? '—' : a.dias_ausente}
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            {wa ? (
                              <a href={wa} target="_blank" rel="noreferrer"
                                className="inline-block cursor-pointer rounded-[9px] border border-green bg-green-50 px-3 py-1.5 text-[11.5px] font-extrabold text-green transition-colors hover:bg-green-100">
                                WhatsApp
                              </a>
                            ) : (
                              <span className="text-[11px] font-semibold text-faint">Sin teléfono</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {congeladas.length > 0 && (
            <div>
              <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Membresías congeladas</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse">
                  <thead>
                    <tr className="text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-muted">
                      <th className="px-2 py-2 text-left">Socio</th>
                      <th className="px-2 py-2 text-left">Plan</th>
                      <th className="px-2 py-2 text-left">Desde → hasta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {congeladas.map((c, i) => (
                      <tr key={i} className="border-t border-line2">
                        <td className="px-2 py-2.5 text-[13px] font-extrabold">{c.socio}</td>
                        <td className="px-2 py-2.5 text-[12.5px] font-semibold text-muted">{c.plan}</td>
                        <td className="px-2 py-2.5 text-[12.5px] font-semibold text-muted">{fechaCorta(c.desde)} → {fechaCorta(c.hasta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
