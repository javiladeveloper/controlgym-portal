import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, StatCard, Avatar } from '../components/ui.jsx'
import { CheckIcon, WhatsAppIcon } from '../components/icons.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import NuevoSocioModal from '../components/forms/NuevoSocioModal.jsx'
import CampanaWhatsAppModal from '../components/forms/CampanaWhatsAppModal.jsx'
import { verificarDni, textoVerificacion } from '../lib/dni.js'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePanel } from '../store.jsx'
import { useLeads, useAvanzarLead, useTareas, useToggleTarea, ETAPAS, ETAPA_LABEL } from '../hooks/useCRM.js'
import { iniciales } from '../lib/uiHelpers.js'
import { waLink, msgLead } from '../lib/whatsapp.js'
import { toast } from '../lib/toast.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const FUENTES = ['Recepción', 'Instagram', 'Facebook', 'TikTok', 'WhatsApp', 'Referido', 'Página web', 'Otro']

// Alta y edición de prospecto (mismo formulario). Editando además permite eliminar.
function ProspectoModal({ sedeId, empresaId, lead = null, onClose }) {
  const qc = useQueryClient()
  const editando = !!lead
  const [f, setF] = useState({
    nombre: lead?.nombre || '', telefono: lead?.telefono || '', email: lead?.email || '',
    fuente: lead?.fuente || 'Recepción', nota: lead?.nota || '', documento: lead?.documento || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmarDel, setConfirmarDel] = useState(false)
  const [verif, setVerif] = useState(null) // verificación del DNI vs padrón (MAXFIND)
  const [confirmarNombre, setConfirmarNombre] = useState(false) // guardar pese a que el nombre no coincide con el padrón
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  // Aquí SÍ se valida el DNI que el interesado dejó en la página del gym:
  // el gym ve al revisar la solicitud si nombre y documento corresponden
  useEffect(() => {
    const dni = (f.documento || '').replace(/\D/g, '')
    if (dni.length !== 8 || !f.nombre.trim()) { setVerif(null); return }
    setVerif({ buscando: true })
    setConfirmarNombre(false) // cambió el dato: exige confirmar de nuevo si no coincide
    const t = setTimeout(async () => setVerif(await verificarDni({ dni, nombre: f.nombre })), 400)
    return () => clearTimeout(t)
  }, [f.documento, f.nombre])

  function invalidar() { qc.invalidateQueries({ queryKey: ['leads', sedeId] }) }

  async function guardar(e) {
    e?.preventDefault()
    // El nombre no coincide con el padrón: no guardamos a la primera, pedimos
    // una confirmación explícita para que la alerta roja no sea solo cosmética.
    if (verif?.coincide === false && !confirmarNombre) {
      setConfirmarNombre(true)
      return
    }
    setBusy(true); setError('')
    const payload = {
      nombre: f.nombre.trim(), telefono: f.telefono || null, email: f.email || null,
      fuente: f.fuente, nota: f.nota || null, documento: f.documento.replace(/\D/g, '') || null,
    }
    const q = editando
      ? supabase.from('lead').update(payload).eq('id', lead.id)
      : supabase.from('lead').insert({ ...payload, empresa_id: empresaId, sede_id: sedeId, etapa: 'nuevo' })
    const { error } = await q
    setBusy(false)
    if (error) { setError(error.message); return }
    invalidar(); onClose()
  }

  async function eliminar() {
    setBusy(true); setError('')
    const { error } = await supabase.from('lead')
      .update({ deleted_at: new Date().toISOString() }).eq('id', lead.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    invalidar(); onClose()
    toast.undo(`Prospecto ${lead.nombre} eliminado`, async () => {
      const { error: errRestore } = await supabase.from('lead').update({ deleted_at: null }).eq('id', lead.id)
      invalidar()
      // Supabase no lanza: hay que revisar el objeto {error} para no anunciar
      // una restauración que en realidad falló (RLS/red).
      if (errRestore) { toast.error('No se pudo restaurar: ' + errRestore.message); return }
      toast.ok('Prospecto restaurado')
    })
  }

  return (
    <Modal title={editando ? 'Editar prospecto' : 'Nuevo prospecto'}
      subtitle={editando ? lead.nombre : 'Entra al embudo en la etapa Nuevo'} onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Teléfono"><input value={f.telefono} onChange={set('telefono')} className={inputCls} /></Campo>
          <Campo label="Correo"><input type="email" value={f.email} onChange={set('email')} className={inputCls} /></Campo>
        </div>
        <Campo label="DNI (para verificar identidad)">
          <input value={f.documento} onChange={set('documento')} className={inputCls} maxLength={8} inputMode="numeric" />
        </Campo>
        {verif?.buscando && <p className="-mt-2 text-[11.5px] font-bold text-faint">Verificando contra el padrón…</p>}
        {(() => {
          const t = textoVerificacion(verif)
          if (!t) return null
          const cls = t.tipo === 'ok' ? 'bg-green-50 text-green-700' : t.tipo === 'alerta' ? 'bg-red-50 text-red' : 'bg-amber-50 text-amber-800'
          return <p className={`-mt-2 rounded-[8px] px-3 py-1.5 text-[11.5px] font-extrabold ${cls}`}>{t.texto}</p>
        })()}
        <Campo label="¿Cómo nos conoció?">
          <select value={f.fuente} onChange={set('fuente')} className={inputCls + ' cursor-pointer'}>
            {FUENTES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </Campo>
        <Campo label="Nota"><textarea rows={2} value={f.nota} onChange={set('nota')} className={inputCls + ' resize-none'} placeholder="Le interesa el plan Pro…" /></Campo>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        {confirmarNombre && verif?.coincide === false && (
          <div className="rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-extrabold text-amber-800">
            El nombre no coincide con el padrón. Pulsa “{editando ? 'Guardar cambios' : 'Agregar prospecto'}” otra vez para guardarlo de todos modos.
          </div>
        )}
        {editando && (
          confirmarDel ? (
            <div className="flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5">
              <span className="flex-1 text-[12.5px] font-extrabold text-red">¿Eliminar este prospecto?</span>
              <button type="button" disabled={busy} onClick={eliminar}
                className="cursor-pointer rounded-[8px] border-none bg-red px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50">Sí, eliminar</button>
              <button type="button" onClick={() => setConfirmarDel(false)}
                className="cursor-pointer rounded-[8px] border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted">No</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmarDel(true)}
              className="cursor-pointer self-start border-none bg-transparent p-0 text-[12.5px] font-extrabold text-red hover:underline">
              🗑 Eliminar prospecto
            </button>
          )
        )}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel={editando ? 'Guardar cambios' : 'Agregar prospecto'} />
      </form>
    </Modal>
  )
}

export default function CRM() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const qc = useQueryClient()
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [campanaOpen, setCampanaOpen] = useState(false)
  const [sobreCol, setSobreCol] = useState(null) // columna resaltada durante el drag

  // Drag & drop: soltar la tarjeta en una columna la mueve a ESA etapa
  // (en cualquier dirección, no solo avanzar) con actualización optimista.
  // Mismo patrón que useAvanzarLead: cancelar queries en vuelo antes de la
  // escritura optimista (para que un refetch no la pise), snapshot para
  // revertir al instante si falla, e invalidar al terminar.
  async function moverLead(id, etapa) {
    const lead = (leads.data || []).find((l) => l.id === id)
    if (!lead || lead.etapa === etapa) return
    await qc.cancelQueries({ queryKey: ['leads', sedeId] })
    const prev = qc.getQueryData(['leads', sedeId])
    qc.setQueryData(['leads', sedeId], (old) => (old || []).map((l) => (l.id === id ? { ...l, etapa } : l)))
    const { error } = await supabase.from('lead').update({ etapa }).eq('id', id)
    if (error) {
      toast.error('No se pudo mover: ' + error.message)
      if (prev) qc.setQueryData(['leads', sedeId], prev)
    }
    qc.invalidateQueries({ queryKey: ['leads', sedeId] })
  }
  const [editar, setEditar] = useState(null) // lead en edición
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
  // Convertidos DE VERDAD: los que ya son socios (tienen socio_id). Un lead
  // puede estar en la columna "Inscrito" sin haberse convertido aún (arrastrado
  // a mano), así que contar por etapa inflaba el número.
  const inscritos = (leads.data || []).filter((l) => l.socio_id).length

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">CRM · Prospectos</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Embudo de captación y seguimiento · {sedeNombre}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCampanaOpen(true)} title="Mensajes por segmento: vencidos, por vencer, de baja…"
            className="cursor-pointer rounded-[10px] border border-green-300 bg-green-50 px-[16px] py-[11px] text-[13px] font-extrabold text-green-700 transition-colors hover:bg-green-100">
            📣 Campaña WhatsApp
          </button>
          <button onClick={() => setNuevoOpen(true)}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nuevo prospecto</button>
        </div>
      </div>

      {nuevoOpen && <ProspectoModal sedeId={sedeId} empresaId={empresa?.id} onClose={() => setNuevoOpen(false)} />}
      {campanaOpen && <CampanaWhatsAppModal sedeId={sedeId} onClose={() => setCampanaOpen(false)} />}
      {editar && <ProspectoModal sedeId={sedeId} empresaId={empresa?.id} lead={editar} onClose={() => setEditar(null)} />}
      {convertir && (
        <NuevoSocioModal
          sedeId={sedeId}
          leadId={convertir.id}
          prefill={{ nombre: convertir.nombre, telefono: convertir.telefono, email: convertir.email, documento: convertir.documento }}
          onClose={() => setConvertir(null)}
        />
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
        <StatCard label="Leads totales" value={leads.data?.length ?? 0} delta="en el embudo" />
        <StatCard label="Inscritos" value={inscritos} delta="convertidos" deltaColor={T.success} />
        <StatCard label="En proceso" value={(leads.data?.length ?? 0) - inscritos} delta="en seguimiento" />
        <StatCard label="Seguimientos hoy" value={pendientes} delta="tareas pendientes" variant="accent" />
      </div>

      {leads.isLoading && <LoadingState variant="cards" rows={4} />}
      {leads.error && <ErrorState error={leads.error} onRetry={leads.refetch} />}

      {leads.data && (
        <div className="mt-[15px] grid grid-cols-4 items-start gap-3 max-lg:flex max-lg:snap-x max-lg:overflow-x-auto max-lg:pb-2 max-lg:[&>div]:w-[78vw] max-lg:[&>div]:flex-shrink-0 max-lg:[&>div]:snap-start">
          {cols.map((col) => (
            <div key={col.etapa}
              onDragOver={(e) => { e.preventDefault(); setSobreCol(col.etapa) }}
              onDragLeave={() => setSobreCol((s) => (s === col.etapa ? null : s))}
              onDrop={(e) => {
                e.preventDefault()
                setSobreCol(null)
                const id = e.dataTransfer.getData('lead')
                if (id) moverLead(id, col.etapa)
              }}
              className={`flex min-h-[120px] flex-col gap-2.5 rounded-[12px] transition-colors ${sobreCol === col.etapa ? 'bg-orange/10 outline-dashed outline-2 outline-orange/50' : ''}`}>
              <div className="flex items-center justify-between rounded-[10px] bg-navy px-[13px] py-[9px]">
                <span className="text-[12.5px] font-extrabold text-white">{col.label}</span>
                <span className="text-[11px] font-extrabold text-orange">{col.items.length}</span>
              </div>
              {col.items.map((ld) => {
                const last = ld.etapa === 'inscrito'
                return (
                  <Card key={ld.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('lead', ld.id); e.dataTransfer.effectAllowed = 'move' }}
                    className="cursor-grab p-[13px] hover:border-orange active:cursor-grabbing">
                    <div className="flex items-center gap-2.5">
                      <Avatar ini={iniciales(ld.nombre)} bg={T.chipNavy} color={T.navy} size={30} fontSize={11} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-extrabold leading-[1.25]">{ld.nombre}</div>
                        <div className="text-[10.5px] font-bold text-muted">{ld.fuente}</div>
                      </div>
                      {/* waLink devuelve null si el teléfono no tiene dígitos
                          (p.ej. "llamar recepción"): en ese caso no pintamos el
                          botón para no dejar un enlace de WhatsApp muerto. */}
                      {(() => {
                        const wa = ld.telefono && waLink(ld.telefono, msgLead({ lead: ld.nombre, gym: empresa?.nombre, etapa: ld.etapa }))
                        if (!wa) return null
                        return (
                          <a href={wa}
                            target="_blank" rel="noreferrer" title="Escribirle por WhatsApp"
                            className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                            style={{ background: '#25D366' }}><WhatsAppIcon size={13} /></a>
                        )
                      })()}
                      <button onClick={() => setEditar(ld)} title="Editar prospecto"
                        className="cursor-pointer rounded-md border-none bg-transparent px-1 text-[13px] text-faint hover:text-orange">✏️</button>
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
                        ) : !last && ld.etapa !== 'clase_prueba' && (
                          /* Desde "Clase de prueba" el único paso adelante es
                             convertir en socio (botón "→ Socio"): NO ofrecemos
                             "Avanzar →" para no crear un "inscrito" fantasma sin
                             socio ni cobro. */
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
        {tareas.error && !tareas.isLoading && (
          <ErrorState error={tareas.error} onRetry={tareas.refetch} />
        )}
        {!tareas.error && (tareas.data || []).length === 0 && !tareas.isLoading && (
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
