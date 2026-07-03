import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/ui.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useClases, useToggleClase, usePlanAcceso, useToggleAcceso } from '../hooks/useClases.js'
import { claseDot, DAY_NAMES } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

function NuevaClaseModal({ sedeId, empresaId, tipos, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ nombre: '', tipo_id: tipos[0]?.id || '', tipo_nuevo: '', dia: '1', hora: '19:00', duracion: 60, cupo: 20 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    try {
      let tipoId = f.tipo_id || null
      // Crear tipo de clase nuevo al vuelo si lo escribió
      if (f.tipo_id === '__nuevo__' && f.tipo_nuevo.trim()) {
        const { data, error } = await supabase.from('tipo_clase')
          .insert({ empresa_id: empresaId, nombre: f.tipo_nuevo.trim() }).select('id').single()
        if (error) throw error
        tipoId = data.id
        qc.invalidateQueries({ queryKey: ['plan-acceso'] })
      }
      const { error } = await supabase.from('clase').insert({
        empresa_id: empresaId, sede_id: sedeId, tipo_clase_id: tipoId === '__nuevo__' ? null : tipoId,
        nombre: f.nombre.trim(), dia_semana: Number(f.dia), hora: f.hora,
        duracion_min: Number(f.duracion) || 60, cupo_max: Number(f.cupo) || 20, activa: true,
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['clases', sedeId] })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Nueva clase" subtitle="Se agrega al horario de la sede actual" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre de la clase *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="Baile · Salsa" /></Campo>
        <Campo label="Tipo de servicio">
          <select value={f.tipo_id} onChange={set('tipo_id')} className={inputCls + ' cursor-pointer'}>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            <option value="__nuevo__">+ Crear tipo nuevo…</option>
          </select>
        </Campo>
        {f.tipo_id === '__nuevo__' && (
          <Campo label="Nombre del tipo nuevo"><input value={f.tipo_nuevo} onChange={set('tipo_nuevo')} className={inputCls} placeholder="Pilates" /></Campo>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Día">
            <select value={f.dia} onChange={set('dia')} className={inputCls + ' cursor-pointer'}>
              {Object.entries(DAY_NAMES).map(([n, d]) => <option key={n} value={n}>{d}</option>)}
            </select>
          </Campo>
          <Campo label="Hora"><input type="time" value={f.hora} onChange={set('hora')} className={inputCls} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Duración (min)"><input type="number" value={f.duracion} onChange={set('duracion')} className={inputCls} /></Campo>
          <Campo label="Cupo máximo"><input type="number" value={f.cupo} onChange={set('cupo')} className={inputCls} /></Campo>
        </div>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel="Crear clase" />
      </form>
    </Modal>
  )
}

// Gestión completa de servicios (tipos de clase): crear, renombrar, color, eliminar.
function ServiciosModal({ empresaId, sedeId, tipos, onClose }) {
  const qc = useQueryClient()
  const [nuevo, setNuevo] = useState({ nombre: '', color: '#FF6B35' })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['plan-acceso'] })
    qc.invalidateQueries({ queryKey: ['clases', sedeId] })
  }

  async function agregar(e) {
    e?.preventDefault()
    if (!nuevo.nombre.trim()) return
    setBusy('nuevo'); setError('')
    const { error } = await supabase.from('tipo_clase').insert({
      empresa_id: empresaId, nombre: nuevo.nombre.trim(), color: nuevo.color,
    })
    setBusy('')
    if (error) { setError(error.message); return }
    setNuevo({ nombre: '', color: '#FF6B35' })
    invalidar()
  }

  async function actualizar(id, patch) {
    setError('')
    const { error } = await supabase.from('tipo_clase').update(patch).eq('id', id)
    if (error) setError(error.message)
    else invalidar()
  }

  async function eliminar(t) {
    if (!confirm(`¿Eliminar el servicio "${t.nombre}"?`)) return
    setBusy(t.id); setError('')
    const { error } = await supabase.from('tipo_clase').delete().eq('id', t.id)
    setBusy('')
    if (error) {
      setError(error.message.includes('foreign key')
        ? `No se puede eliminar "${t.nombre}": tiene clases en el horario o está en la matriz de planes. Quita esas referencias primero.`
        : error.message)
      return
    }
    invalidar()
  }

  return (
    <Modal title="Servicios del gimnasio" subtitle="Se usan en el horario, la matriz de planes y tu página web" onClose={onClose} width={480}>
      <div className="flex flex-col gap-2">
        {tipos.map((t) => (
          <div key={t.id} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-white px-3 py-2">
            <input type="color" value={t.color || '#FF6B35'}
              onChange={(e) => actualizar(t.id, { color: e.target.value })}
              className="h-7 w-9 flex-shrink-0 cursor-pointer rounded border border-line" />
            <input defaultValue={t.nombre}
              onBlur={(e) => e.target.value.trim() && e.target.value !== t.nombre && actualizar(t.id, { nombre: e.target.value.trim() })}
              className="min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 py-1.5 text-[13.5px] font-extrabold outline-none focus:border-orange focus:bg-white" />
            <button onClick={() => eliminar(t)} disabled={busy === t.id}
              className="flex-shrink-0 cursor-pointer rounded-lg border-none bg-transparent px-2 text-[12px] font-extrabold text-red hover:bg-red-50 disabled:opacity-50">
              Eliminar
            </button>
          </div>
        ))}
        {tipos.length === 0 && <div className="rounded-lg bg-surface px-3 py-4 text-center text-[12.5px] font-semibold text-muted">Aún no tienes servicios.</div>}
      </div>

      <form onSubmit={agregar} className="mt-4 flex items-center gap-2.5 rounded-[10px] border border-dashed border-line bg-[#FAFBFC] px-3 py-2.5">
        <input type="color" value={nuevo.color} onChange={(e) => setNuevo((s) => ({ ...s, color: e.target.value }))}
          className="h-7 w-9 flex-shrink-0 cursor-pointer rounded border border-line" />
        <input value={nuevo.nombre} onChange={(e) => setNuevo((s) => ({ ...s, nombre: e.target.value }))}
          placeholder="Nuevo servicio (Pilates, Box, Zumba…)"
          className="min-w-0 flex-1 rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold outline-none focus:border-orange" />
        <button type="submit" disabled={busy === 'nuevo' || !nuevo.nombre.trim()}
          className="flex-shrink-0 cursor-pointer rounded-[9px] border-none bg-orange px-3.5 py-2 text-[12.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
          Agregar
        </button>
      </form>

      {error && <div className="mt-3 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
      <p className="mt-3 text-[11px] font-semibold text-faint">
        El nombre se guarda al hacer clic fuera del campo; el color, al elegirlo.
      </p>
    </Modal>
  )
}

export default function Clases() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [serviciosOpen, setServiciosOpen] = useState(false)
  const clases = useClases(sedeId)
  const toggle = useToggleClase(sedeId)
  const acceso = usePlanAcceso()
  const toggleAcceso = useToggleAcceso()

  // Agrupar clases por día (1..6)
  const cols = [1, 2, 3, 4, 5, 6].map((d) => ({
    label: DAY_NAMES[d],
    items: (clases.data || []).filter((c) => c.dia_semana === d),
  }))

  // Mapa de acceso: `${planId}:${tipoId}` -> incluido
  const accesoMap = new Map((acceso.data?.acceso || []).map((a) => [`${a.plan_id}:${a.tipo_clase_id}`, a.incluido]))

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Clases y servicios</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Horario semanal · {sedeNombre} · toca una clase para pausarla</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => setServiciosOpen(true)}
            className="cursor-pointer rounded-[10px] border border-orange bg-white px-[16px] py-[10px] text-[13px] font-extrabold text-orange transition-colors hover:bg-orange-50">Servicios</button>
          <button onClick={() => setNuevaOpen(true)}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nueva clase</button>
        </div>
      </div>

      {/* Leyenda dinámica de servicios */}
      {(acceso.data?.tipos || []).length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {acceso.data.tipos.map((t) => (
            <div key={t.id} className="flex items-center gap-1.5 text-[12px] font-extrabold text-muted">
              <span className="h-[9px] w-[9px] rounded-full" style={{ background: t.color || claseDot(t.nombre) }} />
              {t.nombre}
            </div>
          ))}
          <button onClick={() => setServiciosOpen(true)} className="cursor-pointer border-none bg-transparent text-[11.5px] font-extrabold text-faint hover:text-orange">
            + gestionar
          </button>
        </div>
      )}

      {nuevaOpen && (
        <NuevaClaseModal sedeId={sedeId} empresaId={empresa?.id} tipos={acceso.data?.tipos || []} onClose={() => setNuevaOpen(false)} />
      )}
      {serviciosOpen && (
        <ServiciosModal empresaId={empresa?.id} sedeId={sedeId} tipos={acceso.data?.tipos || []} onClose={() => setServiciosOpen(false)} />
      )}

      {clases.isLoading && <LoadingState variant="cards" rows={4} />}
      {clases.error && <ErrorState error={clases.error} onRetry={clases.refetch} />}

      {clases.data && (
        <div className="mt-3.5 grid grid-cols-6 items-start gap-3">
          {cols.map((col) => (
            <div key={col.label} className="flex flex-col gap-2.5">
              <div className="rounded-[10px] bg-navy px-3 py-[9px] text-center text-[12.5px] font-extrabold text-white">{col.label}</div>
              {col.items.map((cs) => {
                const paused = !cs.activa
                return (
                  <div key={cs.id} onClick={() => toggle.mutate({ id: cs.id, activa: !cs.activa })}
                    className="cursor-pointer rounded-xl border border-line bg-white p-3 transition hover:border-orange" style={{ opacity: paused ? 0.55 : 1 }}>
                    <div className="text-[11.5px] font-extrabold text-muted">{cs.hora?.slice(0, 5)}</div>
                    <div className="mt-[5px] flex items-center gap-1.5">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: cs.tipo?.color || claseDot(cs.nombre) }} />
                      <div className="text-[13px] font-extrabold leading-[1.25]">{cs.nombre}</div>
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-muted">{cs.instructor?.nombre || 'Por asignar'}</div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <div className="text-[10.5px] font-extrabold text-muted">Cupo {cs.cupo_max}</div>
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: paused ? T.line2 : T.successBg, color: paused ? T.muted : T.success }}>
                        {paused ? 'Pausada' : 'Activa'}
                      </span>
                    </div>
                  </div>
                )
              })}
              {col.items.length === 0 && <div className="rounded-xl border border-dashed border-line px-2 py-3 text-center text-[10.5px] font-semibold text-faint">Sin clases</div>}
            </div>
          ))}
        </div>
      )}

      {/* Matriz de acceso por plan */}
      {acceso.data && acceso.data.tipos.length > 0 && (
        <Card className="mt-[15px] max-w-[760px] overflow-hidden">
          <div className="px-5 py-4">
            <div className="text-[14.5px] font-extrabold">Acceso a clases por plan</div>
            <div className="mt-0.5 text-[12px] font-semibold text-muted">Toca para incluir o excluir un servicio en cada plan</div>
          </div>
          <div className="grid items-center gap-3 bg-surface px-5 py-[11px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted"
            style={{ gridTemplateColumns: `1.6fr repeat(${acceso.data.planes.length}, 1fr)` }}>
            <div>Servicio</div>
            {acceso.data.planes.map((p) => <div key={p.id} className="text-center">{p.nombre}</div>)}
          </div>
          {acceso.data.tipos.map((t) => (
            <div key={t.id} className="grid items-center gap-3 border-t border-line2 px-5 py-[11px]"
              style={{ gridTemplateColumns: `1.6fr repeat(${acceso.data.planes.length}, 1fr)` }}>
              <div className="flex items-center gap-2">
                <span className="h-[9px] w-[9px] flex-shrink-0 rounded-full" style={{ background: t.color || claseDot(t.nombre) }} />
                <div className="text-[13.5px] font-extrabold">{t.nombre}</div>
              </div>
              {acceso.data.planes.map((p) => {
                const on = !!accesoMap.get(`${p.id}:${t.id}`)
                return (
                  <div key={p.id} className="flex justify-center">
                    <button onClick={() => toggleAcceso.mutate({ empresaId: empresa.id, planId: p.id, tipoId: t.id, incluido: !on })}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-extrabold transition hover:ring-2 hover:ring-orange-100 active:scale-[0.92]"
                      style={{ background: on ? T.successBg : T.line2, color: on ? T.success : T.faint }}>
                      {on ? '✓' : '—'}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
