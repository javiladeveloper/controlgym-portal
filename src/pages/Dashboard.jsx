import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Topbar from '../components/Topbar.jsx'
import ChecklistActivacion from '../components/ChecklistActivacion.jsx'
import { Card, StatCard, Avatar } from '../components/ui.jsx'
import { BoxIcon, DocIcon, ClockIcon } from '../components/icons.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import Modal, { inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useDashboardKpis, useAsistenciaPorHora, useCheckins } from '../hooks/useDashboard.js'
import { useClientes } from '../hooks/useClientes.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'
import { iniciales, money } from '../lib/uiHelpers.js'

// Check-in manual desde recepción: busca al socio y registra entrada/salida.
function CheckinModal({ sedeId, onClose }) {
  const qc = useQueryClient()
  const { data: clientes } = useClientes(sedeId)
  const [q, setQ] = useState('')
  const [resultado, setResultado] = useState(null) // { resultado, motivo, socio }
  const [busy, setBusy] = useState(false)

  const matches = (clientes || []).filter(
    (c) => q.trim() && (c.nombre.toLowerCase().includes(q.toLowerCase()) || c.codigo?.includes(q)),
  ).slice(0, 6)

  async function registrar(socio, direccion) {
    setBusy(true)
    const { data, error } = await supabase.rpc('checkin_manual', {
      p_socio_id: socio.id, p_sede_id: sedeId, p_direccion: direccion,
    })
    setBusy(false)
    if (error) { setResultado({ resultado: 'error', motivo: error.message, socio: socio.nombre }); return }
    setResultado(data)
    qc.invalidateQueries({ queryKey: ['checkins', sedeId] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
    qc.invalidateQueries({ queryKey: ['asistencia-hora', sedeId] })
  }

  return (
    <Modal title="Check-in de recepción" subtitle="Busca al socio y registra su entrada o salida" onClose={onClose} width={440}>
      {resultado ? (
        <div>
          <div className={`rounded-[10px] p-4 text-center ${resultado.resultado === 'permitido' ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className={`text-[22px] font-extrabold ${resultado.resultado === 'permitido' ? 'text-green-600' : 'text-red'}`}>
              {resultado.resultado === 'permitido' ? '✓ Acceso permitido' : '✕ Acceso denegado'}
            </div>
            <div className="mt-1 text-[14px] font-bold">{resultado.socio}</div>
            {resultado.motivo && (
              <div className="mt-1.5 text-[12.5px] font-bold text-red">
                {resultado.motivo === 'membresia_vencida' ? 'Membresía vencida — ofrécele renovar' : resultado.motivo}
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2.5">
            <button onClick={() => { setResultado(null); setQ('') }}
              className="flex-1 cursor-pointer rounded-[10px] border border-line bg-white py-2.5 text-[13px] font-extrabold text-muted hover:border-orange">Otro socio</button>
            <button onClick={onClose}
              className="flex-1 cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600">Listo</button>
          </div>
        </div>
      ) : (
        <div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className={inputCls}
            placeholder="Nombre o N.º de socio…" />
          <div className="mt-2.5 flex flex-col gap-1.5">
            {matches.map((c) => {
              const mem = c.membresia?.[0]
              const activa = mem?.estado === 'activa'
              return (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-extrabold">{c.nombre}</div>
                    <div className="text-[11px] font-semibold text-muted">
                      N.º {c.codigo} · {mem ? `${mem.plan?.nombre || 'Plan'} ${activa ? 'activa' : mem.estado}` : 'sin membresía'}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1.5">
                    <button disabled={busy} onClick={() => registrar(c, 'entrada')}
                      className="cursor-pointer rounded-lg border-none bg-green px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50">Entrada</button>
                    <button disabled={busy} onClick={() => registrar(c, 'salida')}
                      className="cursor-pointer rounded-lg border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted hover:border-orange disabled:opacity-50">Salida</button>
                  </div>
                </div>
              )
            })}
            {q.trim() && matches.length === 0 && (
              <div className="rounded-[10px] bg-surface px-3 py-4 text-center text-[12.5px] font-semibold text-muted">
                No se encontró. ¿Es nuevo? Inscríbelo desde Clientes.
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

function hourColor(count, max) {
  const ratio = max ? count / max : 0
  return ratio >= 0.8 ? T.primary : ratio >= 0.5 ? T.primarySoft : T.primaryTint
}

// Etiquetas 6a..8p para las 15 franjas horarias (6:00–20:00)
const HORAS = Array.from({ length: 15 }, (_, i) => {
  const h = 6 + i
  const label = h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`
  return { h, label }
})

export default function Dashboard() {
  const { sedeId, sedeNombre } = usePanel()
  const { usuario, empresa } = useAuth()
  const [checkinOpen, setCheckinOpen] = useState(false)
  const kpis = useDashboardKpis(sedeId)
  const horas = useAsistenciaPorHora(sedeId)
  const checkins = useCheckins(sedeId)

  const nombre = usuario?.nombre?.split(' ')[0] || ''
  const moneda = empresa?.moneda || 'PEN'

  // Mapear asistencia por hora al arreglo de 15 franjas
  const horaMap = new Map((horas.data || []).map((r) => [r.hora, Number(r.total)]))
  const barras = HORAS.map(({ h, label }) => ({ label, count: horaMap.get(h) || 0 }))
  const maxCount = Math.max(1, ...barras.map((b) => b.count))

  return (
    <div className="px-7 pb-9 pt-6">
      <Topbar title={`Buen día${nombre ? ', ' + nombre : ''}`} subtitle={sedeNombre} />

      {/* Primeros pasos del negocio (desaparece al completarse) */}
      <ChecklistActivacion />

      {/* KPIs */}
      {kpis.isLoading && <LoadingState variant="kpis" />}
      {kpis.error && <ErrorState error={kpis.error} onRetry={kpis.refetch} />}
      {kpis.data && (
        <div className="mt-[22px] grid grid-cols-4 gap-[15px]">
          <StatCard label="En la sede ahora" value={kpis.data.en_sede_hoy ?? 0}
            delta={kpis.data.aforo_max ? `aforo ${Math.round((kpis.data.en_sede_hoy / kpis.data.aforo_max) * 100)}%` : ' '} />
          <StatCard label="Socios activos" value={kpis.data.socios_activos ?? 0} delta=" " deltaColor={T.success} />
          <StatCard label="Ingresos del mes" value={money(kpis.data.ingresos_mes, moneda)} delta=" " deltaColor={T.success} />
          <div className="rounded-card border border-orange-100 bg-orange-50 p-[17px]">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-orange">Por vencer (7 días)</div>
            <div className="mt-1.5 text-[27px] font-extrabold text-orange">{kpis.data.por_vencer_7d ?? 0}</div>
            <div className="mt-0.5 text-[12px] font-bold text-muted">membresías</div>
          </div>
        </div>
      )}

      {/* Chart + live check-ins */}
      <div className="mt-[15px] grid grid-cols-[1.55fr_1fr] gap-[15px]">
        <Card className="p-[19px]">
          <div className="text-[14.5px] font-extrabold">Asistencia de hoy por hora</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">6:00 am — 8:00 pm</div>
          <div className="mt-4 flex h-[180px] items-stretch gap-[7px]">
            {barras.map((b) => (
              <div key={b.label} className="flex flex-1 flex-col items-center justify-end gap-1.5">
                <div className="w-full rounded-t-[6px]" style={{ height: `${Math.round((b.count / maxCount) * 100)}%`, minHeight: 2, background: hourColor(b.count, maxCount) }} title={`${b.count} socios`} />
                <div className="text-[9.5px] font-bold text-faint">{b.label}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col p-[19px]">
          <div className="flex items-center justify-between">
            <div className="text-[14.5px] font-extrabold">Check-ins</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setCheckinOpen(true)}
                className="cursor-pointer rounded-[9px] border-none bg-orange px-3 py-1.5 text-[11.5px] font-extrabold text-white hover:bg-orange-600">
                + Registrar
              </button>
              <div className="flex items-center gap-1.5 rounded-full bg-orange-50 px-[11px] py-1">
                <span className="h-[7px] w-[7px] animate-pulseDot rounded-full bg-orange" />
                <span className="text-[10.5px] font-extrabold tracking-[0.8px] text-orange">EN VIVO</span>
              </div>
            </div>
          </div>
          {checkinOpen && <CheckinModal sedeId={sedeId} onClose={() => setCheckinOpen(false)} />}
          <div className="mt-2 flex-1 overflow-hidden">
            {checkins.isLoading && <div className="py-4 text-[12.5px] font-semibold text-muted">Cargando…</div>}
            {checkins.data?.length === 0 && <div className="py-4 text-[12.5px] font-semibold text-muted">Sin check-ins hoy.</div>}
            {(checkins.data || []).map((c) => {
              const permit = c.resultado === 'permitido'
              return (
                <div key={c.id} className="flex animate-fadeSlide items-center gap-2.5 border-b border-line2 py-[9.5px]">
                  <Avatar ini={iniciales(c.socio?.nombre || '?')} bg={permit ? T.chipNavy : T.dangerBg} color={permit ? T.navy : T.danger} size={34} fontSize={12} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-extrabold text-ink">{c.socio?.nombre || 'Desconocido'}</div>
                    <div className="text-[11px] font-bold" style={{ color: permit ? T.faint : T.danger }}>
                      {permit ? 'Huella verificada' : (c.motivo || 'Acceso denegado')}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[12px] font-extrabold text-ink">
                      {new Date(c.ocurrido_en).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-[10.5px] font-extrabold capitalize" style={{ color: permit ? T.success : T.danger }}>{c.direccion}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Alertas */}
      <div className="mt-[15px] grid grid-cols-3 gap-[15px]">
        <Card className="flex items-center gap-3 p-[15px]">
          <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-orange-50"><BoxIcon stroke={T.primary} /></div>
          <div className="text-[12.5px] font-bold leading-[1.45] text-ink">Revisa el <span className="font-extrabold">Kardex</span> para productos con stock bajo</div>
        </Card>
        <Card className="flex items-center gap-3 p-[15px]">
          <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-chipnavy"><DocIcon stroke={T.navy} /></div>
          <div className="text-[12.5px] font-bold leading-[1.45] text-ink">Socios esperando <span className="font-extrabold">rutina nueva</span> esta semana</div>
        </Card>
        <Card className="flex items-center gap-3 p-[15px]">
          <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-green-50"><ClockIcon stroke={T.success} /></div>
          <div className="text-[12.5px] font-bold leading-[1.45] text-ink">Revisa la <span className="font-extrabold">caja del día</span> en Finanzas</div>
        </Card>
      </div>
    </div>
  )
}
