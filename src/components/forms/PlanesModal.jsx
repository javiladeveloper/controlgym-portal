import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal, { Campo, inputCls } from '../Modal.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { money } from '../../lib/uiHelpers.js'

// Gestión de planes (paquetes) del gimnasio: crear, editar, desactivar y
// eliminar. Aquí se configura si el plan permite congelar la membresía
// (dias_congelamiento_anio: 0 = no permite) y la matrícula.
const UNIDADES = [['dia', 'Por día'], ['mes', 'Mensual'], ['trimestre', 'Trimestral'], ['anual', 'Anual']]

const VACIO = {
  nombre: '', precio: '', unidad: 'mes', descripcion: '', badge: '',
  cobra_matricula: false, precio_matricula: '', dias_congelamiento_anio: 0,
  multisede: false, es_familiar: false, incluye_clases: true, incluye_rutina: true, activo: true,
}

export default function PlanesModal({ onClose }) {
  const qc = useQueryClient()
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const [planes, setPlanes] = useState(null)
  const [edit, setEdit] = useState(null)   // objeto plan en edición (o VACIO para nuevo)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmarDel, setConfirmarDel] = useState(null)

  async function cargar() {
    const { data, error } = await supabase.from('plan').select('*').is('deleted_at', null).order('orden').order('precio')
    if (error) { setError(error.message); return }
    setPlanes(data)
  }
  if (planes === null) cargar()

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['planes'] })
    cargar()
  }

  const set = (k) => (e) => setEdit((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const payload = {
      nombre: edit.nombre.trim(),
      precio: Number(edit.precio || 0),
      unidad: edit.unidad,
      descripcion: edit.descripcion?.trim() || null,
      badge: edit.badge?.trim() || null,
      cobra_matricula: !!edit.cobra_matricula,
      precio_matricula: edit.cobra_matricula ? Number(edit.precio_matricula || 0) : 0,
      dias_congelamiento_anio: Number(edit.dias_congelamiento_anio || 0),
      multisede: !!edit.multisede,
      es_familiar: !!edit.es_familiar,
      incluye_clases: !!edit.incluye_clases,
      incluye_rutina: !!edit.incluye_rutina,
      activo: !!edit.activo,
    }
    const q = edit.id
      ? supabase.from('plan').update(payload).eq('id', edit.id)
      : supabase.from('plan').insert({ ...payload, empresa_id: empresa.id })
    const { error } = await q
    setBusy(false)
    if (error) { setError(error.message); return }
    setEdit(null); invalidar()
  }

  async function eliminar(plan) {
    setBusy(true); setError('')
    const { error } = await supabase.from('plan')
      .update({ deleted_at: new Date().toISOString(), activo: false })
      .eq('id', plan.id)
    setBusy(false); setConfirmarDel(null)
    if (error) { setError(error.message); return }
    invalidar()
  }

  return (
    <Modal title="Gestionar planes 📦" subtitle="Precios, matrícula y congelamiento de cada paquete" onClose={onClose} width={560}>
      {!edit ? (
        <>
          <div className="flex flex-col gap-2">
            {(planes || []).map((p) => (
              <div key={p.id} className={`flex items-center gap-3 rounded-[10px] border px-4 py-3 ${p.activo ? 'border-line' : 'border-line bg-surface opacity-60'}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold">
                    {p.nombre} {p.badge && <span className="ml-1 rounded-full bg-orange px-2 py-0.5 text-[9px] font-extrabold text-white">{p.badge}</span>}
                    {!p.activo && <span className="ml-1 text-[10.5px] font-bold text-faint">(desactivado)</span>}
                  </div>
                  <div className="text-[11.5px] font-semibold text-muted">
                    {money(p.precio, moneda)}/{p.unidad}
                    {p.cobra_matricula ? ` · matrícula ${money(p.precio_matricula, moneda)}` : ' · sin matrícula'}
                    {p.dias_congelamiento_anio > 0 ? ` · ❄️ congela ${p.dias_congelamiento_anio} días/año` : ' · no congela'}
                    {p.es_familiar ? ' · familiar' : ''}{p.multisede ? ' · multisede' : ''}
                  </div>
                </div>
                {confirmarDel === p.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11.5px] font-extrabold text-red">¿Eliminar?</span>
                    <button onClick={() => eliminar(p)} disabled={busy} className="cursor-pointer rounded-[8px] border-none bg-red px-3 py-1.5 text-[11.5px] font-extrabold text-white">Sí</button>
                    <button onClick={() => setConfirmarDel(null)} className="cursor-pointer rounded-[8px] border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted">No</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEdit({ ...VACIO, ...p, precio: String(p.precio), precio_matricula: String(p.precio_matricula || '') })}
                      className="cursor-pointer rounded-[8px] border border-orange bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-orange hover:bg-orange-50">Editar</button>
                    <button onClick={() => setConfirmarDel(p.id)}
                      className="cursor-pointer rounded-[8px] border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted hover:border-red hover:text-red">🗑</button>
                  </div>
                )}
              </div>
            ))}
            {planes === null && (
              <div className="flex items-center justify-center gap-3 py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-orange-100 border-t-orange" />
                <span className="text-[13px] font-bold text-muted">Cargando planes…</span>
              </div>
            )}
            {planes !== null && planes.length === 0 && <div className="py-6 text-center text-[13px] font-semibold text-muted">Sin planes aún.</div>}
          </div>
          {error && <div className="mt-3 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
          <button onClick={() => setEdit({ ...VACIO })}
            className="mt-4 w-full cursor-pointer rounded-[11px] border-2 border-dashed border-line bg-white py-3 text-[13.5px] font-extrabold text-muted hover:border-orange hover:text-orange">
            + Crear plan nuevo
          </button>
        </>
      ) : (
        <form onSubmit={guardar} className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Nombre *"><input required value={edit.nombre} onChange={set('nombre')} className={inputCls} placeholder="Premium" /></Campo>
            <Campo label="Badge (opcional)"><input value={edit.badge || ''} onChange={set('badge')} className={inputCls} placeholder="Más vendido" /></Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label={`Precio (${moneda}) *`}><input required type="number" step="0.01" min="0" value={edit.precio} onChange={set('precio')} className={inputCls} /></Campo>
            <Campo label="Periodo">
              <select value={edit.unidad} onChange={set('unidad')} className={inputCls + ' cursor-pointer'}>
                {UNIDADES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Campo>
          </div>
          <Campo label="Descripción"><input value={edit.descripcion || ''} onChange={set('descripcion')} className={inputCls} placeholder="Acceso total + clases ilimitadas" /></Campo>

          <div className="rounded-[10px] border border-line px-4 py-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!edit.cobra_matricula} onChange={set('cobra_matricula')} className="h-4 w-4 accent-orange-600" />
              <span className="text-[13px] font-extrabold">Cobra matrícula (pago único al inscribirse)</span>
            </label>
            {edit.cobra_matricula && (
              <div className="mt-2.5 max-w-[200px]">
                <Campo label={`Matrícula (${moneda})`}>
                  <input type="number" step="0.01" min="0" value={edit.precio_matricula} onChange={set('precio_matricula')} className={inputCls} />
                </Campo>
              </div>
            )}
          </div>

          <div className="rounded-[10px] border border-line px-4 py-3">
            <div className="text-[13px] font-extrabold">❄️ Congelamiento de membresía</div>
            <p className="mt-0.5 text-[11.5px] font-semibold text-muted">
              Días al año que el socio puede congelar (los días congelados no corren y se devuelven al vencimiento). 0 = este plan no permite congelar.
            </p>
            <div className="mt-2.5 max-w-[200px]">
              <input type="number" min="0" max="365" value={edit.dias_congelamiento_anio} onChange={set('dias_congelamiento_anio')} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[['incluye_clases', 'Incluye clases grupales'], ['incluye_rutina', 'Incluye rutina personalizada'], ['multisede', 'Válido en todas las sedes'], ['es_familiar', 'Plan familiar'], ['activo', 'Plan activo (visible al inscribir)']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={!!edit[k]} onChange={set(k)} className="h-4 w-4 accent-orange-600" />
                <span className="text-[12.5px] font-bold">{l}</span>
              </label>
            ))}
          </div>

          {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
          <div className="mt-1 flex justify-end gap-2.5">
            <button type="button" onClick={() => { setEdit(null); setError('') }}
              className="cursor-pointer rounded-[10px] border border-line bg-white px-5 py-2.5 text-[13px] font-extrabold text-muted">← Volver</button>
            <button type="submit" disabled={busy || !edit.nombre.trim() || edit.precio === ''}
              className="cursor-pointer rounded-[10px] border-none bg-orange px-5 py-2.5 text-[13px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] disabled:opacity-50">
              {busy ? 'Guardando…' : edit.id ? 'Guardar cambios' : 'Crear plan'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
