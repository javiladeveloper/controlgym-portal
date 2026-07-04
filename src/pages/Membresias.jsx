import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { Card, Badge, GhostButton } from '../components/ui.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import PlanesModal from '../components/forms/PlanesModal.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePlanes, useMembresias, useToggleFreeze, useRenovar, useAnularMembresia } from '../hooks/useMembresias.js'
import { estadoBadge, money } from '../lib/uiHelpers.js'
import { waLink, msgRenovacion, msgRecibo } from '../lib/whatsapp.js'
import { toast } from '../lib/toast.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const METODOS_PAGO = [['efectivo', 'Efectivo'], ['yape', 'Yape'], ['plin', 'Plin'], ['tarjeta', 'Tarjeta (POS)'], ['transferencia', 'Transferencia']]

// Cuándo vencería si se renueva hoy (espejo de renew_membership: desde el
// vencimiento actual si aún no pasó, o desde hoy si ya venció)
function nuevaFechaFin(m) {
  const base = new Date(Math.max(new Date(m.fecha_fin).getTime(), Date.now()))
  const u = m.plan?.unidad
  if (u === 'dia') base.setDate(base.getDate() + 1)
  else if (u === 'trimestre') base.setMonth(base.getMonth() + 3)
  else if (u === 'anual') base.setFullYear(base.getFullYear() + 1)
  else base.setMonth(base.getMonth() + 1)
  return base
}

// El gym cobra en persona (efectivo/Yape/POS) y aquí lo deja registrado:
// renueva la membresía y el ingreso entra a caja con su método.
function CobrarModal({ m, moneda, renovar, gym, onClose }) {
  const [metodo, setMetodo] = useState('efectivo')
  const [exito, setExito] = useState(null) // { fecha_fin } tras cobrar
  const precio = Number(m.plan?.precio || 0)

  function confirmar() {
    renovar.mutate({ membresiaId: m.id, metodo }, {
      onSuccess: (data) => { toast.ok(`Cobro de ${money(precio, moneda)} registrado — ${m.socio?.nombre} renovado`); setExito(data) },
      onError: (e) => toast.error('No se pudo registrar: ' + e.message),
    })
  }

  if (exito) {
    const recibo = m.socio?.telefono && waLink(m.socio.telefono, msgRecibo({
      socio: m.socio.nombre, gym, concepto: `Renovación ${m.plan?.nombre}`,
      monto: precio, metodo: METODOS_PAGO.find(([v]) => v === metodo)?.[1], vence: exito.fecha_fin,
    }))
    return (
      <Modal title="Cobro registrado ✓" subtitle={m.socio?.nombre} onClose={onClose} width={400}>
        <div className="rounded-[10px] bg-green-50 p-4 text-center">
          <div className="text-[20px] font-extrabold text-green-600">{money(precio, moneda)}</div>
          <div className="mt-1 text-[12.5px] font-bold text-muted">
            Membresía renovada hasta el {exito.fecha_fin ? new Date(exito.fecha_fin).toLocaleDateString('es-PE') : '—'} · registrado en caja
          </div>
        </div>
        {recibo && (
          <a href={recibo} target="_blank" rel="noreferrer"
            className="mt-3 flex items-center justify-center gap-2 rounded-[10px] border-none py-2.5 text-[13px] font-extrabold text-white"
            style={{ background: '#1DA851' }}>
            📄 Enviar recibo por WhatsApp
          </a>
        )}
        <button onClick={onClose} className="mt-2.5 w-full cursor-pointer rounded-[10px] border border-line bg-white py-2.5 text-[13px] font-extrabold text-muted hover:border-orange">Listo</button>
      </Modal>
    )
  }

  return (
    <Modal title="Registrar cobro" subtitle={m.socio?.nombre} onClose={onClose} width={420}>
      <div className="flex flex-col gap-3.5">
        <div className="rounded-[10px] bg-surface px-3.5 py-3">
          <div className="flex justify-between text-[13px] font-bold text-muted">
            <span>{m.plan?.nombre}</span><span className="font-extrabold text-ink">{money(precio, moneda)}</span>
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] font-semibold text-muted">
            <span>Nuevo vencimiento</span>
            <span className="font-extrabold text-green-600">{nuevaFechaFin(m).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
        </div>
        <Campo label="¿Cómo pagó?">
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inputCls + ' cursor-pointer'}>
            {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
        <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted">
          El ingreso queda registrado en <b>Finanzas</b> como renovación de membresía.
        </p>
        <BotonesModal onCancel={onClose} busy={renovar.isPending} submitLabel={`Cobré ${money(precio, moneda)}`} onSubmit={confirmar} />
      </div>
    </Modal>
  )
}

// Saldo pendiente de una membresía pagada en partes
const saldoDe = (m) => Math.max(0, (Number(m.precio_pagado) || 0) + (Number(m.matricula_pagada) || 0) - (Number(m.monto_pagado) || 0))

// Registrar un abono de una membresía con saldo (pagos en partes)
function AbonarModal({ m, moneda, sedeId, gym, onClose }) {
  const qc = useQueryClient()
  const saldo = saldoDe(m)
  const [monto, setMonto] = useState(String(saldo))
  const [metodo, setMetodo] = useState('efectivo')
  const [busy, setBusy] = useState(false)
  const [exito, setExito] = useState(null) // { saldo } tras abonar
  const n = Number(monto) || 0

  async function confirmar() {
    setBusy(true)
    const { data, error } = await supabase.rpc('abonar_membresia', { p_membresia_id: m.id, p_monto: n, p_metodo_pago: metodo })
    setBusy(false)
    if (error) { toast.error('No se pudo registrar: ' + error.message); return }
    toast.ok(Number(data.saldo) > 0
      ? `Abono de ${money(n, moneda)} registrado — ${m.socio?.nombre} queda debiendo ${money(data.saldo, moneda)}`
      : `¡${m.socio?.nombre} canceló su membresía completa! ✓`)
    qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
    qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    setExito(data)
  }

  if (exito) {
    const recibo = m.socio?.telefono && waLink(m.socio.telefono, msgRecibo({
      socio: m.socio.nombre, gym, concepto: `Abono a membresía ${m.plan?.nombre || ''}`.trim(),
      monto: n, metodo: METODOS_PAGO.find(([v]) => v === metodo)?.[1], saldo: exito.saldo, vence: m.fecha_fin,
    }))
    return (
      <Modal title="Abono registrado ✓" subtitle={m.socio?.nombre} onClose={onClose} width={400}>
        <div className="rounded-[10px] bg-green-50 p-4 text-center">
          <div className="text-[20px] font-extrabold text-green-600">{money(n, moneda)}</div>
          <div className="mt-1 text-[12.5px] font-bold text-muted">
            {Number(exito.saldo) > 0 ? `Queda debiendo ${money(exito.saldo, moneda)}` : 'Membresía cancelada completa ✓'} · registrado en caja
          </div>
        </div>
        {recibo && (
          <a href={recibo} target="_blank" rel="noreferrer"
            className="mt-3 flex items-center justify-center gap-2 rounded-[10px] border-none py-2.5 text-[13px] font-extrabold text-white"
            style={{ background: '#1DA851' }}>
            📄 Enviar recibo por WhatsApp
          </a>
        )}
        <button onClick={onClose} className="mt-2.5 w-full cursor-pointer rounded-[10px] border border-line bg-white py-2.5 text-[13px] font-extrabold text-muted hover:border-orange">Listo</button>
      </Modal>
    )
  }

  return (
    <Modal title="Registrar abono" subtitle={m.socio?.nombre} onClose={onClose} width={400}>
      <div className="flex flex-col gap-3.5">
        <div className="flex justify-between rounded-[10px] bg-amber-50 px-3.5 py-2.5 text-[13px] font-extrabold text-amber-800">
          <span>Saldo pendiente</span><span>{money(saldo, moneda)}</span>
        </div>
        <Campo label="¿Cuánto abona hoy? (S/)">
          <input type="number" step="0.01" min="0.01" max={saldo} value={monto} onChange={(e) => setMonto(e.target.value)}
            className={inputCls} autoFocus />
        </Campo>
        <Campo label="¿Cómo pagó?">
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inputCls + ' cursor-pointer'}>
            {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
        <BotonesModal onCancel={onClose} busy={busy} disabled={n <= 0 || n > saldo}
          submitLabel={n >= saldo ? `Cancelar saldo ${money(n, moneda)} ✓` : `Abonar ${money(n, moneda)}`} onSubmit={confirmar} />
      </div>
    </Modal>
  )
}

// Congelar pidiendo cuántos días, con el tope anual que permite el plan.
// La BD valida el acumulado del año y el vencimiento se extiende al reactivar.
function CongelarModal({ m, freeze, onClose }) {
  const tope = Number(m.plan?.dias_congelamiento_anio || 0)
  const [dias, setDias] = useState(String(Math.min(15, tope)))
  const n = Number(dias) || 0

  function confirmar() {
    freeze.mutate({ membresiaId: m.id, dias: n }, {
      onSuccess: () => { toast.ok(`Membresía de ${m.socio?.nombre} congelada ${n} día${n === 1 ? '' : 's'}`); onClose() },
      onError: (e) => toast.error('No se pudo congelar: ' + e.message),
    })
  }

  return (
    <Modal title="Congelar membresía" subtitle={m.socio?.nombre} onClose={onClose} width={400}>
      <div className="flex flex-col gap-3.5">
        <Campo label="¿Cuántos días?" hint={`Su plan ${m.plan?.nombre} permite hasta ${tope} días de congelamiento por año (acumulado).`}>
          <input type="number" min="1" max={tope} value={dias} onChange={(e) => setDias(e.target.value)}
            className={inputCls} autoFocus />
        </Campo>
        <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted">
          Mientras esté congelada no puede hacer check-in, y al reactivarla su vencimiento
          se corre los días realmente congelados (no pierde lo pagado).
        </p>
        <BotonesModal onCancel={onClose} busy={freeze.isPending} disabled={n < 1 || n > tope}
          submitLabel={`Congelar ${n || ''} día${n === 1 ? '' : 's'}`} onSubmit={confirmar} />
      </div>
    </Modal>
  )
}

function PlanCard({ p, moneda, popular }) {
  if (popular) {
    return (
      <div className="relative rounded-card bg-navy p-[19px]">
        {p.badge && <div className="absolute right-4 top-4 rounded-full bg-orange px-2.5 py-1 text-[10px] font-extrabold tracking-[0.5px] text-white">{p.badge}</div>}
        <div className="text-[13px] font-extrabold text-faint">{p.nombre}</div>
        <div className="mt-1.5 text-[26px] font-extrabold text-white">{money(p.precio, moneda)} <span className="text-[13px] font-semibold text-faint">/{p.unidad}</span></div>
        <div className="mt-1.5 text-[12.5px] font-semibold text-faint">{p.descripcion}</div>
        <div className="mt-[5px] text-[11.5px] font-extrabold text-green-400">
          {p.dias_congelamiento_anio ? `Congela hasta ${p.dias_congelamiento_anio} días/año` : 'Sin congelamiento'}
        </div>
        {p.cobra_matricula && <div className="mt-1 text-[11px] font-bold text-faint">Matrícula: {money(p.precio_matricula, moneda)}</div>}
      </div>
    )
  }
  return (
    <div className="rounded-card border border-line bg-white p-[19px]">
      <div className="text-[13px] font-extrabold text-muted">{p.nombre}</div>
      <div className="mt-1.5 text-[26px] font-extrabold">{money(p.precio, moneda)} <span className="text-[13px] font-semibold text-muted">/{p.unidad}</span></div>
      <div className="mt-1.5 text-[12.5px] font-semibold text-muted">{p.descripcion}</div>
      <div className="mt-[5px] text-[11.5px] font-extrabold" style={{ color: p.dias_congelamiento_anio ? T.success : T.faint }}>
        {p.dias_congelamiento_anio ? `Congela hasta ${p.dias_congelamiento_anio} días/año` : 'Sin congelamiento'}
      </div>
      {p.cobra_matricula && <div className="mt-1 text-[11px] font-bold text-muted">Matrícula: {money(p.precio_matricula, moneda)}</div>}
    </div>
  )
}

export default function Membresias() {
  const navigate = useNavigate()
  const { sedeId } = usePanel()
  const { empresa, rol } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const planes = usePlanes()
  const membresias = useMembresias(sedeId)
  const freeze = useToggleFreeze(sedeId)
  const renovar = useRenovar(sedeId)
  const anular = useAnularMembresia(sedeId)
  const qc = useQueryClient()
  const [planesOpen, setPlanesOpen] = useState(false)
  const [anulando, setAnulando] = useState(null) // membresía en confirmación de anulación
  const [cobrando, setCobrando] = useState(null) // membresía a la que se le registra el cobro
  const [congelando, setCongelando] = useState(null) // membresía a congelar (pide días)
  const [abonando, setAbonando] = useState(null) // membresía con saldo a la que se abona
  const [dandoBaja, setDandoBaja] = useState(null) // socio en confirmación de baja

  // Control de cobros: vencidas y por vencer en ≤7 días (el gym cobra en persona).
  // Los socios dados de baja ya no se persiguen.
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const diasPara = (f) => Math.ceil((new Date(f) - hoy) / 86400000)
  const porCobrar = (membresias.data || [])
    .filter((m) => !['cancelada', 'congelada'].includes(m.estado) && m.socio?.estado !== 'inactivo'
      && ((m.fecha_fin && diasPara(m.fecha_fin) <= 7) || saldoDe(m) > 0))
    .sort((a, b) => new Date(a.fecha_fin) - new Date(b.fecha_fin))
  const totalPorCobrar = porCobrar.reduce((n, m) => n + (saldoDe(m) > 0 ? saldoDe(m) : Number(m.plan?.precio || 0)), 0)

  // El socio no responde y no volverá: se cierra su membresía y pasa a inactivo
  async function darBaja(m) {
    const { error } = await supabase.rpc('dar_baja_socio', { p_socio_id: m.socio.id })
    setDandoBaja(null)
    if (error) { toast.error('No se pudo dar de baja: ' + error.message); return }
    toast.ok(`${m.socio.nombre} dado de baja — su membresía quedó cerrada`)
    qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
    qc.invalidateQueries({ queryKey: ['clientes', sedeId] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
  }

  function onAnular(m, devolver) {
    anular.mutate({ membresiaId: m.id, devolver }, {
      onSuccess: () => { setAnulando(null); toast.ok(devolver ? 'Membresía anulada y devolución registrada en caja' : 'Membresía anulada') },
      onError: (e) => { toast.error('No se pudo anular: ' + e.message); setAnulando(null) },
    })
  }

  const populares = new Set((planes.data || []).filter((p) => p.badge).map((p) => p.id))

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Membresías</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Planes y gestión de membresías de socios</p>
        </div>
        {rol === 'admin' && (
          <GhostButton onClick={() => setPlanesOpen(true)}>⚙️ Gestionar planes</GhostButton>
        )}
      </div>
      {planesOpen && <PlanesModal onClose={() => setPlanesOpen(false)} />}
      {cobrando && <CobrarModal m={cobrando} moneda={moneda} renovar={renovar} gym={empresa?.nombre} onClose={() => setCobrando(null)} />}
      {congelando && <CongelarModal m={congelando} freeze={freeze} onClose={() => setCongelando(null)} />}
      {abonando && <AbonarModal m={abonando} moneda={moneda} sedeId={sedeId} gym={empresa?.nombre} onClose={() => setAbonando(null)} />}

      {/* Control de cobros: a quién hay que cobrarle */}
      {porCobrar.length > 0 && (
        <Card className="mt-5 overflow-hidden border-orange/40">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <div className="text-[14.5px] font-extrabold">💵 Cobros pendientes ({porCobrar.length})</div>
              <div className="mt-0.5 text-[12px] font-semibold text-muted">Vencidas y por vencer en 7 días · recuérdales por WhatsApp y registra el cobro cuando paguen</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Por cobrar</div>
              <div className="text-[19px] font-extrabold text-orange">{money(totalPorCobrar, moneda)}</div>
            </div>
          </div>
          {porCobrar.map((m) => {
            const d = diasPara(m.fecha_fin)
            const saldo = saldoDe(m)
            const soloSaldo = saldo > 0 && d > 7
            const etiqueta = soloSaldo ? `Debe ${money(saldo, moneda)}`
              : d < 0 ? `Vencida hace ${-d} día${-d === 1 ? '' : 's'}` : d === 0 ? 'Vence HOY' : `Vence en ${d} día${d === 1 ? '' : 's'}`
            const rojo = !soloSaldo && d <= 0
            return (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line2 px-4 py-3 hover:bg-[#FAFBFC] sm:px-5">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-extrabold">{m.socio?.nombre}</div>
                  <div className="text-[11.5px] font-semibold text-muted">{m.plan?.nombre} · {money(m.plan?.precio, moneda)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge bg={soloSaldo ? '#FEF3C7' : rojo ? T.dangerBg : T.primaryBg} color={soloSaldo ? '#92400E' : rojo ? T.danger : T.primary}>{etiqueta}</Badge>
                  {!soloSaldo && saldo > 0 && <Badge bg="#FEF3C7" color="#92400E">Debe {money(saldo, moneda)}</Badge>}
                  {m.socio?.telefono && (
                    <a href={waLink(m.socio.telefono, msgRenovacion({ socio: m.socio.nombre, gym: empresa?.nombre, plan: m.plan?.nombre, vence: m.fecha_fin }))}
                      target="_blank" rel="noreferrer" title="Recordarle por WhatsApp"
                      className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[15px] transition-transform hover:scale-110"
                      style={{ background: '#25D36622', color: '#1DA851' }}>💬</a>
                  )}
                  {saldo > 0 && (
                    <button onClick={() => setAbonando(m)}
                      className="cursor-pointer rounded-[9px] border-none bg-amber-500 px-3.5 py-2 text-[11.5px] font-extrabold text-white hover:bg-amber-600">
                      Abonar
                    </button>
                  )}
                  {!soloSaldo && (
                    <button onClick={() => setCobrando(m)}
                      className="cursor-pointer rounded-[9px] border-none bg-orange px-3.5 py-2 text-[11.5px] font-extrabold text-white hover:bg-orange-600">
                      Cobré — renovar
                    </button>
                  )}
                  {dandoBaja === m.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-extrabold text-red">¿Dar de baja?</span>
                      <button onClick={() => darBaja(m)}
                        className="cursor-pointer rounded-[8px] border-none bg-red px-2.5 py-1.5 text-[10.5px] font-extrabold text-white">Sí</button>
                      <button onClick={() => setDandoBaja(null)}
                        className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[10.5px] font-extrabold text-muted">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDandoBaja(m.id)} title="No volverá: cierra su membresía y lo pasa a inactivo (si vuelve, Renovar lo revive)"
                      className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-2 text-[11px] font-extrabold text-muted hover:border-red hover:text-red">
                      No volverá
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </Card>
      )}

      {/* Planes */}
      {planes.isLoading && <LoadingState variant="cards" rows={4} />}
      {planes.error && <ErrorState error={planes.error} onRetry={planes.refetch} />}
      {planes.data && (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
          {planes.data.map((p) => <PlanCard key={p.id} p={p} moneda={moneda} popular={populares.has(p.id)} />)}
        </div>
      )}

      {/* Gestión */}
      <Card className="mt-[15px] overflow-x-auto">
        <div className="px-5 py-4">
          <div className="text-[14.5px] font-extrabold">Gestión de membresías</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Renueva, congela o reactiva según lo que permite cada plan</div>
        </div>
        <div className="grid min-w-[700px] grid-cols-[1.8fr_1.2fr_1fr_0.9fr_264px] items-center gap-3 bg-surface px-5 py-[11px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
          <div>Socio</div><div>Plan</div><div>Estado</div><div>Vence</div><div className="text-right">Acciones</div>
        </div>

        {membresias.isLoading && <LoadingState variant="table" rows={5} />}
        {membresias.error && <ErrorState error={membresias.error} onRetry={membresias.refetch} />}
        {(membresias.data || []).map((m) => {
          const deBaja = m.socio?.estado === 'inactivo'
          const st = deBaja ? { bg: T.line2, color: T.muted, label: 'De baja' } : estadoBadge(m.estado)
          const dias = m.plan?.dias_congelamiento_anio || 0
          const frozen = m.estado === 'congelada'
          const busy = freeze.isPending || renovar.isPending
          return (
            <div key={m.id}
              onClick={(e) => { if (e.target.closest('button,a') || !m.socio?.id) return; navigate(`/clientes?socio=${m.socio.id}`) }}
              className="grid min-w-[700px] cursor-pointer grid-cols-[1.8fr_1.2fr_1fr_0.9fr_264px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className={deBaja ? 'opacity-60' : ''}>
                <div className="text-[13.5px] font-extrabold">{m.socio?.nombre}</div>
                <div className="text-[11.5px] font-semibold text-muted">Socio N.º {m.socio?.codigo}{deBaja ? ' · ya no es miembro' : ''}</div>
              </div>
              <div>
                <div className="text-[13px] font-bold">{m.plan?.nombre}</div>
                {saldoDe(m) > 0 ? (
                  <button onClick={() => setAbonando(m)} title="Pagó en partes — clic para registrar un abono"
                    className="cursor-pointer rounded-full border-none bg-amber-100 px-2 py-0.5 text-[10.5px] font-extrabold text-amber-800 hover:bg-amber-200">
                    Debe {money(saldoDe(m), moneda)} · Abonar
                  </button>
                ) : (
                  <div className="text-[10.5px] font-extrabold text-faint">{dias ? `Congela hasta ${dias} días/año` : 'Sin congelamiento'}</div>
                )}
              </div>
              <div><Badge bg={st.bg} color={st.color}>{st.label}</Badge></div>
              <div className="text-[12.5px] font-bold text-muted">
                {m.fecha_fin ? new Date(m.fecha_fin).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '—'}
              </div>
              {anulando === m.id ? (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <span className="text-[10.5px] font-extrabold text-red">¿Anular?</span>
                  <button disabled={anular.isPending} onClick={() => onAnular(m, false)}
                    className="cursor-pointer rounded-[8px] border-none bg-red px-2.5 py-1.5 text-[10.5px] font-extrabold text-white disabled:opacity-50">Sí</button>
                  <button disabled={anular.isPending} onClick={() => onAnular(m, true)}
                    className="cursor-pointer rounded-[8px] border border-red bg-white px-2.5 py-1.5 text-[10.5px] font-extrabold text-red disabled:opacity-50">Sí + devolver S/</button>
                  <button onClick={() => setAnulando(null)}
                    className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[10.5px] font-extrabold text-muted">No</button>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2">
                  {/* Slots de ancho fijo: todas las filas alinean igual aunque
                      falte WhatsApp o el plan no permita congelar */}
                  {m.socio?.telefono && m.estado !== 'cancelada' ? (
                    <a href={waLink(m.socio.telefono, msgRenovacion({ socio: m.socio.nombre, gym: empresa?.nombre, plan: m.plan?.nombre, vence: m.fecha_fin }))}
                      target="_blank" rel="noreferrer" title="Recordarle por WhatsApp que renueve"
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] text-[15px] transition-transform hover:scale-110"
                      style={{ background: '#25D36622', color: '#1DA851' }}>
                      💬
                    </a>
                  ) : (
                    <span className="h-8 w-8 flex-shrink-0" />
                  )}
                  <button
                    disabled={busy || m.estado === 'cancelada'}
                    onClick={() => setCobrando(m)}
                    className="w-[78px] cursor-pointer rounded-[9px] border border-orange bg-transparent py-2 text-center text-[11.5px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-50"
                  >
                    Renovar
                  </button>
                  {dias && m.estado !== 'cancelada' ? (
                    <button
                      disabled={busy}
                      onClick={() => (frozen ? freeze.mutate({ membresiaId: m.id, dias: null }) : setCongelando(m))}
                      className="w-[86px] cursor-pointer rounded-[9px] border border-[#C6CBD4] bg-transparent py-2 text-center text-[11.5px] font-extrabold text-ink transition-colors hover:border-ink hover:bg-surface disabled:opacity-50"
                    >
                      {frozen ? 'Reactivar' : 'Congelar'}
                    </button>
                  ) : (
                    <span className="w-[86px] flex-shrink-0" />
                  )}
                  {m.estado !== 'cancelada' && (
                    <button
                      disabled={busy}
                      onClick={() => setAnulando(m.id)}
                      title="Anular membresía"
                      className="cursor-pointer rounded-[9px] border border-line bg-transparent px-2.5 py-2 text-[11.5px] font-extrabold text-muted transition-colors hover:border-red hover:text-red disabled:opacity-50"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Card>

      {(freeze.error || renovar.error) && (
        <div className="mt-3"><ErrorState error={freeze.error || renovar.error} /></div>
      )}
    </div>
  )
}
