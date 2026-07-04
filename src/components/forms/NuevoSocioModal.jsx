import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal, { Campo, BotonesModal, inputCls } from '../Modal.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { usePlanes } from '../../hooks/useMembresias.js'
import { usePromociones } from '../../hooks/useOperaciones.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { money } from '../../lib/uiHelpers.js'

const METODOS_PAGO = [['efectivo', 'Efectivo'], ['yape', 'Yape'], ['plin', 'Plin'], ['tarjeta', 'Tarjeta (POS)'], ['transferencia', 'Transferencia']]

// Alta de socio (+ membresía y cobro con promoción y método de pago).
// Si viene de un lead (leadId), lo convierte.
export default function NuevoSocioModal({ sedeId, onClose, prefill = {}, leadId = null }) {
  const qc = useQueryClient()
  const { empresa } = useAuth()
  const planes = usePlanes()
  const promos = usePromociones()
  const [f, setF] = useState({
    nombre: prefill.nombre || '', telefono: prefill.telefono || '', email: prefill.email || '',
    documento: '', fecha_nacimiento: '', objetivo: '', plan_id: '', promocion_id: '', metodo_pago: 'efectivo',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(null) // { codigo, total, promo }

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const plan = (planes.data || []).find((p) => p.id === f.plan_id)
  const promosActivas = (promos.data || []).filter((p) => p.estado === 'activa')
  const promo = promosActivas.find((p) => p.id === f.promocion_id)

  // Cálculo del total con promoción (espejo de la lógica del RPC)
  let precio = plan ? Number(plan.precio) : 0
  let matricula = plan && plan.cobra_matricula ? Number(plan.precio_matricula || 0) : 0
  let promoNota = ''
  if (plan && promo) {
    if (promo.tipo === 'descuento_pct') { precio = Math.round(precio * (1 - Number(promo.valor || 0) / 100) * 100) / 100; promoNota = `−${promo.valor}% en la mensualidad` }
    else if (promo.tipo === 'descuento_monto') { precio = Math.max(0, precio - Number(promo.valor || 0)); promoNota = `−${money(promo.valor, empresa?.moneda)}` }
    else if (promo.tipo === 'semana_gratis') { promoNota = '+7 días de membresía' }
    else if (promo.tipo === '2x1') { matricula = 0; promoNota = 'matrícula gratis' }
    else if (promo.tipo === 'precio_especial') {
      precio = Number(promo.valor || precio)
      promoNota = promo.duracion_meses
        ? `${promo.duracion_meses} meses de membresía por ${money(promo.valor, empresa?.moneda)}`
        : `precio especial ${money(promo.valor, empresa?.moneda)}`
    }
  }
  const total = precio + matricula

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
      p_promocion_id: f.promocion_id || null,
      p_metodo_pago: f.metodo_pago,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    setExito({ codigo: data.codigo, total: data.total_cobrado, promo: data.promo_aplicada })
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
            <div className="mt-2 text-[14px] font-extrabold">Cobrado: {money(exito.total, empresa?.moneda)} <span className="text-[11px] font-semibold text-muted">({METODOS_PAGO.find(([m]) => m === f.metodo_pago)?.[1]} · registrado en caja)</span></div>
          )}
          {exito.promo && <div className="mt-1 text-[12px] font-extrabold text-orange">🎁 {exito.promo}</div>}
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
        <Campo label="Plan de membresía" hint={!plan ? 'Opcional: puedes asignarlo después.' : undefined}>
          <select value={f.plan_id} onChange={set('plan_id')} className={inputCls + ' cursor-pointer'}>
            <option value="">Sin plan por ahora</option>
            {(planes.data || []).map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} — {money(p.precio, empresa?.moneda)}/{p.unidad}</option>
            ))}
          </select>
        </Campo>

        {plan && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Promoción">
                <select value={f.promocion_id} onChange={set('promocion_id')} className={inputCls + ' cursor-pointer'}>
                  <option value="">Sin promoción</option>
                  {promosActivas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Método de pago">
                <select value={f.metodo_pago} onChange={set('metodo_pago')} className={inputCls + ' cursor-pointer'}>
                  {METODOS_PAGO.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              </Campo>
            </div>
            {/* Resumen del cobro */}
            <div className="rounded-[10px] bg-surface px-3.5 py-3">
              <div className="flex justify-between text-[12.5px] font-bold text-muted">
                <span>Mensualidad {plan.nombre}</span><span>{money(precio, empresa?.moneda)}</span>
              </div>
              {matricula > 0 && (
                <div className="mt-1 flex justify-between text-[12.5px] font-bold text-muted">
                  <span>Matrícula</span><span>{money(matricula, empresa?.moneda)}</span>
                </div>
              )}
              {promoNota && (
                <div className="mt-1 flex justify-between text-[12px] font-extrabold text-orange">
                  <span>🎁 {promo?.nombre}</span><span>{promoNota}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-[14px] font-extrabold">
                <span>Total a cobrar</span><span>{money(total, empresa?.moneda)}</span>
              </div>
            </div>
          </>
        )}
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel={f.plan_id ? `Inscribir y cobrar ${money(total, empresa?.moneda)}` : 'Inscribir'} />
      </form>
    </Modal>
  )
}
