import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, Avatar } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useSponsors } from '../hooks/useOperaciones.js'
import { iniciales, money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

function NuevoConvenioModal({ empresaId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ nombre: '', descripcion: '', tipo: 'auspicio', aporte_detalle: '', fecha_vencimiento: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.from('sponsor').insert({
      empresa_id: empresaId, nombre: f.nombre.trim(), descripcion: f.descripcion || null,
      tipo: f.tipo, aporte_detalle: f.aporte_detalle || null,
      fecha_vencimiento: f.fecha_vencimiento || null, estado: 'activo',
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['sponsors'] })
    onClose()
  }

  return (
    <Modal title="Nuevo convenio" onClose={onClose}>
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
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel="Crear convenio" />
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
  const { data, isLoading, error, refetch } = useSponsors()

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Sponsors</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Convenios y auspicios de {empresa?.nombre}</p>
        </div>
        <button onClick={() => setNuevoOpen(true)}
          className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nuevo convenio</button>
      </div>

      {nuevoOpen && <NuevoConvenioModal empresaId={empresa?.id} onClose={() => setNuevoOpen(false)} />}

      {isLoading && <LoadingState variant="cards" rows={4} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && (data || []).length === 0 && <EmptyState message="Sin convenios registrados." />}

      {(data || []).length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-[15px]">
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
                <div className="mt-3.5 flex justify-between border-t border-line2 pt-[13px]">
                  <div className="text-[12.5px] font-bold text-muted">
                    Aporte: <span className="font-extrabold text-ink">{s.aporte_detalle || (s.aporte_monto ? money(s.aporte_monto, moneda) : '—')}</span>
                  </div>
                  <div className="text-[12.5px] font-bold text-muted">
                    {s.fecha_vencimiento ? `Vence: ${new Date(s.fecha_vencimiento).toLocaleDateString('es-PE', { month: 'short', year: 'numeric' })}` : ''}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
