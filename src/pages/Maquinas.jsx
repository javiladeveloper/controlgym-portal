import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, StatCard, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { toast } from '../lib/toast.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePanel } from '../store.jsx'
import { useMaquinas, useMantenimientos } from '../hooks/useOperaciones.js'
import { TIPOS_EQUIPO } from '../lib/tiposEquipo.js'
import { maquinaEstado } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

// Alta y edición de máquina (mismo formulario). Editando permite eliminar.
function MaquinaModal({ sedeId, empresaId, maquina = null, onClose }) {
  const qc = useQueryClient()
  const editando = !!maquina
  const [f, setF] = useState({
    nombre: maquina?.nombre || '', detalle: maquina?.detalle || '',
    zona: maquina?.zona || 'Cardio', unidades: maquina?.unidades || 1,
    equipment: maquina?.equipment || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmarDel, setConfirmarDel] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const payload = {
      nombre: f.nombre.trim(), detalle: f.detalle || null,
      zona: f.zona, unidades: Number(f.unidades) || 1,
      equipment: f.equipment || null,
    }
    const { error } = editando
      ? await supabase.from('maquina').update(payload).eq('id', maquina.id)
      : await supabase.from('maquina').insert({ ...payload, empresa_id: empresaId, sede_id: sedeId, estado: 'operativa' })
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['maquinas', sedeId] })
    onClose()
  }

  async function eliminar() {
    setBusy(true); setError('')
    const { error } = await supabase.from('maquina')
      .update({ deleted_at: new Date().toISOString() }).eq('id', maquina.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['maquinas', sedeId] })
    qc.invalidateQueries({ queryKey: ['mantenimientos', sedeId] })
    onClose()
  }

  return (
    <Modal title={editando ? 'Editar máquina' : 'Nueva máquina'} subtitle={editando ? maquina.nombre : undefined} onClose={onClose}>
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
        <Campo label="Tipo de equipo" hint="Con qué se entrena. De esto sale qué ejercicios puede hacer tu gym en las rutinas.">
          <select value={f.equipment} onChange={set('equipment')} className={inputCls + ' cursor-pointer'}>
            <option value="">Sin especificar</option>
            {TIPOS_EQUIPO.filter((t) => t.codigo !== 'body weight').map((t) => (
              <option key={t.codigo} value={t.codigo}>{t.emoji} {t.es}</option>
            ))}
          </select>
        </Campo>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        {editando && (
          confirmarDel ? (
            <div className="flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5">
              <span className="flex-1 text-[12.5px] font-extrabold text-red">¿Eliminar este equipo?</span>
              <button type="button" disabled={busy} onClick={eliminar}
                className="cursor-pointer rounded-[8px] border-none bg-red px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50">Sí, eliminar</button>
              <button type="button" onClick={() => setConfirmarDel(false)}
                className="cursor-pointer rounded-[8px] border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted">No</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmarDel(true)}
              className="cursor-pointer self-start border-none bg-transparent p-0 text-[12.5px] font-extrabold text-red hover:underline">
              🗑 Eliminar equipo
            </button>
          )
        )}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel={editando ? 'Guardar cambios' : 'Agregar equipo'} />
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
  const qc = useQueryClient()
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [editarMq, setEditarMq] = useState(null)
  const [mantOpen, setMantOpen] = useState(false)
  const maquinas = useMaquinas(sedeId)
  const mant = useMantenimientos(sedeId)

  // Ciclo de estado con un clic sobre el badge: operativa → mantenimiento → fuera_servicio → operativa
  const SIGUIENTE_ESTADO = { operativa: 'mantenimiento', mantenimiento: 'fuera_servicio', fuera_servicio: 'operativa' }
  async function cambiarEstado(mq) {
    const { error } = await supabase.from('maquina')
      .update({ estado: SIGUIENTE_ESTADO[mq.estado] || 'operativa' }).eq('id', mq.id)
    if (error) toast.error('No se pudo cambiar el estado: ' + error.message)
    else qc.invalidateQueries({ queryKey: ['maquinas', sedeId] })
  }

  // Completar o cancelar un mantenimiento programado
  async function cerrarMantenimiento(pm, estado) {
    const { error } = await supabase.from('mantenimiento')
      .update({ estado, fecha_realizada: estado === 'completado' ? new Date().toISOString().slice(0, 10) : null })
      .eq('id', pm.id)
    if (error) { toast.error('No se pudo actualizar: ' + error.message); return }
    if (estado === 'completado' && pm.maquina_id) {
      await supabase.from('maquina').update({ estado: 'operativa' }).eq('id', pm.maquina_id)
    }
    qc.invalidateQueries({ queryKey: ['mantenimientos', sedeId] })
    qc.invalidateQueries({ queryKey: ['maquinas', sedeId] })
  }

  const data = maquinas.data || []
  const operativas = data.filter((m) => m.estado === 'operativa').length
  const enMant = data.filter((m) => m.estado === 'mantenimiento').length
  const fuera = data.filter((m) => m.estado === 'fuera_servicio').length

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
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

      {nuevaOpen && <MaquinaModal sedeId={sedeId} empresaId={empresa?.id} onClose={() => setNuevaOpen(false)} />}
      {editarMq && <MaquinaModal sedeId={sedeId} empresaId={empresa?.id} maquina={editarMq} onClose={() => setEditarMq(null)} />}
      {mantOpen && <MantenimientoModal sedeId={sedeId} empresaId={empresa?.id} maquinas={data} onClose={() => setMantOpen(false)} />}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
        <StatCard label="Total de equipos" value={data.length} />
        <StatCard label="Operativas" value={operativas} delta=" " deltaColor={T.success} />
        <StatCard label="En mantenimiento" value={enMant} variant={enMant ? 'accent' : 'default'} />
        <StatCard label="Fuera de servicio" value={fuera} variant={fuera ? 'danger' : 'default'} />
      </div>

      {maquinas.isLoading && <LoadingState variant="table" rows={5} />}
      {maquinas.error && <ErrorState error={maquinas.error} onRetry={maquinas.refetch} />}
      {!maquinas.isLoading && data.length === 0 && (
        <EmptyState icon="🏋️" message="Sin equipos registrados — agrega tus máquinas para controlar sus mantenimientos."
          actionLabel="+ Agregar mi primera máquina" onAction={() => setNuevaOpen(true)} />
      )}

      {data.length > 0 && (
        <div className="mt-[15px] grid grid-cols-[1.7fr_1fr] items-start gap-[15px]">
          <Card className="overflow-hidden">
            <div className="grid min-w-[660px] grid-cols-[1.9fr_0.9fr_1.2fr_50px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
              <div>Equipo</div><div>Zona</div><div>Estado (toca para cambiar)</div><div />
            </div>
            {data.map((mq) => {
              const est = maquinaEstado(mq.estado)
              return (
                <div key={mq.id} className="grid min-w-[660px] grid-cols-[1.9fr_0.9fr_1.2fr_50px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
                  <div>
                    <div className="text-[13.5px] font-extrabold">{mq.nombre}</div>
                    <div className="text-[11.5px] font-semibold text-muted">{mq.detalle}</div>
                  </div>
                  <div className="text-[12.5px] font-bold text-muted">{mq.zona}</div>
                  <div>
                    <button onClick={() => cambiarEstado(mq)} title="Cambiar estado"
                      className="cursor-pointer border-none bg-transparent p-0 transition-transform active:scale-[0.95]">
                      <Badge bg={est.bg} color={est.color}>{est.label}</Badge>
                    </button>
                  </div>
                  <button onClick={() => setEditarMq(mq)} title="Editar equipo"
                    className="cursor-pointer rounded-lg border-none bg-transparent px-2 py-1 text-[13px] text-faint hover:text-orange">✏️</button>
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
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-extrabold">{pm.maquina?.nombre || 'General'}</div>
                  <div className="text-[11.5px] font-semibold text-muted capitalize">{pm.tipo} · {pm.detalle}</div>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button onClick={() => cerrarMantenimiento(pm, 'completado')} title="Marcar como completado (la máquina vuelve a operativa)"
                    className="cursor-pointer rounded-lg border-none bg-green-50 px-2 py-1 text-[12px] font-extrabold text-green-600 hover:bg-green-100">✓</button>
                  <button onClick={() => cerrarMantenimiento(pm, 'cancelado')} title="Cancelar mantenimiento"
                    className="cursor-pointer rounded-lg border-none bg-transparent px-2 py-1 text-[12px] font-extrabold text-faint hover:text-red">✕</button>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}
