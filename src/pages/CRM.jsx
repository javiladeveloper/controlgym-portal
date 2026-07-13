import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import {
  useLeads, useAvanzarLead, useTareas, useToggleTarea, ETAPAS, ETAPA_LABEL,
  useCrearTarea, useAgendaComercial, useExSocios, TAREA_TIPOS, TAREA_TIPO_LABEL, TAREA_TIPO_ICONO,
  useMarcarPerdido,
} from '../hooks/useCRM.js'
import { iniciales, money } from '../lib/uiHelpers.js'
import { waLink, msgLead } from '../lib/whatsapp.js'
import { usePlanes } from '../hooks/useMembresias.js'
import { usePromociones } from '../hooks/useOperaciones.js'
import { toast } from '../lib/toast.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const FUENTES = ['Recepción', 'Instagram', 'Facebook', 'TikTok', 'WhatsApp', 'Referido', 'Página web', 'Otro']

// Nivel con el que la IA de Leadia calificó al prospecto antes de mandarlo al
// CRM. Solo llegan calientes y tibios (los fríos el bot los ignora); el badge
// deja ver de un vistazo a quién priorizar.
const NIVEL_LEADIA = {
  caliente: { label: '🔥 Caliente', bg: '#FEE2E2', color: '#B91C1C' },
  tibio: { label: '🌤 Tibio', bg: '#FEF3C7', color: '#B45309' },
}

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
        {verif?.buscando && <p className="-mt-2 animate-pulse rounded-[8px] bg-amber-50 px-3 py-1.5 text-[11.5px] font-extrabold text-amber-800">🔍 Verificando el DNI en el padrón…</p>}
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

// Fila compacta de una tarea de agenda: check · hora/fecha · tipo · lead · detalle · asignado.
// El check completa la tarea aquí mismo — la agenda es el ÚNICO panel de
// seguimiento (antes había un segundo panel "Seguimientos de hoy" que
// duplicaba esto y confundía: "arriba ya vemos los pendientes").
function FilaAgenda({ t, conFecha, onCompletar }) {
  const icono = TAREA_TIPO_ICONO[t.tipo] || '📝'
  const fh = t.vence_at ? new Date(t.vence_at) : null
  const cuando = fh
    ? conFecha
      ? fh.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' · ' + fh.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
      : fh.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    : '—'
  return (
    <div className="flex items-center gap-2.5 border-t border-line2 px-4 py-2.5 text-[12.5px] first:border-t-0">
      <button type="button" onClick={() => onCompletar(t)} title="Marcar como realizado"
        className="flex h-6 w-6 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-[#C6CBD4] bg-transparent transition-colors hover:border-green hover:bg-green-50" />
      <span className="w-[92px] flex-shrink-0 font-extrabold text-faint">{cuando}</span>
      <span className="flex-shrink-0" title={t.tipo}>{icono}</span>
      <span className="min-w-0 flex-1 truncate font-extrabold">{t.lead_nombre}</span>
      {t.detalle && <span className="hidden min-w-0 flex-[1.4] truncate font-semibold text-muted sm:block">{t.detalle}</span>}
      <span className="flex-shrink-0 text-[11px] font-bold text-faint">{t.asignado_nombre || 'Sin asignar'}</span>
    </div>
  )
}

function GrupoAgenda({ titulo, color, items, conFecha, onCompletar }) {
  if (!items.length) return null
  return (
    <div className="mt-3 first:mt-0">
      <div className="px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.5px]" style={{ color }}>{titulo} · {items.length}</div>
      {items.map((t) => <FilaAgenda key={t.id} t={t} conFecha={conFecha} onCompletar={onCompletar} />)}
    </div>
  )
}

// Card colapsada por defecto arriba del pipeline. El hook (y su RPC) solo se
// monta cuando el usuario expande, igual que TablaHistorialCaja en Finanzas.jsx.
function AgendaComercial({ sedeId, empresaId, leads }) {
  // Abierta por defecto: es EL panel de trabajo del seguimiento (único).
  const [abierto, setAbierto] = useState(true)
  const [nuevaTareaOpen, setNuevaTareaOpen] = useState(false)
  const toggleTarea = useToggleTarea(sedeId)
  const completar = (t) => toggleTarea.mutate({ id: t.id, completada: true },
    { onSuccess: () => toast.ok(`Seguimiento con ${t.lead_nombre} realizado ✓`) })
  const { rol } = useAuth()
  // El RPC agenda_comercial filtra: el comunicador recibe SOLO sus tareas;
  // admin/recepción ven las del equipo. El texto acompaña esa realidad.
  const esComunicador = rol === 'comunicador'
  const agenda = useAgendaComercial(abierto)
  const vencidas = agenda.data?.vencidas || []
  const nVencidas = vencidas.length
  return (
    <Card className="mt-5 overflow-hidden">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-4 text-left">
        <div className="flex items-center gap-2">
          <span className="text-[14.5px] font-extrabold">📅 Agenda de seguimiento <span className="ml-1 text-[11.5px] font-semibold text-muted">{esComunicador ? '— tus tareas con leads: vencidas, de hoy y próximas' : '— tareas del equipo con leads: vencidas, de hoy y próximas · cada una muestra su responsable'}</span></span>
          {nVencidas > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: T.dangerBg, color: T.danger }}>
              {nVencidas} vencida{nVencidas > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span className="text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver agenda ▼'}</span>
      </button>
      {abierto && (
        <div className="flex items-center justify-between border-t border-line2 px-5 py-2.5">
          <span className="text-[11.5px] font-semibold text-muted">Marca el círculo cuando hagas el contacto · se archiva solo</span>
          <button type="button" onClick={() => setNuevaTareaOpen((v) => !v)}
            className="flex-shrink-0 cursor-pointer rounded-[9px] border border-orange bg-transparent px-3 py-1.5 text-[11.5px] font-extrabold text-orange transition-colors hover:bg-orange-50">
            {nuevaTareaOpen ? 'Cerrar' : '+ Tarea'}
          </button>
        </div>
      )}
      {abierto && nuevaTareaOpen && (
        <NuevaTareaForm sedeId={sedeId} empresaId={empresaId} leads={leads} onDone={() => setNuevaTareaOpen(false)} />
      )}
      {abierto && (
        <div className="border-t border-line2">
          {agenda.isLoading && <LoadingState variant="table" rows={3} />}
          {agenda.isError && <ErrorState error={agenda.error} onRetry={agenda.refetch} />}
          {!agenda.isLoading && !agenda.isError && (
            (vencidas.length + (agenda.data?.hoy?.length || 0) + (agenda.data?.proximas?.length || 0)) === 0 ? (
              <div className="px-5 py-6 text-[12.5px] font-semibold text-muted">Sin tareas pendientes en los próximos 7 días.</div>
            ) : (
              <div className="pb-2">
                <GrupoAgenda titulo="Vencidas" color={T.danger} items={vencidas} conFecha onCompletar={completar} />
                <GrupoAgenda titulo="Hoy" color={T.warning} items={agenda.data?.hoy || []} onCompletar={completar} />
                <GrupoAgenda titulo="Próximas 7 días" color={T.muted} items={agenda.data?.proximas || []} conFecha onCompletar={completar} />
              </div>
            )
          )}
        </div>
      )}
    </Card>
  )
}

// Tarifario rápido para el equipo comercial: planes con precio y promociones
// activas, para saber QUÉ OFRECER a un prospecto sin salir del CRM (pedido del
// owner: "los comunicadores deben poder ver las promociones y costos").
// Mismo patrón que la agenda: colapsado por defecto y las queries montan
// recién al expandir (el subcomponente es quien usa los hooks).
function QueOfrecerContenido({ moneda, empresaId }) {
  const planes = usePlanes(empresaId)
  const promos = usePromociones()
  const activas = (promos.data || []).filter((p) => p.estado === 'activa')
  const cargando = planes.isLoading || promos.isLoading
  const error = planes.error || promos.error
  return (
    <div className="border-t border-line2 px-5 py-4">
      {cargando && <LoadingState variant="table" rows={2} />}
      {error && <ErrorState error={error} onRetry={() => { planes.refetch(); promos.refetch() }} />}
      {!cargando && !error && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Planes y precios</div>
            {(planes.data || []).map((pl) => (
              <div key={pl.id} className="flex items-center justify-between border-b border-line2 py-2 last:border-none">
                <span className="text-[13px] font-bold">
                  {pl.nombre}
                  {pl.badge && <span className="ml-1.5 rounded-full bg-orange-50 px-2 py-0.5 text-[10.5px] font-extrabold text-orange">{pl.badge}</span>}
                </span>
                <span className="text-[13px] font-extrabold tabular-nums">{money(pl.precio, moneda)}<span className="text-[11px] font-semibold text-faint">/{pl.unidad}</span></span>
              </div>
            ))}
            {(planes.data || []).length === 0 && <div className="text-[12.5px] font-semibold text-faint">Sin planes configurados.</div>}
          </div>
          <div>
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Promociones activas</div>
            {activas.map((pr) => (
              <div key={pr.id} className="border-b border-line2 py-2 last:border-none">
                <div className="text-[13px] font-bold">🎁 {pr.nombre}</div>
                {pr.descripcion && <div className="mt-0.5 text-[12px] font-semibold leading-[1.45] text-muted">{pr.descripcion}</div>}
              </div>
            ))}
            {activas.length === 0 && <div className="text-[12.5px] font-semibold text-faint">Sin promociones activas ahora.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function QueOfrecer({ moneda, empresaId }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Card className="mt-4 overflow-hidden">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-4 text-left">
        <span className="text-[14.5px] font-extrabold">💰 Qué ofrecer <span className="ml-1 text-[11.5px] font-semibold text-muted">— planes con precio y promociones activas, para cotizar al toque</span></span>
        <span className="text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver precios ▼'}</span>
      </button>
      {abierto && <QueOfrecerContenido moneda={moneda} empresaId={empresaId} />}
    </Card>
  )
}

// "No todos al final se convierten": marcar un lead como PERDIDO con su motivo.
// Sale del embudo, cierra sus tareas y deja de contar como carga del asesor.
const MOTIVOS_PERDIDA = ['No contesta', 'No le interesó', 'Por precio', 'Se fue a otro gym']
function PerderLeadModal({ lead, sedeId, onClose }) {
  const marcar = useMarcarPerdido(sedeId)
  const [motivo, setMotivo] = useState('No contesta')
  function confirmar() {
    marcar.mutate({ leadId: lead.id, motivo }, {
      onSuccess: () => { toast.ok(`${lead.nombre} marcado como perdido (${motivo.toLowerCase()})`); onClose() },
      onError: (e) => toast.error(e.message),
    })
  }
  return (
    <Modal title="Marcar como perdido" subtitle={`${lead.nombre} saldrá del embudo y sus tareas se cerrarán`} onClose={onClose} width={400}>
      <div className="flex flex-col gap-2">
        {MOTIVOS_PERDIDA.map((m) => (
          <label key={m} className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[13px] font-bold ${motivo === m ? 'border-orange bg-orange-50' : 'border-line bg-white'}`}>
            <input type="radio" name="motivo-perdida" checked={motivo === m} onChange={() => setMotivo(m)} className="accent-[#FF6B35]" />
            {m}
          </label>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] font-semibold text-faint">Queda guardado en "Perdidos" — se puede reabrir si vuelve a dar señales.</p>
      <BotonesModal onCancel={onClose} busy={marcar.isPending} submitLabel="Marcar perdido" onSubmit={confirmar} />
    </Modal>
  )
}

// Perdidos: colapsado, solo lectura + Reabrir (vuelve a 'contactado' para no
// disparar la rotación de 7 días con un reloj viejo).
function PerdidosPanel({ perdidos, sedeId }) {
  const qc = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  if (!perdidos.length) return null
  async function reabrir(ld) {
    const { error } = await supabase.from('lead')
      .update({ etapa: 'contactado', motivo_perdida: null, perdido_at: null }).eq('id', ld.id)
    if (error) { toast.error('No se pudo reabrir: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['leads', sedeId] })
    toast.ok(`${ld.nombre} reabierto — de vuelta al embudo`)
  }
  return (
    <Card className="mt-4 overflow-hidden">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-4 text-left">
        <span className="text-[14.5px] font-extrabold">🚫 Perdidos <span className="ml-1 text-[11.5px] font-semibold text-muted">— no compraron o dejaron de responder · {perdidos.length}</span></span>
        <span className="text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver ▼'}</span>
      </button>
      {abierto && (
        <div className="border-t border-line2">
          {perdidos.map((ld) => (
            <div key={ld.id} className="flex items-center gap-2.5 border-t border-line2 px-4 py-2.5 text-[12.5px] first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-extrabold">{ld.nombre}</div>
                <div className="truncate text-[11px] font-bold text-muted">{ld.fuente}{ld.motivo_perdida ? ` · ${ld.motivo_perdida}` : ''}</div>
              </div>
              <span className="flex-shrink-0 text-[11px] font-extrabold text-faint">
                {ld.perdido_at ? new Date(ld.perdido_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : ''}
              </span>
              <button onClick={() => reabrir(ld)}
                className="flex-shrink-0 cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-[10.5px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange">
                ↩ Reabrir
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// Fila de un ex-socio candidato a reactivación.
function FilaExSocio({ ex, sedeId, empresaId, gymNombre, moneda }) {
  const qc = useQueryClient()
  const [creado, setCreado] = useState(false)
  const wa = ex.telefono && waLink(ex.telefono,
    `Hola ${(ex.nombre || '').split(' ')[0]}! 👋 Te extrañamos en ${gymNombre || 'el gimnasio'} — ¿te gustaría volver? Tenemos promociones para socios que regresan. 💪`)

  async function crearLead() {
    setCreado(true)
    const { error } = await supabase.from('lead').insert({
      empresa_id: empresaId, sede_id: sedeId, etapa: 'nuevo',
      nombre: ex.nombre, telefono: ex.telefono || null,
      fuente: 'Reactivación', nota: 'reactivacion — ex-socio',
    })
    if (error) { setCreado(false); toast.error('No se pudo crear el lead: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['leads', sedeId] })
    toast.ok(`Lead creado para ${ex.nombre}`)
  }

  return (
    <div className="flex items-center gap-2.5 border-t border-line2 px-4 py-2.5 text-[12.5px] first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="truncate font-extrabold">{ex.nombre}</div>
        <div className="truncate text-[11px] font-bold text-muted">{ex.ultimo_plan || 'Sin plan registrado'}</div>
      </div>
      {/* Si se fue debiendo, que se vea ANTES de invitarlo a volver: cambia
          el discurso ("regularicemos tu saldo") y evita ofertas a morosos */}
      {Number(ex.deuda) > 0 && (
        <span className="flex-shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold" style={{ background: T.dangerBg, color: T.danger }}>
          se fue debiendo {money(ex.deuda, moneda)}
        </span>
      )}
      <span className="flex-shrink-0 text-[11px] font-extrabold text-faint">venció hace {ex.vencio_hace_dias}d</span>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" title="Escribirle por WhatsApp"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110"
          style={{ background: '#25D366' }}><WhatsAppIcon size={14} /></a>
      )}
      <button onClick={crearLead} disabled={creado}
        className="flex-shrink-0 cursor-pointer rounded-lg border border-orange px-2.5 py-1.5 text-[10.5px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:cursor-default disabled:opacity-50">
        {creado ? 'Lead creado ✓' : '+ Crear lead'}
      </button>
    </div>
  )
}

// Cohortes por campaña (pedido del cliente Pro): por cada promoción, cuántos
// entraron con ella, cuántos siguen y QUIÉNES se fueron — listos para
// contactar. El cálculo es SQL exacto (cohorte_campanias); la sugerencia de
// QUÉ ofrecerles es el teaser de Leadia. Colapsada + query solo al expandir.
function FilaCohortePerdido({ px, campana, sedeId, empresaId, gymNombre }) {
  const qc = useQueryClient()
  const [creado, setCreado] = useState(false)
  const wa = px.telefono && waLink(px.telefono,
    `¡Hola ${px.nombre.split(' ')[0]}! Te extrañamos en ${gymNombre} 💪 Entraste con la promo "${campana}" y queremos que vuelvas: tenemos ofertas nuevas. ¿Te cuento?`)
  async function crearLead() {
    setCreado(true)
    const { error } = await supabase.from('lead').insert({
      empresa_id: empresaId, sede_id: sedeId, etapa: 'nuevo',
      nombre: px.nombre, telefono: px.telefono || null,
      fuente: 'Reactivación', nota: `reactivación — entró con la campaña "${campana}"`,
    })
    if (error) { setCreado(false); toast.error('No se pudo crear el lead: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['leads', sedeId] })
    toast.ok(`Lead creado para ${px.nombre}`)
  }
  return (
    <div className="flex items-center gap-2.5 border-t border-line2 py-2 pl-3 text-[12.5px]">
      <div className="min-w-0 flex-1 truncate font-bold">{px.nombre}</div>
      <span className="flex-shrink-0 text-[11px] font-extrabold text-faint">venció hace {px.vencio_hace_dias}d</span>
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" title="Escribirle por WhatsApp"
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110"
          style={{ background: '#25D366' }}><WhatsAppIcon size={13} /></a>
      )}
      <button onClick={crearLead} disabled={creado}
        className="flex-shrink-0 cursor-pointer rounded-lg border border-orange px-2.5 py-1 text-[10.5px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:cursor-default disabled:opacity-50">
        {creado ? 'Lead ✓' : '+ Crear lead'}
      </button>
    </div>
  )
}

function CohorteCampaniasContenido({ sedeId, empresaId, gymNombre }) {
  const cohortes = useQuery({
    queryKey: ['cohorte-campanias'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cohorte_campanias')
      if (error) throw error
      return data
    },
  })
  const [abiertas, setAbiertas] = useState({}) // por campaña: mostrar perdidos
  if (cohortes.isLoading) return <div className="px-5 py-3"><LoadingState variant="table" rows={2} /></div>
  if (cohortes.isError) return <ErrorState error={cohortes.error} onRetry={cohortes.refetch} />
  const lista = cohortes.data || []
  if (!lista.length) return <div className="px-5 py-5 text-[12.5px] font-semibold text-muted">Aún no hay socios inscritos con campañas.</div>
  return (
    <div className="px-5 pb-4">
      {lista.map((ca) => {
        const retencion = ca.inscritos > 0 ? Math.round((ca.activos / ca.inscritos) * 100) : 0
        const abierta = !!abiertas[ca.promocion_id]
        return (
          <div key={ca.promocion_id} className="border-t border-line2 py-3 first:border-t-0">
            <div className={`flex flex-wrap items-center gap-3 ${ca.perdidos > 0 ? 'cursor-pointer' : ''}`}
              onClick={() => ca.perdidos > 0 && setAbiertas((v) => ({ ...v, [ca.promocion_id]: !abierta }))}>
              <div className="min-w-[160px] flex-1">
                <div className="text-[13px] font-extrabold">🎁 {ca.nombre}</div>
                <div className="mt-1 h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-line2">
                  <div className="h-full rounded-full" style={{ width: `${retencion}%`, background: retencion >= 70 ? T.success : retencion >= 40 ? '#F59E0B' : T.danger }} />
                </div>
              </div>
              <span className="text-[12px] font-bold text-muted">{ca.inscritos} entraron</span>
              <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold" style={{ background: T.successBg, color: T.success }}>{ca.activos} siguen</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${ca.perdidos > 0 ? '' : 'opacity-50'}`} style={{ background: T.dangerBg, color: T.danger }}>
                {ca.perdidos} se fueron{ca.perdidos > 0 ? (abierta ? ' ▴' : ' ▾') : ''}
              </span>
              <span className="w-[64px] text-right text-[12px] font-extrabold" style={{ color: retencion >= 70 ? T.success : retencion >= 40 ? '#B45309' : T.danger }}>{retencion}%</span>
            </div>
            {abierta && (ca.perdidos_lista || []).map((px) => (
              <FilaCohortePerdido key={px.socio_id} px={px} campana={ca.nombre} sedeId={sedeId} empresaId={empresaId} gymNombre={gymNombre} />
            ))}
          </div>
        )
      })}
      <div className="pt-2 text-[11px] font-semibold text-faint">
        % = retención (siguen activos / entraron). Clic en una campaña con bajas para ver quiénes se fueron y contactarlos.
      </div>
    </div>
  )
}

function CohorteCampanias({ sedeId, empresaId, gymNombre }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Card className="mt-4 overflow-hidden">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-4 text-left">
        <span className="text-[14.5px] font-extrabold">📊 Resultados por campaña <span className="ml-1 text-[11.5px] font-semibold text-muted">— quiénes entraron con cada promo, quiénes siguen y quiénes se fueron</span></span>
        <span className="text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver ▼'}</span>
      </button>
      {abierto && <div className="border-t border-line2"><CohorteCampaniasContenido sedeId={sedeId} empresaId={empresaId} gymNombre={gymNombre} /></div>}
    </Card>
  )
}

// Card colapsada al pie del CRM. Igual patrón: hook (y RPC) montado solo al expandir.
function ReactivacionExSocios({ sedeId, empresaId }) {
  const { empresa } = useAuth()
  const [abierto, setAbierto] = useState(false)
  // Rangos EXCLUYENTES (feedback del owner: los chips acumulativos mostraban
  // "los mismos" — 6 meses incluia a los de 3). Se trae 12 meses una sola vez
  // y se filtra por rango de dias en el cliente.
  const RANGOS = [
    { key: '0-1', label: 'Este mes', desde: 0, hasta: 30 },
    { key: '1-3', label: '1-3 meses', desde: 31, hasta: 90 },
    { key: '3-6', label: '3-6 meses', desde: 91, hasta: 180 },
    { key: '6-12', label: '6-12 meses', desde: 181, hasta: 365 },
    { key: 'todos', label: 'Todos', desde: 0, hasta: 99999 },
  ]
  const [rango, setRango] = useState(RANGOS[0])
  const exSocios = useExSocios(12, abierto)
  const filtrados = (exSocios.data || []).filter((ex) => {
    const d = Number(ex.vencio_hace_dias ?? 0)
    return d >= rango.desde && d <= rango.hasta
  })
  return (
    <Card className="mt-[15px] max-w-[860px] overflow-hidden">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-4 text-left">
        <div>
          <div className="text-[14.5px] font-extrabold">↩️ Reactivación (ex-socios)</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Dejaron de renovar — escríbeles o conviértelos en lead para captarlos de nuevo</div>
        </div>
        <span className="flex-shrink-0 text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver ex-socios ▼'}</span>
      </button>
      {abierto && (
        <div className="border-t border-line2">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="text-[11.5px] font-bold text-muted">Vencidos hace:</span>
            {RANGOS.map((r) => (
              <button key={r.key} onClick={() => setRango(r)}
                className="cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-extrabold transition-colors"
                style={rango.key === r.key
                  ? { background: T.chipNavy, color: T.navy, borderColor: T.chipNavy }
                  : { background: 'transparent', color: '#9AA3B5', borderColor: T.line }}>
                {r.label}
              </button>
            ))}
            {/* Teaser de Leadia: sugerencias de a quien reactivar y con que oferta */}
            <button disabled title="Próximamente (Leadia): analizará tus campañas pasadas — quiénes se inscribieron con cada promoción y ya no están — y te sugerirá ofertas personalizadas o grupales para traerlos de vuelta"
              className="ml-auto cursor-not-allowed rounded-full border border-dashed border-line px-2.5 py-1 text-[11px] font-extrabold text-faint">
              ✨ Sugerencia IA · en construcción
            </button>
          </div>
          {exSocios.isLoading && <LoadingState variant="table" rows={3} />}
          {exSocios.isError && <ErrorState error={exSocios.error} onRetry={exSocios.refetch} />}
          {!exSocios.isLoading && !exSocios.isError && filtrados.length === 0 && (
            <div className="px-5 py-6 text-[12.5px] font-semibold text-muted">Sin ex-socios vencidos en ese rango. Prueba otro filtro.</div>
          )}
          {!exSocios.isLoading && !exSocios.isError && filtrados.map((ex) => (
            <FilaExSocio key={ex.socio_id} ex={ex} sedeId={sedeId} empresaId={empresaId} gymNombre={empresa?.nombre} moneda={empresa?.moneda} />
          ))}
        </div>
      )}
    </Card>
  )
}

// Fríos ignorados por la IA: los contactos que Leadia calificó como fríos y NO
// mandó al CRM. El gym los revisa por si quiere rescatar alguno a mano (crear
// lead). Solo admin (la serverless valida rol). Colapsada + fetch al expandir.
function FriosIgnorados({ sedeId, empresaId }) {
  const qc = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const frios = useQuery({
    queryKey: ['leadia-frios', sedeId],
    enabled: abierto && !!sedeId,
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      const res = await fetch(`/api/leadia?action=leads-frios&sedeId=${sedeId}`, {
        headers: { authorization: `Bearer ${data?.session?.access_token || ''}` },
      })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error || 'No se pudo cargar')
      return out // { activo, items }
    },
  })

  async function rescatar(item) {
    const { error } = await supabase.from('lead').insert({
      empresa_id: empresaId, sede_id: sedeId, etapa: 'nuevo',
      nombre: item.nombre || item.sujeto || 'Contacto', telefono: item.telefono || null,
      fuente: 'WhatsApp', nota: `Rescatado de fríos (IA) · ${item.resumen || 'sin resumen'}`,
    })
    if (error) { toast.error('No se pudo crear el lead: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['leads', sedeId] })
    toast.ok('Lead creado — ya está en el embudo')
  }

  const data = frios.data
  const items = data?.items || []
  return (
    <Card className="mt-4 max-w-[860px] overflow-hidden">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent px-5 py-4 text-left">
        <div>
          <div className="text-[14.5px] font-extrabold">🧊 Fríos ignorados por la IA</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Contactos que el bot descartó por baja intención — no entraron al embudo. Revísalos por si quieres rescatar alguno.</div>
        </div>
        <span className="flex-shrink-0 text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver descartados ▼'}</span>
      </button>
      {abierto && (
        <div className="border-t border-line2">
          {frios.isLoading && <LoadingState variant="table" rows={3} />}
          {frios.isError && <ErrorState error={frios.error} onRetry={frios.refetch} />}
          {!frios.isLoading && !frios.isError && data && !data.activo && (
            <div className="px-5 py-6 text-[12.5px] font-semibold text-muted">Esta sede no tiene la IA de Leadia activa. Actívala en Configuración › IA Leadia para que el bot califique tus contactos.</div>
          )}
          {!frios.isLoading && !frios.isError && data?.activo && items.length === 0 && (
            <div className="px-5 py-6 text-[12.5px] font-semibold text-muted">El bot no ha descartado contactos por ahora. Cuando ignore alguno por frío, aparecerá aquí.</div>
          )}
          {!frios.isLoading && !frios.isError && data?.activo && items.map((it) => {
            const wa = it.telefono && waLink(it.telefono, `Hola${it.nombre ? ' ' + it.nombre.split(' ')[0] : ''}! 👋 Te escribimos de ${'nuestro gimnasio'}. ¿Te gustaría conocer nuestros planes?`)
            return (
              <div key={it.id || it.sujeto} className="flex items-center gap-2.5 border-t border-line2 px-4 py-2.5 text-[12.5px] first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-extrabold">{it.nombre || it.sujeto || 'Contacto'}</div>
                  {it.resumen && <div className="truncate text-[11px] font-semibold text-muted">{it.resumen}</div>}
                </div>
                {wa && (
                  <a href={wa} target="_blank" rel="noreferrer" title="Escribirle por WhatsApp"
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110"
                    style={{ background: '#25D366' }}><WhatsAppIcon size={14} /></a>
                )}
                <button onClick={() => rescatar(it)}
                  className="flex-shrink-0 cursor-pointer rounded-lg border border-orange px-2.5 py-1.5 text-[10.5px] font-extrabold text-orange transition-colors hover:bg-orange-50">
                  + Rescatar
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// Form compacto para registrar un seguimiento (incluye 'llamada'). Vive plegado
// bajo un botón "+ Tarea" para no ensuciar la card de Seguimientos por defecto.
function NuevaTareaForm({ sedeId, empresaId, leads, onDone }) {
  const crear = useCrearTarea(sedeId)
  const [leadId, setLeadId] = useState('')
  const [tipo, setTipo] = useState('llamada')
  const [detalle, setDetalle] = useState('')
  const [fecha, setFecha] = useState('')

  async function guardar(e) {
    e.preventDefault()
    if (!leadId) return
    try {
      await crear.mutateAsync({ leadId, tipo, detalle, vence_at: fecha ? new Date(fecha).toISOString() : null, empresaId })
      toast.ok('Seguimiento agendado')
      onDone()
    } catch (err) {
      toast.error('No se pudo agendar: ' + err.message)
    }
  }

  return (
    <form onSubmit={guardar} className="flex flex-wrap items-end gap-2 border-t border-line2 px-5 py-3.5">
      <label className="flex min-w-[160px] flex-1 flex-col gap-1">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.4px] text-muted">Lead</span>
        <select required value={leadId} onChange={(e) => setLeadId(e.target.value)} className={inputCls + ' cursor-pointer text-[12.5px]'}>
          <option value="">Elegir…</option>
          {leads.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
        </select>
      </label>
      <label className="flex w-[140px] flex-col gap-1">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.4px] text-muted">Tipo</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls + ' cursor-pointer text-[12.5px]'}>
          {TAREA_TIPOS.map((t) => <option key={t} value={t}>{TAREA_TIPO_LABEL[t]}</option>)}
        </select>
      </label>
      <label className="flex w-[150px] flex-col gap-1">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.4px] text-muted">Vence</span>
        <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls + ' text-[12.5px]'} />
      </label>
      <label className="flex min-w-[160px] flex-1 flex-col gap-1">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.4px] text-muted">Detalle</span>
        <input value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Opcional" className={inputCls + ' text-[12.5px]'} />
      </label>
      <div className="flex gap-1.5">
        <button type="button" onClick={onDone} className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[12px] font-extrabold text-muted hover:border-orange">Cancelar</button>
        <button type="submit" disabled={crear.isPending || !leadId}
          className="cursor-pointer rounded-[9px] border-none bg-orange px-3.5 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
          {crear.isPending ? 'Guardando…' : 'Agendar'}
        </button>
      </div>
    </form>
  )
}

// Trae de Leadia (pull) los calientes+tibios de la sede y los mete al CRM. Se
// dispara solo al abrir el CRM (1 vez por sede/carga) y con el botón manual.
// Silencioso si la sede no tiene la IA activa o si el usuario no es admin.
async function sincronizarLeadia(sedeId) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api/leadia?action=sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${data?.session?.access_token || ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sedeId }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || 'No se pudo sincronizar')
  return out // { activo, creados, actualizados }
}

export default function CRM() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa, rol } = useAuth()
  const qc = useQueryClient()
  const esAdmin = rol === 'admin'
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [campanaOpen, setCampanaOpen] = useState(false)
  const [sobreCol, setSobreCol] = useState(null) // columna resaltada durante el drag
  const [sincronizando, setSincronizando] = useState(false)
  const [syncAuto, setSyncAuto] = useState({}) // sedes ya sincronizadas esta carga

  // Sync manual: trae leads nuevos de Leadia y refresca el embudo.
  async function correrSync({ silencioso } = {}) {
    if (!sedeId || sincronizando) return
    setSincronizando(true)
    try {
      const out = await sincronizarLeadia(sedeId)
      if (out.activo) {
        qc.invalidateQueries({ queryKey: ['leads', sedeId] })
        const nuevos = out.creados || 0
        if (!silencioso) {
          toast.ok(nuevos > 0 ? `${nuevos} prospecto${nuevos > 1 ? 's' : ''} nuevo${nuevos > 1 ? 's' : ''} de la IA` : 'Todo al día — sin prospectos nuevos')
        } else if (nuevos > 0) {
          toast.ok(`${nuevos} prospecto${nuevos > 1 ? 's' : ''} nuevo${nuevos > 1 ? 's' : ''} de la IA 🤖`)
        }
      } else if (!silencioso) {
        toast.info('Esta sede no tiene la IA de Leadia activa.')
      }
    } catch (e) {
      if (!silencioso) toast.error(e.message)
    } finally { setSincronizando(false) }
  }

  // Auto-sync al abrir el CRM: solo admin, 1 vez por sede en esta carga.
  useEffect(() => {
    if (!esAdmin || !sedeId || syncAuto[sedeId]) return
    setSyncAuto((s) => ({ ...s, [sedeId]: true }))
    correrSync({ silencioso: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esAdmin, sedeId])

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
  const [perder, setPerder] = useState(null) // lead a marcar como perdido
  const leads = useLeads(sedeId)
  const avanzar = useAvanzarLead(sedeId)
  const tareas = useTareas(sedeId) // solo para el KPI "Seguimientos hoy"

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
  const perdidos = (leads.data || []).filter((l) => l.etapa === 'perdido').length

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">CRM · Prospectos</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Embudo de captación y seguimiento · {sedeNombre}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* En pausa mientras el owner define el canal con su cliente:
              correo masivo (gratis) vs WhatsApp API (Marketing ~S/0.25/msj).
              El modal CampanaWhatsAppModal queda intacto para reactivarlo. */}
          <button disabled title="Próximamente: campañas por segmento (vencidos, por vencer, ex-socios) por correo de golpe y WhatsApp"
            className="cursor-not-allowed rounded-[10px] border border-dashed border-line bg-transparent px-[16px] py-[11px] text-[13px] font-extrabold text-faint">
            📣 Campañas · en construcción
          </button>
          {esAdmin && (
            <button onClick={() => correrSync()} disabled={sincronizando}
              title="Traer de la IA de Leadia los prospectos calientes y tibios nuevos"
              className="cursor-pointer rounded-[10px] border border-line bg-white px-[16px] py-[11px] text-[13px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange disabled:opacity-50">
              {sincronizando ? 'Sincronizando…' : '🤖 Sincronizar IA'}
            </button>
          )}
          <button onClick={() => setNuevoOpen(true)}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nuevo prospecto</button>
        </div>
      </div>

      {nuevoOpen && <ProspectoModal sedeId={sedeId} empresaId={empresa?.id} onClose={() => setNuevoOpen(false)} />}
      {campanaOpen && <CampanaWhatsAppModal sedeId={sedeId} onClose={() => setCampanaOpen(false)} />}
      {editar && <ProspectoModal sedeId={sedeId} empresaId={empresa?.id} lead={editar} onClose={() => setEditar(null)} />}
      {perder && <PerderLeadModal lead={perder} sedeId={sedeId} onClose={() => setPerder(null)} />}
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
        <StatCard label="En proceso" value={Math.max(0, (leads.data?.length ?? 0) - inscritos - perdidos)} delta="en seguimiento activo" />
        <StatCard label="Seguimientos hoy" value={pendientes} delta="tareas con leads para hoy — el detalle está en la Agenda" variant="accent" />
      </div>

      <AgendaComercial sedeId={sedeId} empresaId={empresa?.id} leads={leads.data || []} />
      <QueOfrecer moneda={empresa?.moneda} empresaId={empresa?.id} />

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
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[13px] font-extrabold leading-[1.25]">{ld.nombre}</span>
                          {NIVEL_LEADIA[ld.nivel_leadia] && (
                            <span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold leading-none" title="Calificado por la IA de Leadia"
                              style={{ background: NIVEL_LEADIA[ld.nivel_leadia].bg, color: NIVEL_LEADIA[ld.nivel_leadia].color }}>
                              {NIVEL_LEADIA[ld.nivel_leadia].label}
                            </span>
                          )}
                        </div>
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
                      {!ld.socio_id && (
                        <button onClick={() => setPerder(ld)} title="No interesado / no responde — marcar como perdido"
                          className="cursor-pointer rounded-md border-none bg-transparent px-1 text-[13px] text-faint hover:text-red">✕</button>
                      )}
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

      {/* El panel "Seguimientos de hoy" vivía aquí duplicando la Agenda — fusionado arriba. */}

      <CohorteCampanias sedeId={sedeId} empresaId={empresa?.id} gymNombre={empresa?.nombre} />

      <PerdidosPanel perdidos={(leads.data || []).filter((l) => l.etapa === 'perdido')} sedeId={sedeId} />

      <ReactivacionExSocios sedeId={sedeId} empresaId={empresa?.id} />

      <FriosIgnorados sedeId={sedeId} empresaId={empresa?.id} />
    </div>
  )
}
