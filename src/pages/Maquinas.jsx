import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, StatCard, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePanel } from '../store.jsx'
import { useMaquinas, useMantenimientos } from '../hooks/useOperaciones.js'
import { maquinaEstado } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

function NuevaMaquinaModal({ sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ nombre: '', detalle: '', zona: 'Cardio', unidades: 1 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.from('maquina').insert({
      empresa_id: empresaId, sede_id: sedeId, nombre: f.nombre.trim(),
      detalle: f.detalle || null, zona: f.zona, unidades: Number(f.unidades) || 1, estado: 'operativa',
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['maquinas', sedeId] })
    onClose()
  }

  return (
    <Modal title="Nueva máquina" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre del equipo *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="Caminadora ProRun 400" /></Campo>
        <Campo label="Detalle"><input value={f.detalle} onChange={set('detalle')} className={inputCls} placeholder="6 unidades · N.º 1-6" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Zona">
            <select value={f.zona} onChange={set('zona')} className={inputCls + ' cursor-pointer'}>
              {['Cardio', 'Fuerza', 'Peso libre', 'Funcional', 'Otra'].map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Campo>
          <Campo label="Unidades"><input type="number" min="1" value={f.unidades} onChange={set('unidades')} className={inputCls} /></Campo>
        </div>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel="Agregar equipo" />
      </form>
    </Modal>
  )
}

function MantenimientoModal({ sedeId, empresaId, maquinas, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ maquina_id: maquinas[0]?.id || '', tipo: 'preventivo', fecha: '', detalle: '', marcar_estado: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    try {
      const { error } = await supabase.from('mantenimiento').insert({
        empresa_id: empresaId, sede_id: sedeId, maquina_id: f.maquina_id || null,
        tipo: f.tipo, fecha_programada: f.fecha || null, detalle: f.detalle || null, estado: 'programado',
      })
      if (error) throw error
      // Marcar la máquina como en mantenimiento (correctivo inmediato)
      if (f.marcar_estado && f.tipo === 'correctivo' && f.maquina_id) {
        await supabase.from('maquina').update({ estado: 'mantenimiento' }).eq('id', f.maquina_id)
      }
      qc.invalidateQueries({ queryKey: ['mantenimientos', sedeId] })
      qc.invalidateQueries({ queryKey: ['maquinas', sedeId] })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Programar mantenimiento" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Equipo">
          <select value={f.maquina_id} onChange={set('maquina_id')} className={inputCls + ' cursor-pointer'}>
            {maquinas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo">
            <select value={f.tipo} onChange={set('tipo')} className={inputCls + ' cursor-pointer'}>
              <option value="preventivo">Preventivo</option><option value="correctivo">Correctivo (falla)</option>
            </select>
          </Campo>
          <Campo label="Fecha programada"><input type="date" value={f.fecha} onChange={set('fecha')} className={inputCls} /></Campo>
        </div>
        <Campo label="Detalle"><input value={f.detalle} onChange={set('detalle')} className={inputCls} placeholder="Cambio de banda, lubricación…" /></Campo>
        {f.tipo === 'correctivo' && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.marcar_estado} onChange={(e) => setF((s) => ({ ...s, marcar_estado: e.target.checked }))} className="h-4 w-4 accent-orange-600" />
            <span className="text-[13px] font-bold">Marcar el equipo "En mantenimiento" ahora</span>
          </label>
        )}
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.maquina_id} submitLabel="Programar" />
      </form>
    </Modal>
  )
}

export default function Maquinas() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [mantOpen, setMantOpen] = useState(false)
  const maquinas = useMaquinas(sedeId)
  const mant = useMantenimientos(sedeId)

  const data = maquinas.data || []
  const operativas = data.filter((m) => m.estado === 'operativa').length
  const enMant = data.filter((m) => m.estado === 'mantenimiento').length
  const fuera = data.filter((m) => m.estado === 'fuera_servicio').length

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Máquinas</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Equipos, estado y mantenimientos · {sedeNombre}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => setNuevaOpen(true)}
            className="cursor-pointer rounded-[10px] border border-orange bg-white px-[16px] py-[10px] text-[13px] font-extrabold text-orange transition-colors hover:bg-orange-50">Nueva máquina</button>
          <button onClick={() => setMantOpen(true)}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Programar mantenimiento</button>
        </div>
      </div>

      {nuevaOpen && <NuevaMaquinaModal sedeId={sedeId} empresaId={empresa?.id} onClose={() => setNuevaOpen(false)} />}
      {mantOpen && <MantenimientoModal sedeId={sedeId} empresaId={empresa?.id} maquinas={data} onClose={() => setMantOpen(false)} />}

      <div className="mt-5 grid grid-cols-4 gap-[15px]">
        <StatCard label="Total de equipos" value={data.length} />
        <StatCard label="Operativas" value={operativas} delta=" " deltaColor={T.success} />
        <StatCard label="En mantenimiento" value={enMant} variant={enMant ? 'accent' : 'default'} />
        <StatCard label="Fuera de servicio" value={fuera} variant={fuera ? 'danger' : 'default'} />
      </div>

      {maquinas.isLoading && <LoadingState variant="table" rows={5} />}
      {maquinas.error && <ErrorState error={maquinas.error} onRetry={maquinas.refetch} />}
      {!maquinas.isLoading && data.length === 0 && <EmptyState message="Sin equipos registrados en esta sede." />}

      {data.length > 0 && (
        <div className="mt-[15px] grid grid-cols-[1.7fr_1fr] items-start gap-[15px]">
          <Card className="overflow-hidden">
            <div className="grid grid-cols-[1.9fr_0.9fr_1.2fr] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
              <div>Equipo</div><div>Zona</div><div>Estado</div>
            </div>
            {data.map((mq) => {
              const est = maquinaEstado(mq.estado)
              return (
                <div key={mq.id} className="grid grid-cols-[1.9fr_0.9fr_1.2fr] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
                  <div>
                    <div className="text-[13.5px] font-extrabold">{mq.nombre}</div>
                    <div className="text-[11.5px] font-semibold text-muted">{mq.detalle}</div>
                  </div>
                  <div className="text-[12.5px] font-bold text-muted">{mq.zona}</div>
                  <div><Badge bg={est.bg} color={est.color}>{est.label}</Badge></div>
                </div>
              )
            })}
          </Card>

          <Card className="p-[19px]">
            <div className="mb-1.5 text-[14.5px] font-extrabold">Próximos mantenimientos</div>
            {(mant.data || []).length === 0 && <div className="py-3 text-[12.5px] font-semibold text-muted">Nada programado.</div>}
            {(mant.data || []).map((pm) => (
              <div key={pm.id} className="flex items-center gap-3 border-b border-line2 py-[11px]">
                <div className="flex h-[44px] w-[44px] flex-shrink-0 flex-col items-center justify-center rounded-[11px] bg-orange-50 text-orange">
                  <div className="text-[15px] font-extrabold leading-none">
                    {pm.fecha_programada ? new Date(pm.fecha_programada).getDate() : '—'}
                  </div>
                  <div className="mt-0.5 text-[9px] font-extrabold uppercase">
                    {pm.fecha_programada ? new Date(pm.fecha_programada).toLocaleDateString('es-PE', { month: 'short' }) : ''}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold">{pm.maquina?.nombre || 'General'}</div>
                  <div className="text-[11.5px] font-semibold text-muted capitalize">{pm.tipo} · {pm.detalle}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}
