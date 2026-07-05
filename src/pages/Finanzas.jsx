import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, StatCard } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { toast } from '../lib/toast.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useFinanzas } from '../hooks/useOperaciones.js'
import { money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

// ── Caja del día: abrir con fondo inicial, cerrar contando el efectivo ──────
// esperado = fondo inicial + ingresos en efectivo − gastos en efectivo (hoy)
function CajaDelDia({ sedeId, empresaId, usuarioId, movs, moneda, esAdmin }) {
  const qc = useQueryClient()
  const hoy = new Date().toISOString().slice(0, 10)
  const [montoApertura, setMontoApertura] = useState('')
  const [contado, setContado] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [cerrando, setCerrando] = useState(false)

  const caja = useQuery({
    queryKey: ['caja', sedeId, hoy],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.from('caja')
        .select('*').eq('sede_id', sedeId).eq('fecha', hoy).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const esHoy = (m) => new Date(m.fecha).toDateString() === new Date().toDateString()
  const efectivoHoy = movs.filter((m) => esHoy(m) && (m.metodo_pago === 'efectivo' || !m.metodo_pago))
    .reduce((n, m) => n + (m.tipo === 'ingreso' ? 1 : -1) * Number(m.monto || 0), 0)
  const c = caja.data
  const esperado = c ? Number(c.saldo_inicial || 0) + efectivoHoy : null
  const diferencia = c?.estado === 'cerrada' ? Number(c.saldo_final || 0) - esperado
    : contado !== '' ? Number(contado) - esperado : null

  async function abrir() {
    setAbriendo(true)
    const { error } = await supabase.from('caja').insert({
      empresa_id: empresaId, sede_id: sedeId, fecha: hoy,
      saldo_inicial: Number(montoApertura) || 0, estado: 'abierta', abierta_por: usuarioId,
    })
    setAbriendo(false)
    if (error) { toast.error('No se pudo abrir la caja: ' + error.message); return }
    toast.ok('Caja abierta — ¡buen turno! 💪')
    qc.invalidateQueries({ queryKey: ['caja', sedeId, hoy] })
  }

  async function cerrar() {
    setCerrando(true)
    const { error } = await supabase.from('caja')
      .update({ saldo_final: Number(contado) || 0, estado: 'cerrada', cerrada_por: usuarioId })
      .eq('id', c.id)
    setCerrando(false)
    if (error) { toast.error('No se pudo cerrar: ' + error.message); return }
    toast.ok('Caja cerrada y cuadrada')
    qc.invalidateQueries({ queryKey: ['caja', sedeId, hoy] })
  }

  if (caja.isLoading) return null

  return (
    <Card className="mt-5 p-[19px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[14.5px] font-extrabold">
            🧰 Caja del día {c?.estado === 'cerrada' ? '· cerrada ✓' : c ? '· abierta' : ''}
          </div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">
            {new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' })} · solo efectivo (Yape/tarjeta cuadran solos)
          </div>
        </div>

        {!c && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-bold">Fondo inicial S/</span>
            <input type="number" step="0.01" min="0" value={montoApertura} onChange={(e) => setMontoApertura(e.target.value)}
              placeholder="100" className="w-[90px] rounded-[9px] border border-line bg-white px-2.5 py-2 text-[13px] font-extrabold outline-none focus:border-orange" />
            <button onClick={abrir} disabled={abriendo || montoApertura === ''}
              className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
              Abrir caja
            </button>
          </div>
        )}
      </div>

      {c && (
        <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line2 pt-3">
          <div><span className="text-[11px] font-extrabold uppercase text-muted">Fondo inicial</span>
            <div className="text-[15px] font-extrabold">{money(c.saldo_inicial, moneda)}</div></div>
          <div><span className="text-[11px] font-extrabold uppercase text-muted">Efectivo del día</span>
            <div className="text-[15px] font-extrabold" style={{ color: efectivoHoy >= 0 ? T.success : T.danger }}>
              {efectivoHoy >= 0 ? '+' : ''}{money(efectivoHoy, moneda)}</div></div>
          <div><span className="text-[11px] font-extrabold uppercase text-muted">Debe haber en caja</span>
            <div className="text-[15px] font-extrabold text-orange">{money(esperado, moneda)}</div></div>

          {c.estado === 'abierta' ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-bold">Conté S/</span>
              <input type="number" step="0.01" min="0" value={contado} onChange={(e) => setContado(e.target.value)}
                placeholder={String(esperado)} className="w-[100px] rounded-[9px] border border-line bg-white px-2.5 py-2 text-[13px] font-extrabold outline-none focus:border-orange" />
              {diferencia !== null && (
                <span className={`text-[12px] font-extrabold ${Math.abs(diferencia) < 0.01 ? 'text-green-600' : 'text-red'}`}>
                  {Math.abs(diferencia) < 0.01 ? 'cuadra ✓' : (diferencia > 0 ? 'sobran ' : 'faltan ') + money(Math.abs(diferencia), moneda)}
                </span>
              )}
              <button onClick={cerrar} disabled={cerrando || contado === ''}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-4 py-2 text-[12.5px] font-extrabold text-ink hover:border-orange disabled:opacity-50">
                Cerrar caja
              </button>
            </div>
          ) : (
            <div className="ml-auto text-right">
              <span className="text-[11px] font-extrabold uppercase text-muted">Contado al cierre</span>
              <div className="text-[15px] font-extrabold">
                {money(c.saldo_final, moneda)}{' '}
                <span className={`text-[12px] ${Math.abs(diferencia) < 0.01 ? 'text-green-600' : 'text-red'}`}>
                  ({Math.abs(diferencia) < 0.01 ? 'cuadró ✓' : (diferencia > 0 ? 'sobraron ' : 'faltaron ') + money(Math.abs(diferencia), moneda)})
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      {!c && !esAdmin && null}
    </Card>
  )
}

const CAT_LABEL = {
  membresia: 'Membresías', venta_kardex: 'Venta de productos', compra: 'Compra de productos',
  planilla: 'Planilla (sueldos)', mantenimiento: 'Mantenimiento',
}
const catLabel = (c) => CAT_LABEL[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Otros')

export default function Finanzas() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa, rol, usuario } = useAuth()
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
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Finanzas</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">{sedeNombre}</p>

      {/* Caja del día: la rutina de recepción para cuadrar el efectivo */}
      <CajaDelDia sedeId={sedeId} empresaId={empresa?.id} usuarioId={usuario?.id}
        movs={movs} moneda={moneda} esAdmin={rol === 'admin'} />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
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
          <div className="overflow-x-auto">
            <div className="min-w-[520px]">
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
            </div>
          </div>
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
