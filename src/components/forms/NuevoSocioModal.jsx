import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal, { Campo, BotonesModal, inputCls } from '../Modal.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { usePlanes } from '../../hooks/useMembresias.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { money } from '../../lib/uiHelpers.js'

// Alta de socio (+ membresía y cobro). Si viene de un lead (leadId), lo convierte.
export default function NuevoSocioModal({ sedeId, onClose, prefill = {}, leadId = null }) {
  const qc = useQueryClient()
  const { empresa } = useAuth()
  const planes = usePlanes()
  const [f, setF] = useState({
    nombre: prefill.nombre || '', telefono: prefill.telefono || '', email: prefill.email || '',
    documento: '', fecha_nacimiento: '', objetivo: '', plan_id: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(null) // { codigo, total }

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const plan = (planes.data || []).find((p) => p.id === f.plan_id)
  const total = plan ? Number(plan.precio) + (plan.cobra_matricula ? Number(plan.precio_matricula || 0) : 0) : 0

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { data, error } = await supabase.rpc('inscribir_socio', {
      p_sede_id: sedeId,
      p_nombre: f.nombre, p_telefono: f.telefono || null, p_email: f.email || null,
      p_documento: f.documento || null,
      p_fecha_nacimiento: f.fecha_nacimiento || null,
      p_objetivo: f.objetivo || null,
      p_plan_id: f.plan_id || null,
      p_lead_id: leadId,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setExito({ codigo: data.codigo, total: data.total_cobrado })
    qc.invalidateQueries({ queryKey: ['clientes', sedeId] })
    qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
    qc.invalidateQueries({ queryKey: ['socios-select', sedeId] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
    qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    if (leadId) qc.invalidateQueries({ queryKey: ['leads', sedeId] })
  }

  if (exito) {
    return (
      <Modal title="¡Socio inscrito! 🎉" onClose={onClose} width={400}>
        <div className="rounded-[10px] bg-green-50 p-4 text-center">
          <div className="text-[15px] font-extrabold text-green-600">{f.nombre}</div>
          <div className="mt-1 text-[13px] font-bold text-muted">Socio N.º {exito.codigo}</div>
          {Number(exito.total) > 0 && (
            <div className="mt-2 text-[14px] font-extrabold">Cobrado: {money(exito.total, empresa?.moneda)} <span className="text-[11px] font-semibold text-muted">(registrado en caja)</span></div>
          )}
        </div>
        <button onClick={onClose} className="mt-4 w-full cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600">Listo</button>
      </Modal>
    )
  }

  return (
    <Modal title={leadId ? 'Convertir en socio' : 'Nuevo socio'} subtitle="Se inscribe en la sede actual" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre completo *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="Carlos Mendoza" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Teléfono"><input value={f.telefono} onChange={set('telefono')} className={inputCls} placeholder="999 888 777" /></Campo>
          <Campo label="Documento (DNI)"><input value={f.documento} onChange={set('documento')} className={inputCls} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Correo"><input type="email" value={f.email} onChange={set('email')} className={inputCls} /></Campo>
          <Campo label="Fecha de nacimiento"><input type="date" value={f.fecha_nacimiento} onChange={set('fecha_nacimiento')} className={inputCls} /></Campo>
        </div>
        <Campo label="Objetivo"><input value={f.objetivo} onChange={set('objetivo')} className={inputCls} placeholder="Pérdida de grasa, tonificación…" /></Campo>
        <Campo label="Plan de membresía" hint={plan ? `Se cobrará ${money(total, empresa?.moneda)}${plan.cobra_matricula && Number(plan.precio_matricula) > 0 ? ' (incluye matrícula)' : ''} y quedará registrado en caja.` : 'Opcional: puedes asignarlo después.'}>
          <select value={f.plan_id} onChange={set('plan_id')} className={inputCls + ' cursor-pointer'}>
            <option value="">Sin plan por ahora</option>
            {(planes.data || []).map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} — {money(p.precio, empresa?.moneda)}/{p.unidad}</option>
            ))}
          </select>
        </Campo>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel={f.plan_id ? `Inscribir y cobrar ${money(total, empresa?.moneda)}` : 'Inscribir'} />
      </form>
    </Modal>
  )
}
