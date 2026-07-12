import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, Avatar, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { verificarDni, textoVerificacion } from '../lib/dni.js'
import { toast } from '../lib/toast.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePersonal } from '../hooks/useOperaciones.js'
import { useMetaVendedor, useGuardarMetaVendedor } from '../hooks/useReportes.js'
import { iniciales, money, fechaLocal } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'
import { METODOS_PAGO } from '../lib/pagos.js'

const ROLES = [
  ['admin', 'Administrador'], ['recepcion', 'Recepción'], ['comunicador', 'Comunicador (atención al cliente)'],
  ['entrenador', 'Entrenador'], ['nutricionista', 'Nutricionista'], ['mantenimiento', 'Mantenimiento'],
]
const BANCOS = ['BCP', 'Interbank', 'BBVA', 'Scotiabank', 'BanBif', 'Banco de la Nación', 'Caja Arequipa', 'Caja Huancayo', 'Otro']

// Copia al portapapeles con confirmación
function copiar(texto, etiqueta) {
  navigator.clipboard?.writeText(texto)
  toast.ok(`${etiqueta} copiado: ${texto}`)
}

// Chip de dato bancario que se copia con un clic
function ChipCopiable({ etiqueta, valor }) {
  if (!valor) return null
  return (
    <button type="button" onClick={() => copiar(valor, etiqueta)} title={`Copiar ${etiqueta}`}
      className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[11.5px] font-extrabold text-ink transition-colors hover:border-orange hover:text-orange">
      {etiqueta}: {valor} ⧉
    </button>
  )
}
// Etiqueta del mes en curso. Es una FUNCIÓN (no constante de módulo) para que
// se recalcule en cada render: si la pestaña queda abierta al cruzar de mes, el
// texto y la descripción del gasto siguen el mes real, no el de cuando se cargó.
const mesLabel = () => new Date().toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })

// Editar el vínculo laboral del colaborador: rol, forma de pago y banco.
// (El nombre y teléfono los edita cada quien en su perfil.)
const DIA_CORTO = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' }

// Horario semanal del colaborador (turno_staff): por día + rango + sede.
// Soporta medio tiempo (solo algunos días). El trainer lo VE en su app vía
// mis_turnos() — PEDIDO 30. Distinto del "turno para avisos" (usuario_empresa),
// que decide a quién le llegan primero las alertas.
function HorarioSemanalEditor({ usuarioId, empresaId }) {
  const qc = useQueryClient()
  const { sedes } = useAuth()
  const turnos = useQuery({
    queryKey: ['turnos-staff', usuarioId],
    enabled: !!usuarioId && !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from('turno_staff')
        .select('id, dia_semana, hora_inicio, hora_fin, sede_id')
        .eq('empresa_id', empresaId).eq('usuario_id', usuarioId)
        .order('dia_semana').order('hora_inicio')
      if (error) throw error
      return data
    },
  })
  const [nuevo, setNuevo] = useState({ dia: '1', inicio: '', fin: '', sede: '' })
  const [busy, setBusy] = useState(false)
  const nombreSede = (id) => (sedes || []).find((s) => s.id === id)?.nombre

  async function agregar() {
    if (!nuevo.inicio || !nuevo.fin) { toast.error('Completa hora de entrada y salida.'); return }
    if (nuevo.fin <= nuevo.inicio) { toast.error('La salida debe ser después de la entrada.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('turno_staff').insert({
        empresa_id: empresaId, usuario_id: usuarioId, dia_semana: Number(nuevo.dia),
        hora_inicio: nuevo.inicio, hora_fin: nuevo.fin, sede_id: nuevo.sede || null,
      })
      if (error) throw error
      setNuevo((s) => ({ ...s, inicio: '', fin: '' }))
      qc.invalidateQueries({ queryKey: ['turnos-staff', usuarioId] })
    } catch (err) {
      toast.error('No se pudo agregar el turno: ' + err.message)
    } finally { setBusy(false) }
  }

  async function quitar(id) {
    try {
      const { error } = await supabase.from('turno_staff').delete().eq('id', id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['turnos-staff', usuarioId] })
    } catch (err) {
      toast.error('No se pudo quitar el turno: ' + err.message)
    }
  }

  return (
    <div className="rounded-[10px] border border-line bg-[#FAFBFC] p-3">
      <div className="mb-2.5 text-[12px] font-extrabold text-muted">
        📅 Horario semanal <span className="font-semibold">(el colaborador lo ve en su app · medio tiempo = solo sus días)</span>
      </div>
      {turnos.isLoading && <div className="py-1 text-[12px] font-semibold text-faint">Cargando…</div>}
      {(turnos.data || []).map((t) => (
        <div key={t.id} className="mb-1.5 flex items-center justify-between rounded-[8px] bg-white px-3 py-2">
          <span className="text-[12.5px] font-bold">
            {DIA_CORTO[t.dia_semana]} {t.hora_inicio.slice(0, 5)}–{t.hora_fin.slice(0, 5)}
            {t.sede_id && nombreSede(t.sede_id) && <span className="font-semibold text-faint"> · {nombreSede(t.sede_id)}</span>}
          </span>
          <button type="button" onClick={() => quitar(t.id)} aria-label="Quitar turno"
            className="cursor-pointer rounded-[6px] border-none bg-transparent px-1.5 py-0.5 text-[12px] font-extrabold text-faint hover:text-red">✕</button>
        </div>
      ))}
      {!turnos.isLoading && (turnos.data || []).length === 0 && (
        <div className="mb-1.5 text-[12px] font-semibold text-faint">Sin horario definido aún — agrega su primer turno:</div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={nuevo.dia} onChange={(e) => setNuevo((s) => ({ ...s, dia: e.target.value }))}
          className="cursor-pointer rounded-[8px] border border-line bg-white px-2 py-2 text-[12.5px] font-bold outline-none focus:border-orange">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DIA_CORTO[d]}</option>)}
        </select>
        <input type="time" value={nuevo.inicio} onChange={(e) => setNuevo((s) => ({ ...s, inicio: e.target.value }))}
          className="rounded-[8px] border border-line bg-white px-2 py-[7px] text-[12.5px] font-bold outline-none focus:border-orange" />
        <span className="text-[12px] font-bold text-faint">a</span>
        <input type="time" value={nuevo.fin} onChange={(e) => setNuevo((s) => ({ ...s, fin: e.target.value }))}
          className="rounded-[8px] border border-line bg-white px-2 py-[7px] text-[12.5px] font-bold outline-none focus:border-orange" />
        {(sedes || []).length > 1 && (
          <select value={nuevo.sede} onChange={(e) => setNuevo((s) => ({ ...s, sede: e.target.value }))}
            className="cursor-pointer rounded-[8px] border border-line bg-white px-2 py-2 text-[12.5px] font-bold outline-none focus:border-orange">
            <option value="">Cualquier sede</option>
            {(sedes || []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        <button type="button" onClick={agregar} disabled={busy}
          className="cursor-pointer rounded-[8px] border-none bg-navy px-3 py-2 text-[12px] font-extrabold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? '…' : '+ Agregar'}
        </button>
      </div>
    </div>
  )
}

const TIPO_PERMISO = { vacaciones: '🏖️ Vacaciones', permiso: '📋 Permiso', descanso_medico: '🤒 Descanso médico' }

// Vacaciones y permisos de TODO el equipo en un calendario mensual por
// colores (pedido del owner: "un cuadro completo de todos los colaboradores").
// Aquí también se registran/quitan — ya no viven dentro de Editar colaborador.
// Mientras un permiso está vigente, ese colaborador no recibe avisos del gym.
const COLOR_PERMISO = { vacaciones: '#F59E0B', permiso: '#3B82F6', descanso_medico: '#E24B4A' }

function VacacionesModal({ staff, empresaId, onClose }) {
  const qc = useQueryClient()
  const [mes, setMes] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const y = mes.getFullYear(); const m = mes.getMonth()
  const nDias = new Date(y, m + 1, 0).getDate()
  const pad = (n) => String(n).padStart(2, '0')
  const iniMes = `${y}-${pad(m + 1)}-01`
  const finMes = `${y}-${pad(m + 1)}-${pad(nDias)}`
  const hoyStr = new Date().toISOString().slice(0, 10)

  const permisos = useQuery({
    queryKey: ['permisos-mes', empresaId, iniMes],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from('permiso_staff')
        .select('id, usuario_id, tipo, desde, hasta')
        .eq('empresa_id', empresaId)
        .lte('desde', finMes).gte('hasta', iniMes)
        .order('desde')
      if (error) throw error
      return data
    },
  })

  // Asistencia del mes: para pintar ✓ asistió / ✗ faltó según su horario semanal
  const asistencia = useQuery({
    queryKey: ['asistencia-mes', empresaId, iniMes],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from('asistencia_staff')
        .select('usuario_id, fecha, entrada_at, salida_at')
        .eq('empresa_id', empresaId)
        .gte('fecha', iniMes).lte('fecha', finMes)
      if (error) throw error
      return new Map((data || []).map((a) => [a.usuario_id + '|' + a.fecha, a]))
    },
  })
  // Horario semanal (turno_staff): qué días LE TOCA venir a cada uno
  const horarios = useQuery({
    queryKey: ['turnos-staff-empresa', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from('turno_staff')
        .select('usuario_id, dia_semana')
        .eq('empresa_id', empresaId)
      if (error) throw error
      const map = new Map()
      for (const t of data || []) {
        if (!map.has(t.usuario_id)) map.set(t.usuario_id, new Set())
        map.get(t.usuario_id).add(t.dia_semana)
      }
      return map
    },
  })

  // Filtros del cuadro (pedido: "filtro para saber de cada colaborador" y por tipo)
  const [filtroUsuario, setFiltroUsuario] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')

  // Conteo anual: cuántos días de vacaciones/permisos ha usado cada uno este año
  const anio = new Date().getFullYear()
  const permisosAnio = useQuery({
    queryKey: ['permisos-anio', empresaId, anio],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from('permiso_staff')
        .select('usuario_id, tipo, desde, hasta')
        .eq('empresa_id', empresaId)
        .lte('desde', anio + '-12-31').gte('hasta', anio + '-01-01')
      if (error) throw error
      return data
    },
  })
  // días por colaborador y tipo, recortados al año en curso
  const diasAnio = new Map()
  for (const pe of permisosAnio.data || []) {
    const d1 = pe.desde < anio + '-01-01' ? new Date(anio, 0, 1) : fechaLocal(pe.desde)
    const d2 = pe.hasta > anio + '-12-31' ? new Date(anio, 11, 31) : fechaLocal(pe.hasta)
    const dias = Math.round((d2 - d1) / 864e5) + 1
    const cur = diasAnio.get(pe.usuario_id) || { vacaciones: 0, permiso: 0, descanso_medico: 0 }
    cur[pe.tipo] = (cur[pe.tipo] || 0) + Math.max(0, dias)
    diasAnio.set(pe.usuario_id, cur)
  }

  const [nuevo, setNuevo] = useState({ usuario: '', tipo: 'vacaciones', desde: '', hasta: '' })
  const [busy, setBusy] = useState(false)
  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['permisos-mes'] })
    qc.invalidateQueries({ queryKey: ['permisos-hoy'] })
    qc.invalidateQueries({ queryKey: ['permisos-anio'] }) // el conteo anual también cambia
  }

  async function registrar() {
    if (!nuevo.usuario) { toast.error('Elige al colaborador.'); return }
    if (!nuevo.desde || !nuevo.hasta) { toast.error('Completa desde y hasta.'); return }
    if (nuevo.hasta < nuevo.desde) { toast.error('"Hasta" no puede ser antes de "desde".'); return }
    setBusy(true)
    try {
      const { error } = await supabase.from('permiso_staff').insert({
        empresa_id: empresaId, usuario_id: nuevo.usuario, tipo: nuevo.tipo, desde: nuevo.desde, hasta: nuevo.hasta,
      })
      if (error) throw error
      setNuevo((s) => ({ ...s, desde: '', hasta: '' }))
      invalidar()
      toast.ok('Registrado — mientras dure, no recibirá avisos del gym')
    } catch (err) {
      toast.error('No se pudo registrar: ' + err.message)
    } finally { setBusy(false) }
  }

  async function quitar(pe) {
    const { error } = await supabase.from('permiso_staff').delete().eq('id', pe.id)
    if (error) { toast.error('No se pudo quitar: ' + error.message); return }
    invalidar()
  }

  const porUsuario = new Map()
  for (const pe of permisos.data || []) {
    if (!porUsuario.has(pe.usuario_id)) porUsuario.set(pe.usuario_id, [])
    porUsuario.get(pe.usuario_id).push(pe)
  }
  const permisoEnDia = (usuarioId, diaStr) =>
    (porUsuario.get(usuarioId) || []).find((pe) => pe.desde <= diaStr && diaStr <= pe.hasta)

  const nombreMes = mes.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })

  const staffVisible = staff.filter((st) => !filtroUsuario || st.id === filtroUsuario)
  const permisosVisibles = (permisos.data || []).filter((pe) =>
    (!filtroUsuario || pe.usuario_id === filtroUsuario) && (!filtroTipo || pe.tipo === filtroTipo))
  const permisoEnDiaF = (usuarioId, diaStr) => {
    const pe = permisoEnDia(usuarioId, diaStr)
    return pe && (!filtroTipo || pe.tipo === filtroTipo) ? pe : null
  }

  return (
    <Modal title="🗓️ Vacaciones y permisos" subtitle="El cuadro del equipo — mientras dure el permiso, no recibe avisos del gym" onClose={onClose} width={780}>
      {/* Registrar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-[#FAFBFC] p-3">
        <select value={nuevo.usuario} onChange={(e) => setNuevo((s) => ({ ...s, usuario: e.target.value }))}
          className="min-w-[150px] cursor-pointer rounded-[8px] border border-line bg-white px-2 py-2 text-[12.5px] font-bold outline-none focus:border-orange">
          <option value="">Colaborador…</option>
          {staff.map((st) => <option key={st.id} value={st.id}>{st.nombre}</option>)}
        </select>
        <select value={nuevo.tipo} onChange={(e) => setNuevo((s) => ({ ...s, tipo: e.target.value }))}
          className="cursor-pointer rounded-[8px] border border-line bg-white px-2 py-2 text-[12.5px] font-bold outline-none focus:border-orange">
          {Object.entries(TIPO_PERMISO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={nuevo.desde} onChange={(e) => setNuevo((s) => ({ ...s, desde: e.target.value }))}
          className="rounded-[8px] border border-line bg-white px-2 py-[7px] text-[12.5px] font-bold outline-none focus:border-orange" />
        <span className="text-[12px] font-bold text-faint">a</span>
        <input type="date" value={nuevo.hasta} onChange={(e) => setNuevo((s) => ({ ...s, hasta: e.target.value }))}
          className="rounded-[8px] border border-line bg-white px-2 py-[7px] text-[12.5px] font-bold outline-none focus:border-orange" />
        <button type="button" onClick={registrar} disabled={busy}
          className="cursor-pointer rounded-[8px] border-none bg-orange px-3.5 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
          {busy ? '…' : '+ Registrar'}
        </button>
      </div>

      {/* Navegación de mes + leyenda */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setMes(new Date(y, m - 1, 1))} className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[13px] font-extrabold text-muted hover:border-orange">‹</button>
          <span className="min-w-[150px] text-center text-[13.5px] font-extrabold capitalize">{nombreMes}</span>
          <button onClick={() => setMes(new Date(y, m + 1, 1))} className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[13px] font-extrabold text-muted hover:border-orange">›</button>
        </div>
        <div className="flex items-center gap-1.5">
          <select value={filtroUsuario} onChange={(e) => setFiltroUsuario(e.target.value)}
            className="cursor-pointer rounded-[8px] border border-line bg-white px-2 py-1.5 text-[11.5px] font-bold outline-none focus:border-orange">
            <option value="">Todos los colaboradores</option>
            {staff.map((st) => <option key={st.id} value={st.id}>{st.nombre}</option>)}
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
            className="cursor-pointer rounded-[8px] border border-line bg-white px-2 py-1.5 text-[11.5px] font-bold outline-none focus:border-orange">
            <option value="">Todos los tipos</option>
            {Object.entries(TIPO_PERMISO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-bold text-muted">
          {Object.entries(TIPO_PERMISO).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_PERMISO[k] }} />{v.replace(/^\S+ /, '')}</span>
          ))}
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#1D9E75' }} />Asistió</span>
          <span className="flex items-center gap-1"><span className="font-extrabold" style={{ color: '#E24B4A' }}>✕</span>Faltó (según horario)</span>
        </div>
      </div>

      {/* Cuadro: filas = colaboradores, columnas = días del mes */}
      <div className="mt-2 overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="flex items-center">
            <div className="w-[130px] flex-shrink-0" />
            {Array.from({ length: nDias }, (_, i) => {
              const dia = `${y}-${pad(m + 1)}-${pad(i + 1)}`
              return (
                <div key={i} className={`flex-1 pb-1 text-center text-[9.5px] font-extrabold ${dia === hoyStr ? 'text-orange' : 'text-faint'}`}>
                  {i + 1}
                </div>
              )
            })}
          </div>
          {staffVisible.map((st) => (
            <div key={st.id} className="flex items-center border-t border-line2">
              <div className="w-[130px] flex-shrink-0 truncate py-1.5 pr-2 text-[11.5px] font-bold">{st.nombre}</div>
              {Array.from({ length: nDias }, (_, i) => {
                const dia = `${y}-${pad(m + 1)}-${pad(i + 1)}`
                const pe = permisoEnDiaF(st.id, dia)
                // Asistencia vs horario: solo días pasados (hoy aún puede venir);
                // el permiso manda — de vacaciones no se marca falta.
                const asis = asistencia.data?.get(st.id + '|' + dia)
                const isoDia = (() => { const g = new Date(y, m, i + 1).getDay(); return g === 0 ? 7 : g })()
                const leTocaba = horarios.data?.get(st.id)?.has(isoDia)
                const falto = !pe && !asis && leTocaba && dia < hoyStr
                const titulo = pe ? `${st.nombre} · ${TIPO_PERMISO[pe.tipo]} (${pe.desde} → ${pe.hasta})`
                  : asis ? `${st.nombre} · asistió${asis.entrada_at ? ' ' + new Date(asis.entrada_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''}`
                  : falto ? `${st.nombre} · le tocaba y no marcó asistencia` : ''
                return (
                  <div key={i} className={`flex h-5 flex-1 items-center justify-center ${dia === hoyStr ? 'bg-orange-50' : ''}`} title={titulo}>
                    {pe ? <div className="h-full w-full" style={{ background: COLOR_PERMISO[pe.tipo] || '#999', opacity: 0.9 }} />
                      : asis ? <span className="h-2 w-2 rounded-full" style={{ background: '#1D9E75' }} />
                      : falto ? <span className="text-[9px] font-extrabold" style={{ color: '#E24B4A' }}>✕</span>
                      : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Detalle del mes con quitar */}
      {permisos.isLoading && <div className="mt-3"><LoadingState variant="table" rows={2} /></div>}
      {permisosVisibles.length > 0 && (
        <div className="mt-3 border-t border-line2 pt-2">
          {permisosVisibles.map((pe) => {
            const st = staff.find((x) => x.id === pe.usuario_id)
            return (
              <div key={pe.id} className="flex items-center justify-between py-1.5 text-[12.5px]">
                <span className="font-bold">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: COLOR_PERMISO[pe.tipo] }} />
                  {st?.nombre || '—'} · {TIPO_PERMISO[pe.tipo]} · {fechaLocal(pe.desde).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })} → {fechaLocal(pe.hasta).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
                </span>
                <button onClick={() => quitar(pe)} aria-label="Quitar"
                  className="cursor-pointer rounded-[6px] border-none bg-transparent px-1.5 text-[12px] font-extrabold text-faint hover:text-red">✕</button>
              </div>
            )
          })}
        </div>
      )}
      {!permisos.isLoading && permisosVisibles.length === 0 && (
        <div className="mt-3 text-[12.5px] font-semibold text-faint">Nadie tiene permisos ni vacaciones este mes.</div>
      )}

      {/* Conteo del año: cuántos días ha usado cada colaborador */}
      <div className="mt-4 rounded-[10px] bg-surface p-3">
        <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Días usados en {anio}</div>
        {staffVisible.filter((st) => diasAnio.has(st.id)).map((st) => {
          const c = diasAnio.get(st.id)
          return (
            <div key={st.id} className="flex items-center justify-between py-1 text-[12.5px]">
              <span className="font-bold">{st.nombre}</span>
              <span className="font-semibold text-muted">
                {c.vacaciones > 0 && <span className="mr-3">🏖️ {c.vacaciones} día{c.vacaciones !== 1 ? 's' : ''}</span>}
                {c.permiso > 0 && <span className="mr-3">📋 {c.permiso} día{c.permiso !== 1 ? 's' : ''}</span>}
                {c.descanso_medico > 0 && <span>🤒 {c.descanso_medico} día{c.descanso_medico !== 1 ? 's' : ''}</span>}
              </span>
            </div>
          )
        })}
        {staffVisible.filter((st) => diasAnio.has(st.id)).length === 0 && (
          <div className="text-[12px] font-semibold text-faint">Nadie ha usado días este año.</div>
        )}
      </div>
    </Modal>
  )
}

function EditarColaboradorModal({ colaborador, sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    rol: colaborador.rol_codigo || 'recepcion',
    tipo_pago: colaborador.tipo_pago || 'mensual',
    sueldo: colaborador.sueldo_mensual != null ? String(colaborador.sueldo_mensual) : '',
    tarifa: colaborador.tarifa_clase != null ? String(colaborador.tarifa_clase) : '',
    banco: colaborador.banco || '', cuenta: colaborador.cuenta_banco || '', cci: colaborador.cci || '',
    turno_inicio: colaborador.turno_inicio?.slice(0, 5) || '', turno_fin: colaborador.turno_fin?.slice(0, 5) || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  // Meta diaria de venta: es independiente del resto (RPC propia), solo tiene
  // sentido para quien vende (admin/recepción). Se muestra según el rol EN
  // EDICIÓN (f.rol), para que al cambiarle el rol a "vendedor" aparezca al toque.
  const metaActual = useMetaVendedor(colaborador.id)
  const guardarMeta = useGuardarMetaVendedor()
  const [meta, setMeta] = useState('')
  const [metaLeads, setMetaLeads] = useState('')
  const [metaMes, setMetaMes] = useState('')
  const [metaLeadsMes, setMetaLeadsMes] = useState('')
  useEffect(() => {
    if (metaActual.data != null) {
      setMeta(metaActual.data.monto > 0 ? String(metaActual.data.monto) : '')
      setMetaLeads(metaActual.data.leads > 0 ? String(metaActual.data.leads) : '')
      setMetaMes(metaActual.data.montoMes > 0 ? String(metaActual.data.montoMes) : '')
      setMetaLeadsMes(metaActual.data.leadsMes > 0 ? String(metaActual.data.leadsMes) : '')
    }
  }, [metaActual.data])
  // Metas SOLO para comunicadores (decisión del owner): los admin/recepción
  // no son fuerza de venta — sus metas ensuciaban el dashboard del equipo.
  const puedeVender = f.rol === 'comunicador'

  async function guardarMetaDiaria() {
    try {
      await guardarMeta.mutateAsync({
        usuarioId: colaborador.id,
        montoDiario: meta === '' ? 0 : Number(meta), leadsDiarios: metaLeads === '' ? 0 : Number(metaLeads),
        montoMensual: metaMes === '' ? 0 : Number(metaMes), leadsMensuales: metaLeadsMes === '' ? 0 : Number(metaLeadsMes),
      })
      toast.ok('Meta diaria actualizada')
    } catch (err) {
      toast.error('No se pudo guardar la meta: ' + err.message)
    }
  }

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    try {
      // Resolver el id del rol elegido (roles de sistema)
      const { data: rol, error: errRol } = await supabase
        .from('rol').select('id').eq('codigo', f.rol).is('empresa_id', null).single()
      if (errRol) throw errRol
      const { error } = await supabase.from('usuario_empresa').update({
        rol_id: rol.id,
        tipo_pago: f.tipo_pago,
        sueldo_mensual: f.tipo_pago === 'mensual' && f.sueldo !== '' ? Number(f.sueldo) : colaborador.sueldo_mensual,
        tarifa_clase: f.tipo_pago === 'por_clase' && f.tarifa !== '' ? Number(f.tarifa) : colaborador.tarifa_clase,
        banco: f.banco || null, cuenta_banco: f.cuenta.trim() || null, cci: f.cci.trim() || null,
        turno_inicio: f.turno_inicio || null, turno_fin: f.turno_fin || null,
      }).eq('usuario_id', colaborador.id).eq('empresa_id', empresaId)
      if (error) throw error
      toast.ok('Colaborador actualizado')
      qc.invalidateQueries({ queryKey: ['personal', sedeId] })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Editar colaborador" subtitle={colaborador.nombre} onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Rol">
            <select value={f.rol} onChange={set('rol')} className={inputCls + ' cursor-pointer'}>
              {ROLES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </Campo>
          <Campo label="Forma de pago">
            <select value={f.tipo_pago} onChange={set('tipo_pago')} className={inputCls + ' cursor-pointer'}>
              <option value="mensual">Sueldo mensual</option>
              <option value="por_clase">Por clases / sesiones</option>
            </select>
          </Campo>
        </div>
        {f.tipo_pago === 'mensual' ? (
          <Campo label="Sueldo mensual (S/)">
            <input type="number" step="0.01" min="0" value={f.sueldo} onChange={set('sueldo')} className={inputCls} placeholder="1200" />
          </Campo>
        ) : (
          <Campo label="Tarifa por clase (S/)">
            <input type="number" step="0.01" min="0" value={f.tarifa} onChange={set('tarifa')} className={inputCls} placeholder="30" />
          </Campo>
        )}

        {/* Turno: los avisos (nuevo socio, subir carga) llegan primero al que
            está de turno; si nadie lo está, a todos los activos */}
        <div className="rounded-[10px] border border-line bg-[#FAFBFC] p-3">
          <div className="mb-2.5 text-[12px] font-extrabold text-muted">🔔 Turno para avisos <span className="font-semibold">(en qué horario le llegan las alertas primero · vacío = a toda hora)</span></div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Entra">
              <input type="time" value={f.turno_inicio} onChange={set('turno_inicio')} className={inputCls} />
            </Campo>
            <Campo label="Sale">
              <input type="time" value={f.turno_fin} onChange={set('turno_fin')} className={inputCls} />
            </Campo>
          </div>
        </div>

        {/* Horario semanal (turno_staff): lo que el colaborador VE en su app */}
        <HorarioSemanalEditor usuarioId={colaborador.id} empresaId={empresaId} />

        {/* Meta diaria de venta: solo aplica a quien vende (admin/recepción).
            Guarda con su propio botón — no forma parte de "Guardar cambios"
            porque usa la RPC guardar_meta_vendedor, no el update de arriba. */}
        {puedeVender && (
          <div className="rounded-[10px] border border-line bg-[#FAFBFC] p-3">
            <div className="mb-2.5 text-[12px] font-extrabold text-muted">🎯 Metas diarias <span className="font-semibold">(vacío o 0 = sin meta)</span></div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-extrabold uppercase text-faint">Venta / día (S/)</span>
                <input type="number" step="0.01" min="0" value={meta} onChange={(e) => setMeta(e.target.value)}
                  className={inputCls} placeholder="200" disabled={metaActual.isLoading} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-extrabold uppercase text-faint">Venta / mes (S/)</span>
                <input type="number" step="0.01" min="0" value={metaMes} onChange={(e) => setMetaMes(e.target.value)}
                  className={inputCls} placeholder="4000" disabled={metaActual.isLoading} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-extrabold uppercase text-faint">Leads / día</span>
                <input type="number" step="1" min="0" value={metaLeads} onChange={(e) => setMetaLeads(e.target.value)}
                  className={inputCls} placeholder="5" disabled={metaActual.isLoading} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-extrabold uppercase text-faint">Leads / mes</span>
                <input type="number" step="1" min="0" value={metaLeadsMes} onChange={(e) => setMetaLeadsMes(e.target.value)}
                  className={inputCls} placeholder="100" disabled={metaActual.isLoading} />
              </label>
            </div>
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={guardarMetaDiaria} disabled={guardarMeta.isPending}
                className="flex-shrink-0 cursor-pointer rounded-[10px] border-none bg-navy px-4 py-2.5 text-[12.5px] font-extrabold text-white hover:opacity-90 disabled:opacity-50">
                {guardarMeta.isPending ? 'Guardando…' : 'Guardar metas'}
              </button>
            </div>
          </div>
        )}

        {/* Cuenta para transferirle el pago */}
        <div className="rounded-[10px] border border-line bg-[#FAFBFC] p-3">
          <div className="mb-2.5 text-[12px] font-extrabold text-muted">🏦 Cuenta para el pago</div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Banco">
              <select value={f.banco} onChange={set('banco')} className={inputCls + ' cursor-pointer'}>
                <option value="">Sin registrar</option>
                {BANCOS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </Campo>
            <Campo label="N.º de cuenta">
              <input value={f.cuenta} onChange={set('cuenta')} className={inputCls} placeholder="191-2345678-0-11" />
            </Campo>
          </div>
          <div className="mt-2.5">
            <Campo label="CCI (interbancario, 20 dígitos)" hint="Para transferirle desde otro banco.">
              <input value={f.cci} onChange={set('cci')} className={inputCls} placeholder="00219100234567801156" maxLength={20} />
            </Campo>
          </div>
        </div>

        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} submitLabel="Guardar cambios" />
      </form>
    </Modal>
  )
}

// Asistencia del staff HOY (quién marcó entrada y sigue presente)
function useAsistenciaHoy(empresaId) {
  const hoy = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD local
  return useQuery({
    queryKey: ['asistencia-staff', empresaId, hoy],
    enabled: !!empresaId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asistencia_staff')
        .select('usuario_id, entrada_at, salida_at')
        .eq('empresa_id', empresaId)
        .eq('fecha', hoy)
      if (error) throw error
      return new Map((data || []).map((a) => [a.usuario_id, a]))
    },
  })
}

const horaDe = (ts) => new Date(ts).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

// Sueldos pagados este mes (para marcar "✓ Pagado" y evitar dobles pagos)
function usePagosPlanilla() {
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  return useQuery({
    queryKey: ['planilla-mes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimiento_financiero')
        .select('ref_id, monto')
        .eq('categoria', 'planilla')
        .eq('ref_tipo', 'usuario')
        .eq('tipo', 'gasto')
        .gte('fecha', inicioMes)
      if (error) throw error
      // Suma por colaborador: los de pago por clase pueden cobrar varias veces al mes
      const m = new Map()
      for (const p of data || []) m.set(p.ref_id, (m.get(p.ref_id) || 0) + Number(p.monto))
      return m
    },
  })
}

// Pagar al colaborador: sueldo mensual fijo (planilla) o por clases/sesiones
// dictadas (instructores contratados). Ambos registran gasto de planilla en caja.
function PagarSueldoModal({ colaborador, sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const [modo, setModo] = useState(colaborador.tipo_pago || 'mensual')
  const [monto, setMonto] = useState(String(colaborador.sueldo_mensual ?? ''))
  const [clases, setClases] = useState('')
  const [tarifa, setTarifa] = useState(String(colaborador.tarifa_clase ?? ''))
  const [metodo, setMetodo] = useState('transferencia')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const MES = mesLabel()

  const totalClases = (Number(clases) || 0) * (Number(tarifa) || 0)

  async function pagar(e) {
    e?.preventDefault()
    if (busy) return // evita doble envío por doble clic mientras se inserta
    setBusy(true); setError('')
    try {
      const esMensual = modo === 'mensual'
      const n = esMensual ? Number(monto) : totalClases
      if (!n || n <= 0) throw new Error(esMensual ? 'Ingresa el monto del sueldo' : 'Ingresa cuántas clases y la tarifa')
      // Guardar cómo se le paga (y su base) para la próxima vez
      await supabase.from('usuario_empresa')
        .update(esMensual
          ? { tipo_pago: 'mensual', sueldo_mensual: n }
          : { tipo_pago: 'por_clase', tarifa_clase: Number(tarifa) })
        .eq('usuario_id', colaborador.id).eq('empresa_id', empresaId)
      // Registrar el gasto de planilla. Para sueldo MENSUAL marcamos
      // es_planilla_mensual + mes_planilla: un índice único impide pagar dos
      // veces el sueldo del mismo colaborador en el mismo mes (los pagos por
      // clase no se marcan, pueden repetirse).
      const primeroDeMes = new Date(); primeroDeMes.setDate(1)
      const mesPlanilla = esMensual ? primeroDeMes.toLocaleDateString('en-CA') : null
      const { error } = await supabase.from('movimiento_financiero').insert({
        empresa_id: empresaId, sede_id: sedeId, tipo: 'gasto', categoria: 'planilla',
        descripcion: esMensual
          ? `Sueldo ${MES} · ${colaborador.nombre}`
          : `Pago por ${clases} clase${Number(clases) === 1 ? '' : 's'} · ${MES} · ${colaborador.nombre}`,
        monto: n, metodo_pago: metodo, ref_tipo: 'usuario', ref_id: colaborador.id,
        es_planilla_mensual: esMensual, mes_planilla: mesPlanilla,
      })
      if (error) {
        // El índice único de planilla mensual devuelve un error de duplicado.
        if (error.code === '23505' || /uq_planilla_mensual/.test(error.message)) {
          throw new Error(`Ya se pagó el sueldo de ${colaborador.nombre} este mes.`)
        }
        throw error
      }
      qc.invalidateQueries({ queryKey: ['planilla-mes'] })
      qc.invalidateQueries({ queryKey: ['personal', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
      toast.ok(`Pago de ${money(n)} a ${colaborador.nombre} registrado en Finanzas`)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Pagar · ${MES}`} subtitle={colaborador.nombre} onClose={onClose}>
      <form onSubmit={pagar} className="flex flex-col gap-3.5">
        {/* Cómo se le paga: fijo de planilla o por clases dictadas */}
        <div className="flex gap-2">
          {[['mensual', '💼 Sueldo mensual'], ['por_clase', '🕐 Por clases / sesiones']].map(([v, l]) => (
            <button type="button" key={v} onClick={() => setModo(v)}
              className={`flex-1 cursor-pointer rounded-[10px] border px-3 py-2.5 text-[12.5px] font-extrabold transition-colors ${modo === v ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
              {l}
            </button>
          ))}
        </div>

        {modo === 'mensual' ? (
          <Campo label="Monto (S/) *" hint="Queda guardado como su sueldo base para el próximo mes.">
            <input required type="number" step="0.01" min="1" value={monto} onChange={(e) => setMonto(e.target.value)}
              className={inputCls} placeholder="1200" autoFocus />
          </Campo>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Clases dictadas *">
                <input required type="number" min="1" value={clases} onChange={(e) => setClases(e.target.value)} className={inputCls} placeholder="8" autoFocus />
              </Campo>
              <Campo label="Tarifa por clase (S/) *" hint="Se guarda para la próxima vez.">
                <input required type="number" step="0.01" min="0.01" value={tarifa} onChange={(e) => setTarifa(e.target.value)} className={inputCls} placeholder="30" />
              </Campo>
            </div>
            <div className="flex justify-between rounded-[10px] bg-surface px-3.5 py-2.5 text-[13px] font-extrabold">
              <span>Total a pagar</span><span className="text-orange">S/ {totalClases.toFixed(2)}</span>
            </div>
          </>
        )}

        <Campo label="Método de pago">
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inputCls + ' cursor-pointer'}>
            {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
        {/* Su cuenta a la mano para hacer la transferencia (clic = copiar) */}
        {metodo === 'transferencia' && (colaborador.banco || colaborador.cuenta_banco || colaborador.cci) && (
          <div className="rounded-[10px] border border-line bg-[#FAFBFC] px-3.5 py-2.5">
            <div className="mb-1.5 text-[11.5px] font-extrabold text-muted">🏦 {colaborador.banco || 'Banco no registrado'} — toca para copiar</div>
            <div className="flex flex-wrap gap-1.5">
              <ChipCopiable etiqueta="Cuenta" valor={colaborador.cuenta_banco} />
              <ChipCopiable etiqueta="CCI" valor={colaborador.cci} />
            </div>
          </div>
        )}
        {metodo === 'transferencia' && !colaborador.banco && !colaborador.cci && (
          <p className="rounded-[10px] bg-amber-50 px-3.5 py-2.5 text-[12px] font-bold text-amber-800">
            No tiene cuenta bancaria registrada — agrégala con el botón ✏️ del colaborador.
          </p>
        )}
        <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted">
          Se registrará como gasto de <b>planilla</b> en Finanzas y contará en los reportes del mes.
        </p>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} submitLabel="Registrar pago" />
      </form>
    </Modal>
  )
}

// Pagar de una vez a todos los pendientes con sueldo fijado
function PagarPlanillaModal({ pendientes, sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const [metodo, setMetodo] = useState('transferencia')
  const [busy, setBusy] = useState(false)
  const [hecho, setHecho] = useState(false) // ya se registró en esta apertura: no repetir
  const [error, setError] = useState('')
  const MES = mesLabel()
  const total = pendientes.reduce((n, st) => n + Number(st.sueldo_mensual), 0)

  async function pagar() {
    // Doble protección contra el doble pago: (1) guarda de re-entrada en el
    // cliente para el doble clic, y (2) el índice único uq_planilla_mensual_mes
    // en la BD (es_planilla_mensual + mes_planilla) que frena la carrera entre
    // dos administradores.
    if (busy || hecho) return
    setBusy(true); setError('')
    const primeroDeMes = new Date(); primeroDeMes.setDate(1)
    const mesPlanilla = primeroDeMes.toLocaleDateString('en-CA')
    const { error } = await supabase.from('movimiento_financiero').insert(
      pendientes.map((st) => ({
        empresa_id: empresaId, sede_id: sedeId, tipo: 'gasto', categoria: 'planilla',
        descripcion: `Sueldo ${MES} · ${st.nombre}`,
        monto: Number(st.sueldo_mensual), metodo_pago: metodo, ref_tipo: 'usuario', ref_id: st.id,
        es_planilla_mensual: true, mes_planilla: mesPlanilla,
      }))
    )
    if (error && (error.code === '23505' || /uq_planilla_mensual/.test(error.message))) {
      setBusy(false)
      setError('Algunos de estos colaboradores ya tienen su sueldo pagado este mes. Refresca la lista.')
      return
    }
    setBusy(false)
    if (error) { setError(error.message); return }
    setHecho(true)
    toast.ok(`Planilla de ${MES} registrada: ${pendientes.length} sueldos por ${money(total)}`)
    qc.invalidateQueries({ queryKey: ['planilla-mes'] })
    qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    onClose()
  }

  return (
    <Modal title={`Pagar planilla · ${MES}`} subtitle="Registra el sueldo de todos los pendientes" onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <div className="rounded-[10px] border border-line bg-[#FAFBFC] p-3">
          {pendientes.map((st) => (
            <div key={st.id} className="flex items-center justify-between py-1.5 text-[13px]">
              <span className="min-w-0">
                <span className="font-extrabold">{st.nombre}</span>
                {(st.banco || st.cuenta_banco) && (
                  <button type="button" onClick={() => copiar(st.cci || st.cuenta_banco, st.cci ? 'CCI' : 'Cuenta')}
                    title={`Clic para copiar ${st.cci ? 'el CCI' : 'la cuenta'}`}
                    className="ml-2 cursor-pointer border-none bg-transparent p-0 text-[11px] font-bold text-faint hover:text-orange">
                    🏦 {st.banco} {st.cuenta_banco} ⧉
                  </button>
                )}
              </span>
              <span className="font-bold text-muted">{money(st.sueldo_mensual)}</span>
            </div>
          ))}
          <div className="mt-1.5 flex items-center justify-between border-t border-line2 pt-2 text-[13.5px] font-extrabold">
            <span>Total</span><span className="text-orange">{money(total)}</span>
          </div>
        </div>
        <Campo label="Método de pago">
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={inputCls + ' cursor-pointer'}>
            {METODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
        <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted">
          Se registran {pendientes.length} gastos de <b>planilla</b> en Finanzas. Si alguien no cobra este mes, ciérralo y págale individual con su botón.
        </p>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={hecho} submitLabel={`Registrar ${money(total)}`} onSubmit={pagar} />
      </div>
    </Modal>
  )
}

function useInvitaciones() {
  return useQuery({
    queryKey: ['invitaciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitacion')
        .select('id, email, nombre, telefono, estado, created_at, rol:rol(nombre)')
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

function InvitarModal({ sedeId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ email: '', rol: 'recepcion', nombre: '', telefono: '', sueldo: '', documento: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [verif, setVerif] = useState(null) // verificación de DNI del colaborador
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  // Verificar DNI del colaborador contra el padrón y autocompletar su nombre
  // (igual que con socios: recepción solo tipea 8 dígitos).
  useEffect(() => {
    const dni = f.documento.replace(/\D/g, '')
    if (dni.length !== 8) { setVerif(null); return }
    if (verif?._dni === dni) return
    setVerif({ buscando: true })
    const t = setTimeout(async () => {
      const v = await verificarDni({ dni, nombre: f.nombre })
      setVerif({ ...v, _dni: dni })
      // Solo autocompletamos el nombre si el admin NO escribió nada aún. Si ya
      // tecleó un nombre, el del padrón queda como referencia (se muestra en el
      // aviso), pero NO se le pisa lo que escribió.
      if (v.encontrado && v.nombre_oficial && !f.nombre.trim()) {
        setF((s) => ({ ...s, nombre: v.nombre_oficial }))
      }
    }, 500)
    return () => clearTimeout(t)
  }, [f.documento, f.nombre]) // eslint-disable-line react-hooks/exhaustive-deps

  async function invitar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.rpc('invitar_colaborador', {
      p_email: f.email.trim().toLowerCase(), p_rol_codigo: f.rol, p_sede_id: sedeId,
      p_nombre: f.nombre.trim() || null, p_telefono: f.telefono.trim() || null,
      p_sueldo: f.sueldo === '' ? null : Number(f.sueldo),
      p_documento: f.documento.trim() || null,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    // DNI nuevo → alimentar MAXFIND con el nombre (fire-and-forget).
    // Se normaliza a solo dígitos, igual que en la verificación previa.
    const dniLimpio = f.documento.replace(/\D/g, '')
    if (verif?.encontrado === false && dniLimpio && f.nombre.trim()) {
      verificarDni({ dni: dniLimpio, nombre: f.nombre, alimentar: true })
    }
    setOk(true)
    qc.invalidateQueries({ queryKey: ['invitaciones'] })
    qc.invalidateQueries({ queryKey: ['personal', sedeId] })
  }

  if (ok) {
    return (
      <Modal title="Invitación registrada ✓" onClose={onClose} width={420}>
        <div className="rounded-[10px] bg-green-50 p-4 text-[13px] font-bold text-green-600">
          Cuando <b>{f.email}</b> entre al panel con su cuenta de Google, quedará vinculado automáticamente como {ROLES.find(([c]) => c === f.rol)?.[1]}.
        </div>
        <button onClick={onClose} className="mt-4 w-full cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600">Listo</button>
      </Modal>
    )
  }

  return (
    <Modal title="Agregar colaborador" subtitle="Se le da acceso al panel por invitación" onClose={onClose}>
      <form onSubmit={invitar} className="flex flex-col gap-3.5">
        <Campo label="DNI del colaborador" hint="8 dígitos = DNI (autocompleta su nombre del padrón). Opcional; útil para la planilla.">
          <input value={f.documento} onChange={set('documento')} className={inputCls} maxLength={12} inputMode="numeric" placeholder="44247191" />
        </Campo>
        {verif?.buscando && <p className="-mt-1.5 animate-pulse rounded-[8px] bg-amber-50 px-3 py-1.5 text-[11.5px] font-extrabold text-amber-800">🔍 Verificando el DNI en el padrón…</p>}
        {(() => {
          const t = textoVerificacion(verif)
          if (!t) return null
          const cls = t.tipo === 'ok' ? 'bg-green-50 text-green-700' : t.tipo === 'alerta' ? 'bg-red-50 text-red' : 'bg-amber-50 text-amber-800'
          return <p className={`-mt-1.5 rounded-[8px] px-3 py-1.5 text-[11.5px] font-extrabold ${cls}`}>{t.texto}</p>
        })()}
        <Campo label="Correo de Google *" hint="Con este correo iniciará sesión en el panel.">
          <input type="email" required value={f.email} onChange={set('email')} className={inputCls} placeholder="colaborador@gmail.com" />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Nombre"><input value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="María López" /></Campo>
          <Campo label="Teléfono"><input value={f.telefono} onChange={set('telefono')} className={inputCls} placeholder="999 888 777" /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Rol">
            <select value={f.rol} onChange={set('rol')} className={inputCls + ' cursor-pointer'}>
              {ROLES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </Campo>
          <Campo label="Sueldo mensual (S/)" hint="Opcional; se usa en Planilla.">
            <input type="number" step="0.01" min="0" value={f.sueldo} onChange={set('sueldo')} className={inputCls} placeholder="1200" />
          </Campo>
        </div>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.email.trim()} submitLabel="Invitar" />
      </form>
    </Modal>
  )
}

export default function Personal() {
  const { sedeId, sedeNombre } = usePanel()
  const { rol, empresa } = useAuth()
  // Permisos vigentes HOY para pintar el badge en la lista (map usuario -> permiso)
  const permisosHoy = useQuery({
    queryKey: ['permisos-hoy', empresa?.id],
    enabled: !!empresa?.id,
    queryFn: async () => {
      const hoy = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase.from('permiso_staff')
        .select('usuario_id, tipo, hasta')
        .eq('empresa_id', empresa.id).lte('desde', hoy).gte('hasta', hoy)
      if (error) throw error
      return new Map((data || []).map((pe) => [pe.usuario_id, pe]))
    },
  })
  const qc = useQueryClient()
  const [invitarOpen, setInvitarOpen] = useState(false)
  const [pagarA, setPagarA] = useState(null) // colaborador al que se le paga el sueldo
  const [editarCol, setEditarCol] = useState(null) // colaborador en edición
  const [planillaOpen, setPlanillaOpen] = useState(false)
  const [vacacionesOpen, setVacacionesOpen] = useState(false)
  const { data, isLoading, error, refetch } = usePersonal(sedeId)
  const invitaciones = useInvitaciones()
  const pagosMes = usePagosPlanilla()
  const asistencia = useAsistenciaHoy(empresa?.id)

  // Marcar entrada/salida de un colaborador (RPC valida que sea admin)
  async function marcarAsistencia(st) {
    if (!sedeId) { toast.error('Espera a que cargue la sede'); return }
    const { data: r, error } = await supabase.rpc('marcar_asistencia_staff', {
      p_usuario_id: st.id, p_sede_id: sedeId,
    })
    if (error) { toast.error('No se pudo marcar: ' + error.message); return }
    toast.ok(r.accion === 'entrada' ? `Entrada de ${st.nombre}: ${horaDe(r.hora)}` : `Salida de ${st.nombre}: ${horaDe(r.hora)}`)
    qc.invalidateQueries({ queryKey: ['asistencia-staff'] })
  }

  // Activos de sueldo FIJO que aún no cobraron este mes (los de pago por
  // clase no entran al lote: se les paga según lo que dictaron)
  const pendientesPlanilla = (data || []).filter(
    (st) => st.activo && st.tipo_pago !== 'por_clase' && Number(st.sueldo_mensual) > 0 && pagosMes.data && !pagosMes.data.has(st.id)
  )

  // Revocar una invitación pendiente (esa persona ya no podrá vincularse).
  // Es destructivo → se confirma antes.
  async function revocar(inv) {
    if (!window.confirm(`¿Revocar la invitación de ${inv.nombre || inv.email}? Ya no podrá vincularse con este correo.`)) return
    const { error } = await supabase.from('invitacion')
      .update({ estado: 'revocada' }).eq('id', inv.id)
    if (error) { toast.error('No se pudo revocar: ' + error.message); return }
    toast.ok('Invitación revocada')
    qc.invalidateQueries({ queryKey: ['invitaciones'] })
  }

  // Activar/desactivar el acceso de un colaborador a la empresa. Desactivar
  // (quitarle el acceso) es sensible → se confirma antes.
  async function toggleActivo(st) {
    if (!empresa?.id) { toast.error('Espera a que cargue la empresa'); return }
    if (st.activo && !window.confirm(`¿Desactivar el acceso de ${st.nombre} al panel?`)) return
    const { error } = await supabase.from('usuario_empresa')
      .update({ activo: !st.activo })
      .eq('usuario_id', st.id)
      .eq('empresa_id', empresa.id)
    if (error) { toast.error('No se pudo actualizar: ' + error.message); return }
    toast.ok(st.activo ? `${st.nombre} desactivado` : `${st.nombre} reactivado`)
    qc.invalidateQueries({ queryKey: ['personal', sedeId] })
  }

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Personal</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">{sedeNombre} · {data?.length ?? 0} colaboradores</p>
        </div>
        {rol === 'admin' && (
          <div className="flex items-center gap-2">
            {pendientesPlanilla.length > 0 && (
              <button onClick={() => setPlanillaOpen(true)}
                className="cursor-pointer rounded-[10px] border border-green-300 bg-green-50 px-[16px] py-[11px] text-[13px] font-extrabold text-green-700 transition-colors hover:bg-green-100">
                💵 Pagar planilla del mes ({pendientesPlanilla.length})
              </button>
            )}
            <button onClick={() => setVacacionesOpen(true)}
              className="cursor-pointer rounded-[10px] border border-line bg-white px-[16px] py-[11px] text-[13px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange">
              🗓️ Vacaciones y permisos
            </button>
            <button onClick={() => setInvitarOpen(true)}
              className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Agregar colaborador</button>
          </div>
        )}
      </div>

      {invitarOpen && <InvitarModal sedeId={sedeId} onClose={() => setInvitarOpen(false)} />}
      {vacacionesOpen && <VacacionesModal staff={data || []} empresaId={empresa?.id} onClose={() => setVacacionesOpen(false)} />}
      {pagarA && <PagarSueldoModal colaborador={pagarA} sedeId={sedeId} empresaId={empresa?.id} onClose={() => setPagarA(null)} />}
      {planillaOpen && <PagarPlanillaModal pendientes={pendientesPlanilla} sedeId={sedeId} empresaId={empresa?.id} onClose={() => setPlanillaOpen(false)} />}
      {editarCol && <EditarColaboradorModal colaborador={editarCol} sedeId={sedeId} empresaId={empresa?.id} onClose={() => setEditarCol(null)} />}

      {isLoading && <LoadingState variant="table" rows={5} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && !error && (data || []).length === 0 && (
        <EmptyState icon="👥" message="No hay colaboradores asignados a esta sede."
          actionLabel={rol === 'admin' ? 'Agregar colaborador' : undefined}
          onAction={rol === 'admin' ? () => setInvitarOpen(true) : undefined} />
      )}

      {(data || []).length > 0 && (
        <Card className="mt-[18px] overflow-x-auto">
          <div className="grid min-w-[860px] grid-cols-[2fr_1fr_1fr_1.3fr_0.9fr_300px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Colaborador</div><div>Rol</div><div>Teléfono</div><div>Sueldo · {mesLabel().split(' ')[0]}</div><div>Estado</div><div />
          </div>
          {data.map((st) => {
            const pagado = pagosMes.data?.get(st.id)
            const porClase = st.tipo_pago === 'por_clase'
            return (
              <div key={st.id}
                onClick={(e) => { if (rol !== 'admin' || e.target.closest('button,a')) return; setEditarCol(st) }}
                className={`grid min-w-[860px] grid-cols-[2fr_1fr_1fr_1.3fr_0.9fr_300px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC] ${rol === 'admin' ? 'cursor-pointer' : ''}`}>
                <div className="flex items-center gap-2.5">
                  <Avatar ini={st.avatar_iniciales || iniciales(st.nombre)} bg={T.chipNavy} color={T.navy} size={34} fontSize={12} />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-extrabold">
                      {st.nombre}
                      {(() => {
                        const pe = permisosHoy.data?.get(st.id)
                        if (!pe) return null
                        return <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">{(TIPO_PERMISO[pe.tipo] || pe.tipo)} hasta {fechaLocal(pe.hasta).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</span>
                      })()}
                    </div>
                    {(st.banco || st.cuenta_banco) && (
                      <button onClick={() => copiar(st.cci || st.cuenta_banco, st.cci ? 'CCI' : 'Cuenta')}
                        title={`Clic para copiar ${st.cci ? 'el CCI' : 'la cuenta'}`}
                        className="block max-w-full cursor-pointer truncate border-none bg-transparent p-0 text-left text-[10.5px] font-bold text-faint hover:text-orange">
                        🏦 {st.banco} {st.cuenta_banco} ⧉
                      </button>
                    )}
                  </div>
                </div>
                <div><Badge bg={T.chipNavy} color={T.navy}>{st.rol_nombre || '—'}</Badge></div>
                <div className="text-[12.5px] font-semibold text-muted">{st.telefono || '—'}</div>
                <div className="text-[12.5px] font-bold">
                  {porClase ? (
                    <span className="text-muted">
                      {st.tarifa_clase ? `${money(st.tarifa_clase)} por clase` : 'por clase'}
                      {pagado != null && <span className="ml-1.5 font-extrabold text-green-600">· pagado {money(pagado)}</span>}
                    </span>
                  ) : pagado != null
                    ? <span className="text-green-600">✓ Pagado {money(pagado)}</span>
                    : st.sueldo_mensual
                      ? <span className="text-muted">{money(st.sueldo_mensual)} pendiente</span>
                      : <span className="text-faint">sin sueldo fijado</span>}
                </div>
                <div>
                  <Badge bg={st.activo ? T.successBg : T.line2} color={st.activo ? T.success : T.muted}>{st.activo ? 'Activo' : 'Inactivo'}</Badge>
                  {(() => {
                    const a = asistencia.data?.get(st.id)
                    if (a && !a.salida_at) return <div className="mt-1 text-[10.5px] font-extrabold text-green-600">● presente desde {horaDe(a.entrada_at)}</div>
                    if (a?.salida_at) return <div className="mt-1 text-[10.5px] font-bold text-faint">salió {horaDe(a.salida_at)}</div>
                    if (st.turno_inicio && st.turno_fin) return <div className="mt-1 text-[10.5px] font-bold text-faint">🕐 turno {st.turno_inicio.slice(0, 5)}–{st.turno_fin.slice(0, 5)}</div>
                    return null
                  })()}
                </div>
                {rol === 'admin' ? (
                  <div className="flex items-center justify-end gap-1.5">
                    {st.activo && (() => {
                      const a = asistencia.data?.get(st.id)
                      const presente = a && !a.salida_at
                      const jornadaCerrada = a && a.salida_at // ya marcó entrada y salida hoy
                      if (jornadaCerrada) {
                        return (
                          <span title={`Entró ${horaDe(a.entrada_at)} · salió ${horaDe(a.salida_at)}`}
                            className="rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-extrabold text-faint">
                            🕐 Jornada cerrada
                          </span>
                        )
                      }
                      return (
                        <button onClick={() => marcarAsistencia(st)}
                          title={presente ? 'Marcar su salida' : 'Marcar su entrada de hoy'}
                          className={`cursor-pointer rounded-[9px] border px-2.5 py-1.5 text-[11px] font-extrabold transition-colors ${presente ? 'border-green-300 bg-green-50 text-green-600 hover:bg-green-100' : 'border-line bg-white text-muted hover:border-green-400 hover:text-green-600'}`}>
                          🕐 {presente ? 'Salida' : 'Entrada'}
                        </button>
                      )
                    })()}
                    {(porClase || pagado == null) && st.activo && (
                      <button onClick={() => setPagarA(st)}
                        className="cursor-pointer rounded-[9px] border border-green-300 bg-green-50 px-3 py-1.5 text-[11px] font-extrabold text-green-700 hover:bg-green-100">
                        💵 {porClase ? 'Pagar clases' : 'Pagar sueldo'}
                      </button>
                    )}
                    <button onClick={() => setEditarCol(st)} title="Editar rol, pago y banco"
                      className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12px] text-muted hover:border-orange hover:text-orange">✏️</button>
                    <button onClick={() => toggleActivo(st)}
                      className={`cursor-pointer rounded-[9px] border px-3 py-1.5 text-[11px] font-extrabold transition-colors ${st.activo ? 'border-line bg-white text-muted hover:border-red hover:text-red' : 'border-green-300 bg-green-50 text-green-600'}`}>
                      {st.activo ? '⏸' : '▶'}
                    </button>
                  </div>
                ) : <div />}
              </div>
            )
          })}
        </Card>
      )}

      {/* Invitaciones pendientes */}
      {(invitaciones.data || []).length > 0 && (
        <Card className="mt-[15px] overflow-x-auto">
          <div className="px-5 py-4">
            <div className="text-[14.5px] font-extrabold">Invitaciones pendientes</div>
            <div className="mt-0.5 text-[12px] font-semibold text-muted">Se vinculan solas cuando la persona entra con su Google.</div>
          </div>
          {invitaciones.data.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between border-t border-line2 px-5 py-3">
              <div>
                <div className="text-[13.5px] font-extrabold">{inv.nombre ? `${inv.nombre} · ${inv.email}` : inv.email}</div>
                <div className="text-[11.5px] font-semibold text-muted">{inv.rol?.nombre}{inv.telefono ? ` · ${inv.telefono}` : ''} · invitado el {new Date(inv.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge bg={T.primaryBg} color={T.primary}>Pendiente</Badge>
                {rol === 'admin' && (
                  <button onClick={() => revocar(inv)} title="Revocar invitación"
                    className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-muted hover:border-red hover:text-red">
                    Revocar
                  </button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
