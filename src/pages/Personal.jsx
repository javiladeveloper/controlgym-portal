import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Avatar, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { toast } from '../lib/toast.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePersonal } from '../hooks/useOperaciones.js'
import { iniciales } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const ROLES = [
  ['admin', 'Administrador'], ['recepcion', 'Recepción'], ['entrenador', 'Entrenador'],
  ['nutricionista', 'Nutricionista'], ['mantenimiento', 'Mantenimiento'],
]

const METODOS_PAGO = [['efectivo', 'Efectivo'], ['yape', 'Yape'], ['plin', 'Plin'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta']]
const MES_LABEL = new Date().toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })

// Sueldos pagados este mes (para marcar "✓ Pagado" y evitar dobles pagos)
function usePagosPlanilla() {
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  return useQuery({
    queryKey: ['planilla-mes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimiento_financiero')
        .select('ref_id, monto')
        .eq('categoria', 'planilla')
        .eq('ref_tipo', 'usuario')
        .eq('tipo', 'gasto')
        .gte('fecha', inicioMes)
      if (error) throw error
      // Suma por colaborador: los de pago por clase pueden cobrar varias veces al mes
      const m = new Map()
      for (const p of data || []) m.set(p.ref_id, (m.get(p.ref_id) || 0) + Number(p.monto))
      return m
    },
  })
}

// Pagar al colaborador: sueldo mensual fijo (planilla) o por clases/sesiones
// dictadas (instructores contratados). Ambos registran gasto de planilla en caja.
function PagarSueldoModal({ colaborador, sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const [modo, setModo] = useState(colaborador.tipo_pago || 'mensual')
  const [monto, setMonto] = useState(String(colaborador.sueldo_mensual ?? ''))
  const [clases, setClases] = useState('')
  const [tarifa, setTarifa] = useState(String(colaborador.tarifa_clase ?? ''))
  const [metodo, setMetodo] = useState('transferencia')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const totalClases = (Number(clases) || 0) * (Number(tarifa) || 0)

  async function pagar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    try {
      const esMensual = modo === 'mensual'
      const n = esMensual ? Number(monto) : totalClases
      if (!n || n <= 0) throw new Error(esMensual ? 'Ingresa el monto del sueldo' : 'Ingresa cuántas clases y la tarifa')
      // Guardar cómo se le paga (y su base) para la próxima vez
      await supabase.from('usuario_empresa')
        .update(esMensual
          ? { tipo_pago: 'mensual', sueldo_mensual: n }
          : { tipo_pago: 'por_clase', tarifa_clase: Number(tarifa) })
        .eq('usuario_id', colaborador.id).eq('empresa_id', empresaId)
      // Registrar el gasto de planilla
      const { error } = await supabase.from('movimiento_financiero').insert({
        empresa_id: empresaId, sede_id: sedeId, tipo: 'gasto', categoria: 'planilla',
        descripcion: esMensual
          ? `Sueldo ${MES_LABEL} · ${colaborador.nombre}`
          : `Pago por ${clases} clase${Number(clases) === 1 ? '' : 's'} · ${MES_LABEL} · ${colaborador.nombre}`,
        monto: n, metodo_pago: metodo, ref_tipo: 'usuario', ref_id: colaborador.id,
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['planilla-mes'] })
      qc.invalidateQueries({ queryKey: ['personal', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Pagar · ${MES_LABEL}`} subtitle={colaborador.nombre} onClose={onClose}>
      <form onSubmit={pagar} className="flex flex-col gap-3.5">
        {/* Cómo se le paga: fijo de planilla o por clases dictadas */}
        <div className="flex gap-2">
          {[['mensual', '💼 Sueldo mensual'], ['por_clase', '🕐 Por clases / sesiones']].map(([v, l]) => (
            <button type="button" key={v} onClick={() => setModo(v)}
              className={`flex-1 cursor-pointer rounded-[10px] border px-3 py-2.5 text-[12.5px] font-extrabold transition-colors ${modo === v ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
              {l}
            </button>
          ))}
        </div>

        {modo === 'mensual' ? (
          <Campo label="Monto (S/) *" hint="Queda guardado como su sueldo base para el próximo mes.">
            <input required type="number" step="0.01" min="1" value={monto} onChange={(e) => setMonto(e.target.value)}
              className={inputCls} placeholder="1200" autoFocus />
          </Campo>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Clases dictadas *">
                <input required type="number" min="1" value={clases} onChange={(e) => setClases(e.target.value)} className={inputCls} placeholder="8" autoFocus />
              </Campo>
              <Campo label="Tarifa por clase (S/) *" hint="Se guarda para la próxima vez.">
                <input required type="number" step="0.01" min="0.01" value={tarifa} onChange={(e) => setTarifa(e.target.value)} className={inputCls} placeholder="30" />
              </Campo>
            </div>
            <div className="flex justify-between rounded-[10px] bg-surface px-3.5 py-2.5 text-[13px] font-extrabold">
              <span>Total a pagar</span><span className="text-orange">S/ {totalClases.toFixed(2)}</span>
            </div>
          </>
        )}

        <Campo label="Método de pago">
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inputCls + ' cursor-pointer'}>
            {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
        <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted">
          Se registrará como gasto de <b>planilla</b> en Finanzas y contará en los reportes del mes.
        </p>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} submitLabel="Registrar pago" />
      </form>
    </Modal>
  )
}

// Pagar de una vez a todos los pendientes con sueldo fijado
function PagarPlanillaModal({ pendientes, sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const [metodo, setMetodo] = useState('transferencia')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = pendientes.reduce((n, st) => n + Number(st.sueldo_mensual), 0)

  async function pagar() {
    setBusy(true); setError('')
    const { error } = await supabase.from('movimiento_financiero').insert(
      pendientes.map((st) => ({
        empresa_id: empresaId, sede_id: sedeId, tipo: 'gasto', categoria: 'planilla',
        descripcion: `Sueldo ${MES_LABEL} · ${st.nombre}`,
        monto: Number(st.sueldo_mensual), metodo_pago: metodo, ref_tipo: 'usuario', ref_id: st.id,
      }))
    )
    setBusy(false)
    if (error) { setError(error.message); return }
    toast.ok(`Planilla de ${MES_LABEL} registrada: ${pendientes.length} sueldos por S/ ${total}`)
    qc.invalidateQueries({ queryKey: ['planilla-mes'] })
    qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    onClose()
  }

  return (
    <Modal title={`Pagar planilla · ${MES_LABEL}`} subtitle="Registra el sueldo de todos los pendientes" onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <div className="rounded-[10px] border border-line bg-[#FAFBFC] p-3">
          {pendientes.map((st) => (
            <div key={st.id} className="flex items-center justify-between py-1.5 text-[13px]">
              <span className="font-extrabold">{st.nombre}</span>
              <span className="font-bold text-muted">S/ {Number(st.sueldo_mensual)}</span>
            </div>
          ))}
          <div className="mt-1.5 flex items-center justify-between border-t border-line2 pt-2 text-[13.5px] font-extrabold">
            <span>Total</span><span className="text-orange">S/ {total}</span>
          </div>
        </div>
        <Campo label="Método de pago">
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inputCls + ' cursor-pointer'}>
            {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
        <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted">
          Se registran {pendientes.length} gastos de <b>planilla</b> en Finanzas. Si alguien no cobra este mes, ciérralo y págale individual con su botón.
        </p>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} submitLabel={`Registrar S/ ${total}`} onSubmit={pagar} />
      </div>
    </Modal>
  )
}

function useInvitaciones() {
  return useQuery({
    queryKey: ['invitaciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitacion')
        .select('id, email, nombre, telefono, estado, created_at, rol:rol(nombre)')
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

function InvitarModal({ sedeId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ email: '', rol: 'recepcion', nombre: '', telefono: '', sueldo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function invitar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.rpc('invitar_colaborador', {
      p_email: f.email.trim().toLowerCase(), p_rol_codigo: f.rol, p_sede_id: sedeId,
      p_nombre: f.nombre.trim() || null, p_telefono: f.telefono.trim() || null,
      p_sueldo: f.sueldo === '' ? null : Number(f.sueldo),
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setOk(true)
    qc.invalidateQueries({ queryKey: ['invitaciones'] })
    qc.invalidateQueries({ queryKey: ['personal', sedeId] })
  }

  if (ok) {
    return (
      <Modal title="Invitación registrada ✓" onClose={onClose} width={420}>
        <div className="rounded-[10px] bg-green-50 p-4 text-[13px] font-bold text-green-600">
          Cuando <b>{f.email}</b> entre al panel con su cuenta de Google, quedará vinculado automáticamente como {ROLES.find(([c]) => c === f.rol)?.[1]}.
        </div>
        <button onClick={onClose} className="mt-4 w-full cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600">Listo</button>
      </Modal>
    )
  }

  return (
    <Modal title="Agregar colaborador" subtitle="Se le da acceso al panel por invitación" onClose={onClose}>
      <form onSubmit={invitar} className="flex flex-col gap-3.5">
        <Campo label="Correo de Google *" hint="Con este correo iniciará sesión en el panel.">
          <input type="email" required value={f.email} onChange={set('email')} className={inputCls} placeholder="colaborador@gmail.com" />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nombre"><input value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="María López" /></Campo>
          <Campo label="Teléfono"><input value={f.telefono} onChange={set('telefono')} className={inputCls} placeholder="999 888 777" /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Rol">
            <select value={f.rol} onChange={set('rol')} className={inputCls + ' cursor-pointer'}>
              {ROLES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </Campo>
          <Campo label="Sueldo mensual (S/)" hint="Opcional; se usa en Planilla.">
            <input type="number" step="0.01" min="0" value={f.sueldo} onChange={set('sueldo')} className={inputCls} placeholder="1200" />
          </Campo>
        </div>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.email.trim()} submitLabel="Invitar" />
      </form>
    </Modal>
  )
}

export default function Personal() {
  const { sedeId, sedeNombre } = usePanel()
  const { rol, empresa } = useAuth()
  const qc = useQueryClient()
  const [invitarOpen, setInvitarOpen] = useState(false)
  const [pagarA, setPagarA] = useState(null) // colaborador al que se le paga el sueldo
  const [planillaOpen, setPlanillaOpen] = useState(false)
  const { data, isLoading, error, refetch } = usePersonal(sedeId)
  const invitaciones = useInvitaciones()
  const pagosMes = usePagosPlanilla()

  // Activos de sueldo FIJO que aún no cobraron este mes (los de pago por
  // clase no entran al lote: se les paga según lo que dictaron)
  const pendientesPlanilla = (data || []).filter(
    (st) => st.activo && st.tipo_pago !== 'por_clase' && Number(st.sueldo_mensual) > 0 && pagosMes.data && !pagosMes.data.has(st.id)
  )

  // Revocar una invitación pendiente (esa persona ya no podrá vincularse)
  async function revocar(inv) {
    const { error } = await supabase.from('invitacion')
      .update({ estado: 'revocada' }).eq('id', inv.id)
    if (error) toast.error('No se pudo revocar: ' + error.message)
    else qc.invalidateQueries({ queryKey: ['invitaciones'] })
  }

  // Activar/desactivar el acceso de un colaborador a la empresa
  async function toggleActivo(st) {
    const { error } = await supabase.from('usuario_empresa')
      .update({ activo: !st.activo })
      .eq('usuario_id', st.id)
      .eq('empresa_id', empresa.id)
    if (error) toast.error('No se pudo actualizar: ' + error.message)
    else refetch()
  }

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Personal</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">{sedeNombre} · {data?.length ?? 0} colaboradores</p>
        </div>
        {rol === 'admin' && (
          <div className="flex items-center gap-2">
            {pendientesPlanilla.length > 0 && (
              <button onClick={() => setPlanillaOpen(true)}
                className="cursor-pointer rounded-[10px] border border-green-300 bg-green-50 px-[16px] py-[11px] text-[13px] font-extrabold text-green-700 transition-colors hover:bg-green-100">
                💵 Pagar planilla del mes ({pendientesPlanilla.length})
              </button>
            )}
            <button onClick={() => setInvitarOpen(true)}
              className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Agregar colaborador</button>
          </div>
        )}
      </div>

      {invitarOpen && <InvitarModal sedeId={sedeId} onClose={() => setInvitarOpen(false)} />}
      {pagarA && <PagarSueldoModal colaborador={pagarA} sedeId={sedeId} empresaId={empresa?.id} onClose={() => setPagarA(null)} />}
      {planillaOpen && <PagarPlanillaModal pendientes={pendientesPlanilla} sedeId={sedeId} empresaId={empresa?.id} onClose={() => setPlanillaOpen(false)} />}

      {isLoading && <LoadingState variant="table" rows={5} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && !error && (data || []).length === 0 && <EmptyState message="No hay colaboradores asignados a esta sede." />}

      {(data || []).length > 0 && (
        <Card className="mt-[18px] overflow-x-auto">
          <div className="grid min-w-[660px] grid-cols-[2.2fr_1.1fr_1.1fr_0.9fr_200px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Colaborador</div><div>Teléfono</div><div>Sueldo · {MES_LABEL.split(' ')[0]}</div><div>Estado</div><div />
          </div>
          {data.map((st) => {
            const pagado = pagosMes.data?.get(st.id)
            const porClase = st.tipo_pago === 'por_clase'
            return (
              <div key={st.id} className="grid min-w-[660px] grid-cols-[2.2fr_1.1fr_1.1fr_0.9fr_200px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
                <div className="flex items-center gap-2.5">
                  <Avatar ini={st.avatar_iniciales || iniciales(st.nombre)} bg={T.chipNavy} color={T.navy} size={34} fontSize={12} />
                  <div className="text-[13.5px] font-extrabold">{st.nombre}</div>
                </div>
                <div className="text-[12.5px] font-semibold text-muted">{st.telefono || '—'}</div>
                <div className="text-[12.5px] font-bold">
                  {porClase ? (
                    <span className="text-muted">
                      {st.tarifa_clase ? `S/ ${Number(st.tarifa_clase)} por clase` : 'por clase'}
                      {pagado != null && <span className="ml-1.5 font-extrabold text-green-600">· pagado S/ {pagado}</span>}
                    </span>
                  ) : pagado != null
                    ? <span className="text-green-600">✓ Pagado S/ {pagado}</span>
                    : st.sueldo_mensual
                      ? <span className="text-muted">S/ {Number(st.sueldo_mensual)} pendiente</span>
                      : <span className="text-faint">sin sueldo fijado</span>}
                </div>
                <div><Badge bg={st.activo ? T.successBg : T.line2} color={st.activo ? T.success : T.muted}>{st.activo ? 'Activo' : 'Inactivo'}</Badge></div>
                {rol === 'admin' ? (
                  <div className="flex items-center justify-end gap-1.5">
                    {(porClase || pagado == null) && st.activo && (
                      <button onClick={() => setPagarA(st)}
                        className="cursor-pointer rounded-[9px] border border-green-300 bg-green-50 px-3 py-1.5 text-[11px] font-extrabold text-green-700 hover:bg-green-100">
                        💵 {porClase ? 'Pagar clases' : 'Pagar sueldo'}
                      </button>
                    )}
                    <button onClick={() => toggleActivo(st)}
                      className={`cursor-pointer rounded-[9px] border px-3 py-1.5 text-[11px] font-extrabold transition-colors ${st.activo ? 'border-line bg-white text-muted hover:border-red hover:text-red' : 'border-green-300 bg-green-50 text-green-600'}`}>
                      {st.activo ? '⏸' : '▶'}
                    </button>
                  </div>
                ) : <div />}
              </div>
            )
          })}
        </Card>
      )}

      {/* Invitaciones pendientes */}
      {(invitaciones.data || []).length > 0 && (
        <Card className="mt-[15px] overflow-x-auto">
          <div className="px-5 py-4">
            <div className="text-[14.5px] font-extrabold">Invitaciones pendientes</div>
            <div className="mt-0.5 text-[12px] font-semibold text-muted">Se vinculan solas cuando la persona entra con su Google.</div>
          </div>
          {invitaciones.data.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between border-t border-line2 px-5 py-3">
              <div>
                <div className="text-[13.5px] font-extrabold">{inv.nombre ? `${inv.nombre} · ${inv.email}` : inv.email}</div>
                <div className="text-[11.5px] font-semibold text-muted">{inv.rol?.nombre}{inv.telefono ? ` · ${inv.telefono}` : ''} · invitado el {new Date(inv.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge bg={T.primaryBg} color={T.primary}>Pendiente</Badge>
                {rol === 'admin' && (
                  <button onClick={() => revocar(inv)} title="Revocar invitación"
                    className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-muted hover:border-red hover:text-red">
                    Revocar
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
