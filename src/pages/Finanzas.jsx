import { useState } from 'react'
import { Card, StatCard } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { toast } from '../lib/toast.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useFinanzas } from '../hooks/useOperaciones.js'
import { money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

export default function Finanzas() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa, rol } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const { data, isLoading, error, refetch } = useFinanzas(sedeId)
  const [anulando, setAnulando] = useState(null)
  const [busyAnular, setBusyAnular] = useState(false)

  // Anular = contra-asiento que lo neutraliza (nada se borra de la caja)
  async function anular(mv) {
    setBusyAnular(true)
    const { error } = await supabase.rpc('anular_movimiento_financiero', { p_id: mv.id })
    setBusyAnular(false)
    setAnulando(null)
    if (error) toast.error('No se pudo anular: ' + error.message)
    else { toast.ok('Movimiento anulado con contra-asiento'); refetch() }
  }

  const movs = data || []
  const esteMes = (m) => new Date(m.fecha).getMonth() === new Date().getMonth()
  const ingresos = movs.filter((m) => m.tipo === 'ingreso' && esteMes(m)).reduce((n, m) => n + Number(m.monto || 0), 0)
  const gastos = movs.filter((m) => m.tipo === 'gasto' && esteMes(m)).reduce((n, m) => n + Number(m.monto || 0), 0)
  const utilidad = ingresos - gastos

  return (
    <div className="px-7 pb-9 pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Finanzas</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">{sedeNombre}</p>

      <div className="mt-5 grid grid-cols-4 gap-[15px]">
        <StatCard label="Ingresos del mes" value={money(ingresos, moneda)} delta=" " deltaColor={T.success} />
        <StatCard label="Gastos del mes" value={money(gastos, moneda)} delta="planilla, compras, servicios" />
        <div className="rounded-card border border-line bg-white p-[17px]">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">Utilidad del mes</div>
          <div className="mt-1.5 text-[26px] font-extrabold" style={{ color: utilidad >= 0 ? T.success : T.danger }}>{money(utilidad, moneda)}</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">{ingresos ? `margen ${Math.round((utilidad / ingresos) * 100)}%` : '—'}</div>
        </div>
        <StatCard label="Movimientos" value={movs.length} delta="registrados" variant="accent" />
      </div>

      {isLoading && <LoadingState variant="table" rows={5} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && movs.length === 0 && <EmptyState message="Sin movimientos financieros en esta sede." />}

      {movs.length > 0 && (
        <Card className="mt-[15px] p-[19px]">
          <div className="mb-1.5 text-[14.5px] font-extrabold">Últimos movimientos</div>
          {movs.map((mv) => (
            <div key={mv.id} className="flex items-center justify-between gap-2.5 border-b border-line2 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold">{mv.descripcion || mv.categoria}</div>
                <div className="text-[11.5px] font-semibold text-muted capitalize">
                  {mv.categoria} · {new Date(mv.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
                  {mv.metodo_pago && <span className="ml-1.5 rounded-full bg-surface px-2 py-0.5 text-[10px] font-extrabold text-muted">{mv.metodo_pago}</span>}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2.5">
                <div className="text-[13px] font-extrabold" style={{ color: mv.tipo === 'ingreso' ? T.success : T.danger }}>
                  {mv.tipo === 'ingreso' ? '+' : '−'}{money(mv.monto, moneda)}
                </div>
                {rol === 'admin' && !(mv.descripcion || '').startsWith('ANULACIÓN:') && (
                  anulando === mv.id ? (
                    <div className="flex items-center gap-1.5">
                      <button disabled={busyAnular} onClick={() => anular(mv)}
                        className="cursor-pointer rounded-[8px] border-none bg-red px-2.5 py-1.5 text-[10.5px] font-extrabold text-white disabled:opacity-50">Anular</button>
                      <button onClick={() => setAnulando(null)}
                        className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[10.5px] font-extrabold text-muted">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setAnulando(mv.id)} title="Anular con contra-asiento (auditable, nada se borra)"
                      className="cursor-pointer rounded-lg border-none bg-transparent px-1.5 text-[11.5px] font-extrabold text-faint hover:text-red">
                      ✕
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
