import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Avatar, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePersonal } from '../hooks/useOperaciones.js'
import { iniciales } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const ROLES = [
  ['admin', 'Administrador'], ['recepcion', 'Recepción'], ['entrenador', 'Entrenador'],
  ['nutricionista', 'Nutricionista'], ['mantenimiento', 'Mantenimiento'],
]

function useInvitaciones() {
  return useQuery({
    queryKey: ['invitaciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitacion')
        .select('id, email, estado, created_at, rol:rol(nombre)')
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

function InvitarModal({ sedeId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ email: '', rol: 'recepcion' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  async function invitar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.rpc('invitar_colaborador', {
      p_email: f.email.trim().toLowerCase(), p_rol_codigo: f.rol, p_sede_id: sedeId,
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
          <input type="email" required value={f.email} onChange={(e) => setF((s) => ({ ...s, email: e.target.value }))} className={inputCls} placeholder="colaborador@gmail.com" />
        </Campo>
        <Campo label="Rol">
          <select value={f.rol} onChange={(e) => setF((s) => ({ ...s, rol: e.target.value }))} className={inputCls + ' cursor-pointer'}>
            {ROLES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </Campo>
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
  const { data, isLoading, error, refetch } = usePersonal(sedeId)
  const invitaciones = useInvitaciones()

  // Revocar una invitación pendiente (esa persona ya no podrá vincularse)
  async function revocar(inv) {
    const { error } = await supabase.from('invitacion')
      .update({ estado: 'revocada' }).eq('id', inv.id)
    if (error) alert('No se pudo revocar: ' + error.message)
    else qc.invalidateQueries({ queryKey: ['invitaciones'] })
  }

  // Activar/desactivar el acceso de un colaborador a la empresa
  async function toggleActivo(st) {
    const { error } = await supabase.from('usuario_empresa')
      .update({ activo: !st.activo })
      .eq('usuario_id', st.id)
      .eq('empresa_id', empresa.id)
    if (error) alert('No se pudo actualizar: ' + error.message)
    else refetch()
  }

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Personal</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">{sedeNombre} · {data?.length ?? 0} colaboradores</p>
        </div>
        {rol === 'admin' && (
          <button onClick={() => setInvitarOpen(true)}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Agregar colaborador</button>
        )}
      </div>

      {invitarOpen && <InvitarModal sedeId={sedeId} onClose={() => setInvitarOpen(false)} />}

      {isLoading && <LoadingState variant="table" rows={5} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && !error && (data || []).length === 0 && <EmptyState message="No hay colaboradores asignados a esta sede." />}

      {(data || []).length > 0 && (
        <Card className="mt-[18px] overflow-hidden">
          <div className="grid grid-cols-[2.5fr_1.5fr_1fr_120px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Colaborador</div><div>Teléfono</div><div>Estado</div><div />
          </div>
          {data.map((st) => (
            <div key={st.id} className="grid grid-cols-[2.5fr_1.5fr_1fr_120px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className="flex items-center gap-2.5">
                <Avatar ini={st.avatar_iniciales || iniciales(st.nombre)} bg={T.chipNavy} color={T.navy} size={34} fontSize={12} />
                <div className="text-[13.5px] font-extrabold">{st.nombre}</div>
              </div>
              <div className="text-[12.5px] font-semibold text-muted">{st.telefono || '—'}</div>
              <div><Badge bg={st.activo ? T.successBg : T.line2} color={st.activo ? T.success : T.muted}>{st.activo ? 'Activo' : 'Inactivo'}</Badge></div>
              {rol === 'admin' ? (
                <button onClick={() => toggleActivo(st)}
                  className={`cursor-pointer justify-self-end rounded-[9px] border px-3 py-1.5 text-[11px] font-extrabold transition-colors ${st.activo ? 'border-line bg-white text-muted hover:border-red hover:text-red' : 'border-green-300 bg-green-50 text-green-600'}`}>
                  {st.activo ? '⏸ Suspender' : '▶ Reactivar'}
                </button>
              ) : <div />}
            </div>
          ))}
        </Card>
      )}

      {/* Invitaciones pendientes */}
      {(invitaciones.data || []).length > 0 && (
        <Card className="mt-[15px] overflow-hidden">
          <div className="px-5 py-4">
            <div className="text-[14.5px] font-extrabold">Invitaciones pendientes</div>
            <div className="mt-0.5 text-[12px] font-semibold text-muted">Se vinculan solas cuando la persona entra con su Google.</div>
          </div>
          {invitaciones.data.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between border-t border-line2 px-5 py-3">
              <div>
                <div className="text-[13.5px] font-extrabold">{inv.email}</div>
                <div className="text-[11.5px] font-semibold text-muted">{inv.rol?.nombre} · invitado el {new Date(inv.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</div>
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
