import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, Avatar } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { toast } from '../lib/toast.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useSponsors } from '../hooks/useOperaciones.js'
import { iniciales, money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

// Crea un convenio o edita el existente si llega `sponsor`
function ConvenioModal({ empresaId, sponsor, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    nombre: sponsor?.nombre || '', descripcion: sponsor?.descripcion || '',
    tipo: sponsor?.tipo || 'auspicio', aporte_detalle: sponsor?.aporte_detalle || '',
    fecha_vencimiento: sponsor?.fecha_vencimiento || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const valores = {
      nombre: f.nombre.trim(), descripcion: f.descripcion || null,
      tipo: f.tipo, aporte_detalle: f.aporte_detalle || null,
      fecha_vencimiento: f.fecha_vencimiento || null,
    }
    const { error } = sponsor
      ? await supabase.from('sponsor').update(valores).eq('id', sponsor.id)
      : await supabase.from('sponsor').insert({ empresa_id: empresaId, estado: 'activo', ...valores })
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['sponsors'] })
    if (sponsor) toast.ok('Convenio actualizado')
    onClose()
  }

  return (
    <Modal title={sponsor ? 'Editar convenio' : 'Nuevo convenio'} subtitle={sponsor?.nombre} onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre de la empresa/sponsor *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} /></Campo>
        <Campo label="Descripción"><input value={f.descripcion} onChange={set('descripcion')} className={inputCls} placeholder="Auspicio · exhibición en recepción" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo">
            <select value={f.tipo} onChange={set('tipo')} className={inputCls + ' cursor-pointer'}>
              <option value="auspicio">Auspicio</option><option value="canje">Canje</option>
              <option value="descuento_cruzado">Descuento cruzado</option><option value="convenio_corporativo">Convenio corporativo</option>
              <option value="otro">Otro</option>
            </select>
          </Campo>
          <Campo label="Vence"><input type="date" value={f.fecha_vencimiento} onChange={set('fecha_vencimiento')} className={inputCls} /></Campo>
        </div>
        <Campo label="Aporte / beneficio"><input value={f.aporte_detalle} onChange={set('aporte_detalle')} className={inputCls} placeholder="S/ 800/mes · 15% para socios…" /></Campo>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel={sponsor ? 'Guardar cambios' : 'Crear convenio'} />
      </form>
    </Modal>
  )
}

const ESTADO = {
  activo: { bg: T.successBg, color: T.success, label: 'Activo' },
  por_renovar: { bg: T.primaryBg, color: T.primary, label: 'Renovar' },
  inactivo: { bg: T.line2, color: T.muted, label: 'Inactivo' },
}

export default function Sponsors() {
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [editar, setEditar] = useState(null) // convenio en edición
  const [confirmarDel, setConfirmarDel] = useState(null)
  const { data, isLoading, error, refetch } = useSponsors()

  async function cambiarEstado(s, estado) {
    const { error } = await supabase.from('sponsor').update({ estado }).eq('id', s.id)
    if (error) toast.error('No se pudo actualizar: ' + error.message)
    else refetch()
  }
  async function eliminar(s) {
    const { error } = await supabase.from('sponsor')
      .update({ deleted_at: new Date().toISOString() }).eq('id', s.id)
    setConfirmarDel(null)
    if (error) toast.error('No se pudo eliminar: ' + error.message)
    else refetch()
  }

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Sponsors</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Convenios y auspicios de {empresa?.nombre}</p>
        </div>
        <button onClick={() => setNuevoOpen(true)}
          className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nuevo convenio</button>
      </div>

      {nuevoOpen && <ConvenioModal empresaId={empresa?.id} onClose={() => setNuevoOpen(false)} />}
      {editar && <ConvenioModal empresaId={empresa?.id} sponsor={editar} onClose={() => setEditar(null)} />}

      {isLoading && <LoadingState variant="cards" rows={4} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && (data || []).length === 0 && <EmptyState message="Sin convenios registrados." />}

      {(data || []).length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-[15px] md:grid-cols-2">
          {data.map((s) => {
            const est = ESTADO[s.estado] || ESTADO.activo
            return (
              <Card key={s.id} className="p-[19px]">
                <div className="flex items-center gap-3">
                  <Avatar ini={iniciales(s.nombre)} bg={T.chipNavy} color={T.navy} size={44} fontSize={15} />
                  <div className="flex-1">
                    <div className="text-[15px] font-extrabold">{s.nombre}</div>
                    <div className="text-[12px] font-semibold text-muted">{s.descripcion}</div>
                  </div>
                  <span className="rounded-full px-[11px] py-[5px] text-[11px] font-extrabold" style={{ background: est.bg, color: est.color }}>{est.label}</span>
                </div>
                <div className="mt-3.5 flex items-center justify-between border-t border-line2 pt-[13px]">
                  <div className="text-[12.5px] font-bold text-muted">
                    Aporte: <span className="font-extrabold text-ink">{s.aporte_detalle || (s.aporte_monto ? money(s.aporte_monto, moneda) : '—')}</span>
                    {s.fecha_vencimiento ? <span className="ml-2">· vence {new Date(s.fecha_vencimiento).toLocaleDateString('es-PE', { month: 'short', year: 'numeric' })}</span> : ''}
                  </div>
                  {confirmarDel === s.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10.5px] font-extrabold text-red">¿Eliminar?</span>
                      <button onClick={() => eliminar(s)} className="cursor-pointer rounded-[8px] border-none bg-red px-2.5 py-1 text-[10.5px] font-extrabold text-white">Sí</button>
                      <button onClick={() => setConfirmarDel(null)} className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[10.5px] font-extrabold text-muted">No</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {s.estado === 'activo' ? (
                        <button onClick={() => cambiarEstado(s, 'pausado')}
                          className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[10.5px] font-extrabold text-muted hover:border-amber-400 hover:text-amber-600">⏸ Pausar</button>
                      ) : (
                        <button onClick={() => cambiarEstado(s, 'activo')}
                          className="cursor-pointer rounded-[8px] border border-green-300 bg-green-50 px-2.5 py-1 text-[10.5px] font-extrabold text-green-600">▶ Activar</button>
                      )}
                      <button onClick={() => setEditar(s)} title="Editar convenio"
                        className="cursor-pointer rounded-[8px] border-none bg-transparent px-1.5 py-1 text-[12px] text-faint hover:text-orange">✏️</button>
                      <button onClick={() => setConfirmarDel(s.id)}
                        className="cursor-pointer rounded-[8px] border-none bg-transparent px-1.5 py-1 text-[11.5px] font-extrabold text-faint hover:text-red">🗑</button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
