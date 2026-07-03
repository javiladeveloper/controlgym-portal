import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, StatCard, Avatar } from '../components/ui.jsx'
import { CheckIcon } from '../components/icons.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import NuevoSocioModal from '../components/forms/NuevoSocioModal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePanel } from '../store.jsx'
import { useLeads, useAvanzarLead, useTareas, useToggleTarea, ETAPAS, ETAPA_LABEL } from '../hooks/useCRM.js'
import { iniciales } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const FUENTES = ['Recepción', 'Instagram', 'Facebook', 'TikTok', 'WhatsApp', 'Referido', 'Página web', 'Otro']

function NuevoProspectoModal({ sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ nombre: '', telefono: '', email: '', fuente: 'Recepción', nota: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.from('lead').insert({
      empresa_id: empresaId, sede_id: sedeId,
      nombre: f.nombre.trim(), telefono: f.telefono || null, email: f.email || null,
      fuente: f.fuente, nota: f.nota || null, etapa: 'nuevo',
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['leads', sedeId] })
    onClose()
  }

  return (
    <Modal title="Nuevo prospecto" subtitle="Entra al embudo en la etapa Nuevo" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Teléfono"><input value={f.telefono} onChange={set('telefono')} className={inputCls} /></Campo>
          <Campo label="Correo"><input type="email" value={f.email} onChange={set('email')} className={inputCls} /></Campo>
        </div>
        <Campo label="¿Cómo nos conoció?">
          <select value={f.fuente} onChange={set('fuente')} className={inputCls + ' cursor-pointer'}>
            {FUENTES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Campo>
        <Campo label="Nota"><textarea rows={2} value={f.nota} onChange={set('nota')} className={inputCls + ' resize-none'} placeholder="Le interesa el plan Pro…" /></Campo>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel="Agregar prospecto" />
      </form>
    </Modal>
  )
}

export default function CRM() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [convertir, setConvertir] = useState(null) // lead a convertir en socio
  const leads = useLeads(sedeId)
  const avanzar = useAvanzarLead(sedeId)
  const tareas = useTareas(sedeId)
  const toggleTarea = useToggleTarea(sedeId)

  const cols = ETAPAS.map((etapa) => ({
    etapa,
    label: ETAPA_LABEL[etapa],
    items: (leads.data || []).filter((l) => l.etapa === etapa),
  }))
  const pendientes = (tareas.data || []).filter((t) => !t.completada).length
  const inscritos = (leads.data || []).filter((l) => l.etapa === 'inscrito').length

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">CRM · Prospectos</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Embudo de captación y seguimiento · {sedeNombre}</p>
        </div>
        <button onClick={() => setNuevoOpen(true)}
          className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nuevo prospecto</button>
      </div>

      {nuevoOpen && <NuevoProspectoModal sedeId={sedeId} empresaId={empresa?.id} onClose={() => setNuevoOpen(false)} />}
      {convertir && (
        <NuevoSocioModal
          sedeId={sedeId}
          leadId={convertir.id}
          prefill={{ nombre: convertir.nombre, telefono: convertir.telefono, email: convertir.email }}
          onClose={() => setConvertir(null)}
        />
      )}

      <div className="mt-5 grid grid-cols-4 gap-[15px]">
        <StatCard label="Leads totales" value={leads.data?.length ?? 0} delta="en el embudo" />
        <StatCard label="Inscritos" value={inscritos} delta="convertidos" deltaColor={T.success} />
        <StatCard label="En proceso" value={(leads.data?.length ?? 0) - inscritos} delta="en seguimiento" />
        <StatCard label="Seguimientos hoy" value={pendientes} delta="tareas pendientes" variant="accent" />
      </div>

      {leads.isLoading && <LoadingState variant="cards" rows={4} />}
      {leads.error && <ErrorState error={leads.error} onRetry={leads.refetch} />}

      {leads.data && (
        <div className="mt-[15px] grid grid-cols-4 items-start gap-3">
          {cols.map((col) => (
            <div key={col.etapa} className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between rounded-[10px] bg-navy px-[13px] py-[9px]">
                <span className="text-[12.5px] font-extrabold text-white">{col.label}</span>
                <span className="text-[11px] font-extrabold text-orange">{col.items.length}</span>
              </div>
              {col.items.map((ld) => {
                const last = ld.etapa === 'inscrito'
                return (
                  <Card key={ld.id} className="p-[13px] hover:border-orange">
                    <div className="flex items-center gap-2.5">
                      <Avatar ini={iniciales(ld.nombre)} bg={T.chipNavy} color={T.navy} size={30} fontSize={11} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-extrabold leading-[1.25]">{ld.nombre}</div>
                        <div className="text-[10.5px] font-bold text-muted">{ld.fuente}</div>
                      </div>
                    </div>
                    {ld.nota && <div className="mt-2.5 text-[11.5px] font-semibold leading-[1.45] text-muted">{ld.nota}</div>}
                    <div className="mt-2.5 flex items-center justify-between gap-1.5">
                      <span className="text-[10.5px] font-extrabold text-faint">
                        {ld.created_at ? new Date(ld.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : ''}
                      </span>
                      <div className="flex gap-1.5">
                        {/* Convertir en socio real (si aún no lo es) */}
                        {!ld.socio_id && (ld.etapa === 'clase_prueba' || ld.etapa === 'inscrito') && (
                          <button onClick={() => setConvertir(ld)}
                            className="cursor-pointer rounded-lg border-none px-[10px] py-1.5 text-[10.5px] font-extrabold text-white active:scale-[0.96]"
                            style={{ background: T.success }}>
                            → Socio
                          </button>
                        )}
                        {ld.socio_id ? (
                          <span className="rounded-lg px-[10px] py-1.5 text-[10.5px] font-extrabold" style={{ background: T.successBg, color: T.success }}>Socio ✓</span>
                        ) : !last && (
                          <button onClick={() => avanzar.mutate({ id: ld.id, etapa: ld.etapa })}
                            className="cursor-pointer rounded-lg px-[11px] py-1.5 text-[10.5px] font-extrabold active:scale-[0.96]"
                            style={{ border: `1px solid ${T.primary}`, background: 'transparent', color: T.primary }}>
                            Avanzar →
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Seguimientos */}
      <Card className="mt-[15px] max-w-[860px] overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[14.5px] font-extrabold">Seguimientos de hoy</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Marca cada contacto como realizado</div>
        </div>
        {tareas.isLoading && <LoadingState variant="table" rows={3} />}
        {(tareas.data || []).length === 0 && !tareas.isLoading && (
          <div className="px-5 py-6 text-[12.5px] font-semibold text-muted">Sin seguimientos pendientes.</div>
        )}
        {(tareas.data || []).map((t) => {
          const isDone = t.completada
          const tipoNav = t.tipo === 'llamada'
          return (
            <div key={t.id} onClick={() => toggleTarea.mutate({ id: t.id, completada: !isDone })}
              className="flex cursor-pointer items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2"
                style={{ borderColor: isDone ? T.success : '#C6CBD4', background: isDone ? T.success : 'transparent' }}>
                <CheckIcon size={12} opacity={isDone ? 1 : 0} />
              </div>
              <span className="flex-shrink-0 rounded-full px-[11px] py-[5px] text-[11px] font-extrabold capitalize"
                style={{ background: tipoNav ? T.chipNavy : T.successBg, color: tipoNav ? T.navy : T.success }}>
                {t.tipo}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-extrabold" style={{ textDecoration: isDone ? 'line-through' : 'none' }}>{t.lead?.nombre}</div>
                {t.detalle && <div className="mt-px text-[11.5px] font-semibold text-muted">{t.detalle}</div>}
              </div>
              <div className="flex-shrink-0 text-[12px] font-extrabold text-faint">
                {t.vence_at ? new Date(t.vence_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
            </div>
          )
        })}
      </Card>
    </div>
  )
}
