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

const CAT_LABEL = {
  membresia: 'Membresías', venta_kardex: 'Venta de productos', compra: 'Compra de productos',
  planilla: 'Planilla (sueldos)', mantenimiento: 'Mantenimiento',
}
const catLabel = (c) => CAT_LABEL[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Otros')

export default function Finanzas() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa, rol } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const { data, isLoading, error, refetch } = useFinanzas(sedeId)
  const [anulando, setAnulando] = useState(null)
  const [busyAnular, setBusyAnular] = useState(false)
  const [fTipo, setFTipo] = useState('todos')     // todos | ingreso | gasto
  const [fCat, setFCat] = useState('todas')       // todas | <categoria>

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

  // Desglose del mes por categoría (en qué entró y salió la plata)
  const porCategoria = {}
  for (const m of movs.filter(esteMes)) {
    const c = m.categoria || 'otro'
    porCategoria[c] = porCategoria[c] || { ingreso: 0, gasto: 0 }
    porCategoria[c][m.tipo] += Number(m.monto || 0)
  }
  const desglose = Object.entries(porCategoria).sort((a, b) => (b[1].ingreso + b[1].gasto) - (a[1].ingreso + a[1].gasto))

  const categorias = [...new Set(movs.map((m) => m.categoria || 'otro'))]
  const movsFiltrados = movs.filter((m) =>
    (fTipo === 'todos' || m.tipo === fTipo) && (fCat === 'todas' || (m.categoria || 'otro') === fCat))

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

      {/* Desglose del mes: en qué entró y salió la plata */}
      {desglose.length > 0 && (
        <Card className="mt-[15px] p-[19px]">
          <div className="text-[14.5px] font-extrabold">¿En qué se movió la plata este mes?</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Haz clic en una categoría para filtrar los movimientos.</div>
          <div className="mt-3 grid grid-cols-[1.6fr_1fr_1fr_1fr] gap-3 border-b border-line2 pb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Categoría</div><div className="text-right">Ingresos</div><div className="text-right">Gastos</div><div className="text-right">Neto</div>
          </div>
          {desglose.map(([cat, v]) => {
            const neto = v.ingreso - v.gasto
            return (
              <button key={cat} onClick={() => setFCat(fCat === cat ? 'todas' : cat)}
                className={`grid w-full cursor-pointer grid-cols-[1.6fr_1fr_1fr_1fr] items-center gap-3 border-none bg-transparent px-0 py-2.5 text-left border-b border-line2 hover:bg-[#FAFBFC] ${fCat === cat ? 'bg-orange/5' : ''}`}>
                <div className="text-[13px] font-extrabold">{fCat === cat ? '● ' : ''}{catLabel(cat)}</div>
                <div className="text-right text-[13px] font-extrabold" style={{ color: v.ingreso ? T.success : T.faint }}>{v.ingreso ? '+' + money(v.ingreso, moneda) : '—'}</div>
                <div className="text-right text-[13px] font-extrabold" style={{ color: v.gasto ? T.danger : T.faint }}>{v.gasto ? '−' + money(v.gasto, moneda) : '—'}</div>
                <div className="text-right text-[13px] font-extrabold" style={{ color: neto >= 0 ? T.success : T.danger }}>{money(neto, moneda)}</div>
              </button>
            )
          })}
        </Card>
      )}

      {movs.length > 0 && (
        <Card className="mt-[15px] p-[19px]">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[14.5px] font-extrabold">Últimos movimientos <span className="font-bold text-faint">({movsFiltrados.length})</span></div>
            <div className="flex items-center gap-2">
              {[['todos', 'Todos'], ['ingreso', 'Ingresos'], ['gasto', 'Gastos']].map(([v, l]) => (
                <button key={v} onClick={() => setFTipo(v)}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-extrabold transition-colors ${fTipo === v ? 'border-orange bg-orange text-white' : 'border-line bg-white text-muted hover:border-orange'}`}>
                  {l}
                </button>
              ))}
              <select value={fCat} onChange={(e) => setFCat(e.target.value)}
                className="cursor-pointer rounded-full border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted">
                <option value="todas">Todas las categorías</option>
                {categorias.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
              </select>
            </div>
          </div>
          {movsFiltrados.length === 0 && (
            <div className="py-6 text-center text-[12.5px] font-bold text-faint">Sin movimientos con este filtro.</div>
          )}
          {movsFiltrados.map((mv) => (
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
