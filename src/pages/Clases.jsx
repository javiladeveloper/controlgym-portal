import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/ui.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useQuery } from '@tanstack/react-query'
import { useClases, useToggleClase, usePlanAcceso, useToggleAcceso, useSalas } from '../hooks/useClases.js'

// Fecha de HOY en horario local (Lima UTC-5) como 'YYYY-MM-DD'. toISOString()
// usaría UTC y de tarde/noche adelantaría al día siguiente, excluyendo las
// reservas de hoy. uiHelpers no expone un formateador local, así que se define aquí.
function hoyLocal() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Reservas vigentes por clase (desde la app del socio): la señal de demanda
// que le dice al gym qué clases jalan y cuáles no
function useReservasPorClase(sedeId) {
  return useQuery({
    queryKey: ['reservas-clase', sedeId],
    enabled: !!sedeId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reserva_clase')
        .select('clase_id, fecha')
        .eq('sede_id', sedeId)
        // Cupo ocupado real = todo lo que no está cancelado (igual que la RPC
        // reservar_clase): incluye 'reservada', 'asistio' y 'no_show'. Contar
        // solo 'reservada' subestimaba las clases más exitosas (ya con lista pasada).
        .neq('estado', 'cancelada')
        .gte('fecha', hoyLocal())
      if (error) throw error
      const porClase = {}
      for (const r of data || []) {
        porClase[r.clase_id] = porClase[r.clase_id] || { total: 0, proxima: null }
        porClase[r.clase_id].total++
        if (!porClase[r.clase_id].proxima || r.fecha < porClase[r.clase_id].proxima) {
          porClase[r.clase_id].proxima = r.fecha
        }
      }
      return porClase
    },
  })
}
import { usePersonal } from '../hooks/useOperaciones.js'
import { claseDot, DAY_NAMES } from '../lib/uiHelpers.js'
import { toast } from '../lib/toast.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

// Alta y edición de clase (mismo formulario). Editando además permite eliminarla.
function ClaseModal({ sedeId, empresaId, tipos, salas, clase = null, onClose }) {
  const qc = useQueryClient()
  const editando = !!clase
  const personal = usePersonal(sedeId) // staff que puede dictar la clase
  const [f, setF] = useState({
    nombre: clase?.nombre || '',
    tipo_id: clase?.tipo_clase_id || tipos[0]?.id || '',
    tipo_nuevo: '',
    dia: String(clase?.dia_semana || '1'),
    hora: clase?.hora?.slice(0, 5) || '19:00',
    duracion: clase?.duracion_min || 60,
    cupo: clase?.cupo_max || 20,
    sala_id: clase?.sala_id || '',
    // Instructor: id de staff, '__externo__' (contratado solo para la clase) o '' (sin asignar)
    instructor: clase?.instructor_id || (clase?.instructor_nombre ? '__externo__' : ''),
    instructor_externo: clase?.instructor_nombre || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmarDel, setConfirmarDel] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    try {
      let tipoId = f.tipo_id || null
      // Si eligió "Crear tipo nuevo…" el nombre es obligatorio: sin él la clase
      // quedaría con tipo_clase_id null (sin color/servicio ni acceso por plan) en
      // silencio. Avisar en vez de guardar sin tipo.
      if (f.tipo_id === '__nuevo__' && !f.tipo_nuevo.trim()) {
        throw new Error('Escribe el nombre del tipo de servicio nuevo, o elige uno existente.')
      }
      // Crear tipo de clase nuevo al vuelo si lo escribió
      if (f.tipo_id === '__nuevo__' && f.tipo_nuevo.trim()) {
        const { data, error } = await supabase.from('tipo_clase')
          .insert({ empresa_id: empresaId, nombre: f.tipo_nuevo.trim() }).select('id').single()
        if (error) throw error
        tipoId = data.id
        qc.invalidateQueries({ queryKey: ['plan-acceso'] })
      }
      // Duración y cupo: exigir enteros > 0. No usar `Number(x) || default` porque
      // 0 es falsy (convertía silenciosamente cupo 0 en 20) y los negativos pasaban
      // crudos (un cupo_max negativo deja la clase 'llena' desde 0 reservas).
      const dur = Number(f.duracion)
      const cupo = Number(f.cupo)
      if (!Number.isFinite(dur) || dur <= 0) throw new Error('La duración debe ser mayor que 0.')
      if (!f.sala_id && (!Number.isFinite(cupo) || cupo <= 0)) throw new Error('El cupo máximo debe ser mayor que 0.')
      const payload = {
        tipo_clase_id: tipoId === '__nuevo__' ? null : tipoId,
        nombre: f.nombre.trim(), dia_semana: Number(f.dia), hora: f.hora,
        duracion_min: dur, cupo_max: cupo,
        sala_id: f.sala_id || null,
        // Staff del panel o externo por nombre (nunca ambos)
        instructor_id: f.instructor && f.instructor !== '__externo__' ? f.instructor : null,
        instructor_nombre: f.instructor === '__externo__' ? (f.instructor_externo.trim() || null) : null,
      }
      const { error } = editando
        ? await supabase.from('clase').update(payload).eq('id', clase.id)
        : await supabase.from('clase').insert({ ...payload, empresa_id: empresaId, sede_id: sedeId, activa: true })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['clases', sedeId] })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function eliminar() {
    setBusy(true); setError('')
    // La FK reserva_clase→clase es ON DELETE CASCADE: un delete físico borraría
    // en silencio TODAS las reservas de los socios. Primero comprobamos si hay
    // reservas futuras vigentes; si las hay, no se elimina (se ofrece pausar).
    const hoy = new Date().toISOString().slice(0, 10)
    const { count, error: errCount } = await supabase
      .from('reserva_clase')
      .select('id', { count: 'exact', head: true })
      .eq('clase_id', clase.id)
      .eq('estado', 'reservada')
      .gte('fecha', hoy)
    if (errCount) { setBusy(false); setError(errCount.message); return }
    if (count > 0) {
      setBusy(false)
      setError(`No se puede eliminar: ${count} socio${count > 1 ? 's tienen' : ' tiene'} reserva próxima. Pausa la clase para que deje de aparecer sin borrar sus reservas.`)
      return
    }
    // Sin reservas futuras: soft-delete (no borrado físico) para conservar el
    // historial de reservas pasadas.
    const { error } = await supabase.from('clase')
      .update({ deleted_at: new Date().toISOString(), activa: false })
      .eq('id', clase.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['clases', sedeId] })
    onClose()
  }

  return (
    <Modal title={editando ? 'Editar clase' : 'Nueva clase'}
      subtitle={editando ? clase.nombre : 'Se agrega al horario de la sede actual'} onClose={onClose}>
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
          <Campo label="Duración (min)"><input type="number" min="1" value={f.duracion} onChange={set('duracion')} className={inputCls} /></Campo>
          <Campo label="Cupo máximo"><input type="number" min="1" value={f.cupo} onChange={set('cupo')} className={inputCls} /></Campo>
        </div>
        <Campo label="Sala (opcional)" hint={f.sala_id ? 'Con sala, el socio elige su lugar y el cupo lo define la sala.' : 'Sin sala: se reserva por cupo. Elige una sala para reservas con lugar asignado.'}>
          <select value={f.sala_id} onChange={set('sala_id')} className={inputCls + ' cursor-pointer'}>
            <option value="">Sin sala (solo cupo)</option>
            {(salas || []).map((sa) => <option key={sa.id} value={sa.id}>{sa.nombre} ({(sa.posiciones || []).filter((p) => p.activa).length} lugares)</option>)}
          </select>
        </Campo>
        <div className="hidden">
        </div>
        <Campo label="Instructor" hint="Puede ser de tu equipo, o alguien contratado solo para dictar esta clase.">
          <select value={f.instructor} onChange={set('instructor')} className={inputCls + ' cursor-pointer'}>
            <option value="">Por asignar</option>
            {(personal.data || []).map((p) => <option key={p.id} value={p.id}>{p.nombre} (equipo)</option>)}
            <option value="__externo__">Instructor externo…</option>
          </select>
        </Campo>
        {f.instructor === '__externo__' && (
          <Campo label="Nombre del instructor externo">
            <input value={f.instructor_externo} onChange={set('instructor_externo')} className={inputCls} placeholder="Sensei Carlos Nakamura" />
          </Campo>
        )}
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        {editando && (
          confirmarDel ? (
            <div className="flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5">
              <span className="flex-1 text-[12.5px] font-extrabold text-red">¿Eliminar esta clase del horario?</span>
              <button type="button" disabled={busy} onClick={eliminar}
                className="cursor-pointer rounded-[8px] border-none bg-red px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50">Sí, eliminar</button>
              <button type="button" onClick={() => setConfirmarDel(false)}
                className="cursor-pointer rounded-[8px] border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted">No</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmarDel(true)}
              className="cursor-pointer self-start border-none bg-transparent p-0 text-[12.5px] font-extrabold text-red hover:underline">
              🗑 Eliminar clase
            </button>
          )
        )}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel={editando ? 'Guardar cambios' : 'Crear clase'} />
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
      // Solo clase.tipo_clase_id bloquea el borrado (sin ON DELETE). La matriz de
      // planes (plan_acceso_clase) es ON DELETE CASCADE: no bloquea, así que no la
      // mencionamos como causa del error de FK.
      setError(error.message.includes('foreign key')
        ? `No se puede eliminar "${t.nombre}": tiene clases en el horario. Quita esas clases primero.`
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
            <label className="flex flex-shrink-0 cursor-pointer items-center gap-1 text-[10.5px] font-extrabold text-muted" title="Área sin horario ni cupos (musculación, cardio)">
              <input type="checkbox" checked={!!t.acceso_libre}
                onChange={(e) => actualizar(t.id, { acceso_libre: e.target.checked })}
                className="h-3.5 w-3.5 accent-orange-600" />
              libre
            </label>
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

// ── Salas con posiciones (para reservas con lugar asignado) ──
// El gym crea una sala como grilla filas×columnas; cada celda es una posición
// reservable. Clic en una celda la activa/desactiva (pasillo). Se puede
// renombrar. Patrón de grilla tomado del arqueo de caja (Finanzas.jsx).
function SalasModal({ sedeId, empresaId, onClose }) {
  const qc = useQueryClient()
  const salas = useSalas(sedeId)
  const [editando, setEditando] = useState(null) // sala en edición o 'nueva'
  const [f, setF] = useState({ nombre: '', filas: 4, columnas: 5 })
  const [celdas, setCeldas] = useState({}) // "fila-col" -> { activa, etiqueta }
  const [busy, setBusy] = useState(false)

  function abrirNueva() {
    setEditando('nueva'); setF({ nombre: '', filas: 4, columnas: 5 }); setCeldas({})
  }
  function abrirEditar(sala) {
    setEditando(sala)
    setF({ nombre: sala.nombre, filas: sala.filas, columnas: sala.columnas })
    const m = {}
    for (const p of sala.posiciones || []) m[`${p.fila}-${p.columna}`] = { id: p.id, activa: p.activa, etiqueta: p.etiqueta }
    setCeldas(m)
  }
  const celda = (fila, col) => celdas[`${fila}-${col}`] ?? { activa: true, etiqueta: null }
  function toggleCelda(fila, col) {
    const k = `${fila}-${col}`; const c = celda(fila, col)
    setCeldas((s) => ({ ...s, [k]: { ...c, activa: !c.activa } }))
  }
  function renombrar(fila, col, etiqueta) {
    const k = `${fila}-${col}`; const c = celda(fila, col)
    setCeldas((s) => ({ ...s, [k]: { ...c, etiqueta } }))
  }

  async function guardar() {
    if (!f.nombre.trim()) { toast.error('Ponle un nombre a la sala.'); return }
    setBusy(true)
    try {
      let salaId = editando !== 'nueva' ? editando.id : null
      if (salaId) {
        const { error } = await supabase.from('sala').update({ nombre: f.nombre.trim(), filas: Number(f.filas), columnas: Number(f.columnas) }).eq('id', salaId)
        if (error) throw error
        await supabase.from('sala_posicion').delete().eq('sala_id', salaId) // se regeneran
      } else {
        const { data, error } = await supabase.from('sala').insert({
          empresa_id: empresaId, sede_id: sedeId, nombre: f.nombre.trim(), filas: Number(f.filas), columnas: Number(f.columnas),
        }).select('id').single()
        if (error) throw error
        salaId = data.id
      }
      // (re)generar las posiciones según la grilla actual
      const filas = []
      for (let r = 1; r <= Number(f.filas); r++) {
        for (let c = 1; c <= Number(f.columnas); c++) {
          const cel = celda(r, c)
          filas.push({ sala_id: salaId, empresa_id: empresaId, fila: r, columna: c,
            etiqueta: cel.etiqueta || null, activa: cel.activa !== false })
        }
      }
      const { error: errPos } = await supabase.from('sala_posicion').insert(filas)
      if (errPos) throw errPos
      qc.invalidateQueries({ queryKey: ['salas', sedeId] })
      toast.ok(editando === 'nueva' ? 'Sala creada' : 'Sala actualizada')
      setEditando(null)
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message)
    } finally { setBusy(false) }
  }

  async function eliminar(sala) {
    if (!window.confirm(`¿Eliminar la sala "${sala.nombre}"? Las clases que la usen quedarán sin mapa.`)) return
    // desvincular clases que la usan, luego borrar (cascade a posiciones)
    await supabase.from('clase').update({ sala_id: null }).eq('sala_id', sala.id)
    const { error } = await supabase.from('sala').delete().eq('id', sala.id)
    if (error) { toast.error('No se pudo eliminar: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['salas', sedeId] })
    toast.ok('Sala eliminada')
  }

  if (editando) {
    const nCol = Math.min(Number(f.columnas) || 1, 40)
    return (
      <Modal title={editando === 'nueva' ? 'Nueva sala' : 'Editar sala'} subtitle="Marca los lugares reservables · toca una celda para volverla pasillo" onClose={() => setEditando(null)} width={560}>
        <div className="flex flex-col gap-3.5">
          <Campo label="Nombre de la sala"><input value={f.nombre} onChange={(e) => setF((s) => ({ ...s, nombre: e.target.value }))} className={inputCls} placeholder="Sala Spinning" /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Filas"><input type="number" min="1" max="40" value={f.filas} onChange={(e) => setF((s) => ({ ...s, filas: e.target.value }))} className={inputCls} /></Campo>
            <Campo label="Columnas"><input type="number" min="1" max="40" value={f.columnas} onChange={(e) => setF((s) => ({ ...s, columnas: e.target.value }))} className={inputCls} /></Campo>
          </div>
          <div>
            <div className="mb-1.5 text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Mapa de la sala</div>
            <div className="overflow-x-auto rounded-[10px] border border-line bg-[#FAFBFC] p-3">
              <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `repeat(${nCol}, minmax(0, 1fr))` }}>
                {Array.from({ length: Number(f.filas) || 0 }, (_, ri) =>
                  Array.from({ length: nCol }, (_, ci) => {
                    const r = ri + 1, c = ci + 1
                    const cel = celda(r, c)
                    const n = (r - 1) * nCol + c
                    return (
                      <button key={`${r}-${c}`} type="button" onClick={() => toggleCelda(r, c)}
                        onDoubleClick={() => { const t = window.prompt('Nombre del lugar (ej. Bici 7):', cel.etiqueta || `${n}`); if (t !== null) renombrar(r, c, t.trim() || null) }}
                        title={cel.activa !== false ? 'Clic: volver pasillo · doble clic: renombrar' : 'Clic: activar como lugar'}
                        className={`flex h-9 w-9 items-center justify-center rounded-[7px] border text-[10px] font-extrabold transition-colors ${cel.activa !== false ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-faint'}`}>
                        {cel.activa !== false ? (cel.etiqueta || n) : '·'}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
            <div className="mt-1.5 text-[11px] font-semibold text-faint">
              Naranja = lugar reservable · gris = pasillo. Doble clic para renombrar (ej. "Bici 7"). Lugares activos: {Object.values(celdas).filter((c) => c.activa !== false).length || (Number(f.filas) * nCol)}.
            </div>
          </div>
          <BotonesModal onCancel={() => setEditando(null)} busy={busy} submitLabel="Guardar sala" onSubmit={guardar} />
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Salas" subtitle="Grillas de posiciones para reservas con lugar asignado (spinning, reformer…)" onClose={onClose} width={480}>
      <div className="flex flex-col gap-2">
        {salas.isLoading && <div className="py-3 text-[12.5px] font-semibold text-faint">Cargando…</div>}
        {(salas.data || []).map((sala) => (
          <div key={sala.id} className="flex items-center justify-between rounded-[10px] border border-line px-3.5 py-2.5">
            <div>
              <div className="text-[13px] font-extrabold">{sala.nombre}</div>
              <div className="text-[11.5px] font-semibold text-muted">{sala.filas}×{sala.columnas} · {(sala.posiciones || []).filter((p) => p.activa).length} lugares</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => abrirEditar(sala)} className="cursor-pointer rounded-md border-none bg-transparent px-1.5 text-[13px] text-faint hover:text-orange">✏️</button>
              <button onClick={() => eliminar(sala)} className="cursor-pointer rounded-md border-none bg-transparent px-1.5 text-[13px] text-faint hover:text-red">🗑</button>
            </div>
          </div>
        ))}
        {!salas.isLoading && (salas.data || []).length === 0 && (
          <div className="rounded-[10px] border border-dashed border-line px-4 py-5 text-center text-[12.5px] font-semibold text-muted">Sin salas aún. Crea una para reservas con lugar.</div>
        )}
      </div>
      <button onClick={abrirNueva} className="mt-3 w-full cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600">+ Nueva sala</button>
    </Modal>
  )
}

// Mapa de reservas de una clase para una fecha: recepción ve qué lugares están
// tomados y por quién. Llama al RPC mapa_clase.
function MapaClaseModal({ clase, onClose }) {
  const hoy = hoyLocal()
  // próxima ocurrencia de esta clase (su día de la semana) desde hoy
  const proxima = (() => {
    const base = new Date(hoy + 'T00:00:00')
    const delta = ((clase.dia_semana - (((base.getDay() + 6) % 7) + 1)) + 7) % 7
    const d = new Date(base); d.setDate(base.getDate() + delta)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const [fecha, setFecha] = useState(proxima)
  const mapa = useQuery({
    queryKey: ['mapa-clase', clase.id, fecha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mapa_clase', { p_clase_id: clase.id, p_fecha: fecha })
      if (error) throw error
      return data
    },
  })
  const d = mapa.data
  return (
    <Modal title={clase.nombre} subtitle="Reservas por lugar" onClose={onClose} width={560}>
      <label className="mb-3 block">
        <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Fecha</span>
        <input type="date" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
      </label>
      {mapa.isLoading && <div className="py-6 text-center text-[12.5px] font-semibold text-faint">Cargando…</div>}
      {d && !d.tiene_sala && (
        <div className="rounded-[10px] border border-line bg-[#FAFBFC] px-4 py-4 text-[13px] font-bold">
          Esta clase no usa mapa de sala. Reservas: <b>{d.ocupados}</b>{d.cupo_max ? ` de ${d.cupo_max} cupos` : ''}.
        </div>
      )}
      {d && d.tiene_sala && (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-[#FAFBFC] p-3">
          <div className="inline-grid gap-1.5" style={{ gridTemplateColumns: `repeat(${d.sala.columnas}, minmax(0, 1fr))` }}>
            {(d.posiciones || []).map((p) => (
              <div key={p.id}
                title={!p.activa ? 'pasillo' : p.ocupada ? (p.socio_nombre || 'reservado') : 'libre'}
                className={`flex h-9 w-9 items-center justify-center rounded-[7px] border text-[9px] font-extrabold ${!p.activa ? 'border-line bg-white text-faint' : p.ocupada ? 'border-red bg-red/10 text-red' : 'border-green bg-green-50 text-green-600'}`}>
                {!p.activa ? '·' : (p.etiqueta || `${p.fila}·${p.columna}`)}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] font-bold text-muted">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-green bg-green-50" />Libre</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-red bg-red/10" />Reservado</span>
            <span>{(d.posiciones || []).filter((p) => p.ocupada).length} de {(d.posiciones || []).filter((p) => p.activa).length} lugares tomados</span>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default function Clases() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa, rol } = useAuth()
  // Quién puede administrar el horario y los servicios: admin y recepción.
  // Entrenadores/nutri/mantenimiento solo consultan (la autorización real está
  // en RLS; esto es la capa de UX para no ofrecer acciones que fallarían).
  const puedeEditar = rol === 'admin' || rol === 'recepcion'
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [editarClase, setEditarClase] = useState(null)
  const [serviciosOpen, setServiciosOpen] = useState(false)
  const [salasOpen, setSalasOpen] = useState(false)
  const [mapaClase, setMapaClase] = useState(null)
  const clases = useClases(sedeId)
  const reservas = useReservasPorClase(sedeId)
  const toggle = useToggleClase(sedeId)
  const acceso = usePlanAcceso()
  const salas = useSalas(sedeId)
  const toggleAcceso = useToggleAcceso()

  // Agrupar clases por día. El domingo (7) también cuenta: el selector deja
  // crear clases ese día, así que debe tener su columna o desaparecerían.
  // Si ningún gym tiene clases el domingo, esa columna simplemente va vacía.
  const hayDomingo = (clases.data || []).some((c) => c.dia_semana === 7)
  const dias = hayDomingo ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6]
  const cols = dias.map((d) => ({
    label: DAY_NAMES[d],
    items: (clases.data || []).filter((c) => c.dia_semana === d),
  }))

  // Mapa de acceso: `${planId}:${tipoId}` -> incluido
  const accesoMap = new Map((acceso.data?.acceso || []).map((a) => [`${a.plan_id}:${a.tipo_clase_id}`, a.incluido]))

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Clases y servicios</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Horario semanal · {sedeNombre}{puedeEditar ? ' · toca una clase para pausarla' : ''}</p>
        </div>
        {puedeEditar && (
          <div className="flex items-center gap-2.5">
            <button onClick={() => setServiciosOpen(true)}
              className="cursor-pointer rounded-[10px] border border-orange bg-white px-[16px] py-[10px] text-[13px] font-extrabold text-orange transition-colors hover:bg-orange-50">Servicios</button>
            <button onClick={() => setSalasOpen(true)}
              className="cursor-pointer rounded-[10px] border border-line bg-white px-[16px] py-[10px] text-[13px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange">🗺️ Salas</button>
            <button onClick={() => setNuevaOpen(true)}
              className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nueva clase</button>
          </div>
        )}
      </div>

      {/* Áreas de acceso libre: la base del gym (musculación, cardio) — sin horario ni cupos */}
      {(acceso.data?.tipos || []).some((t) => t.acceso_libre) && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-[12px] border border-line bg-white px-4 py-3">
          <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Áreas de acceso libre</span>
          {acceso.data.tipos.filter((t) => t.acceso_libre).map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold"
              style={{ background: `${t.color || '#E24B4A'}18`, color: t.color || '#E24B4A' }}>
              <span className="h-2 w-2 rounded-full" style={{ background: t.color || '#E24B4A' }} />
              {t.nombre}
            </span>
          ))}
          <span className="text-[11px] font-semibold text-faint">— disponibles todo el día, sin horario ni cupos</span>
        </div>
      )}

      {/* Leyenda dinámica de servicios con horario */}
      {(acceso.data?.tipos || []).length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {acceso.data.tipos.filter((t) => !t.acceso_libre).map((t) => (
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
        <ClaseModal sedeId={sedeId} empresaId={empresa?.id} tipos={acceso.data?.tipos || []} salas={salas.data || []} onClose={() => setNuevaOpen(false)} />
      )}
      {editarClase && (
        <ClaseModal sedeId={sedeId} empresaId={empresa?.id} tipos={acceso.data?.tipos || []} salas={salas.data || []} clase={editarClase} onClose={() => setEditarClase(null)} />
      )}
      {serviciosOpen && (
        <ServiciosModal empresaId={empresa?.id} sedeId={sedeId} tipos={acceso.data?.tipos || []} onClose={() => setServiciosOpen(false)} />
      )}
      {salasOpen && (
        <SalasModal sedeId={sedeId} empresaId={empresa?.id} onClose={() => setSalasOpen(false)} />
      )}
      {mapaClase && (
        <MapaClaseModal clase={mapaClase} onClose={() => setMapaClase(null)} />
      )}

      {clases.isLoading && <LoadingState variant="cards" rows={4} />}
      {clases.error && <ErrorState error={clases.error} onRetry={clases.refetch} />}

      {clases.data && (
        <div className="mt-3.5 grid items-start gap-3 max-lg:flex max-lg:snap-x max-lg:overflow-x-auto max-lg:pb-2 max-lg:[&>div]:w-[74vw] max-lg:[&>div]:flex-shrink-0 max-lg:[&>div]:snap-start lg:[grid-template-columns:var(--cols)]"
          style={{ '--cols': `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((col) => (
            <div key={col.label} className="flex flex-col gap-2.5">
              <div className="rounded-[10px] bg-navy px-3 py-[9px] text-center text-[12.5px] font-extrabold text-white">{col.label}</div>
              {col.items.map((cs) => {
                const paused = !cs.activa
                return (
                  <div key={cs.id} onClick={puedeEditar ? () => toggle.mutate({ id: cs.id, activa: !cs.activa }) : undefined}
                    className={`group rounded-xl border border-line bg-white p-3 transition ${puedeEditar ? 'cursor-pointer hover:border-orange' : ''}`} style={{ opacity: paused ? 0.55 : 1 }}>
                    <div className="flex items-center justify-between">
                      <div className="text-[11.5px] font-extrabold text-muted">{cs.hora?.slice(0, 5)}</div>
                      {puedeEditar && (
                        <button onClick={(e) => { e.stopPropagation(); setEditarClase(cs) }} title="Editar clase"
                          className="cursor-pointer rounded border-none bg-transparent px-1 text-[11px] text-faint opacity-0 transition-opacity hover:text-orange group-hover:opacity-100">✏️</button>
                      )}
                    </div>
                    <div className="mt-[5px] flex items-center gap-1.5">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: cs.tipo?.color || claseDot(cs.nombre) }} />
                      <div className="text-[13px] font-extrabold leading-[1.25]">{cs.nombre}</div>
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-muted">
                      {cs.instructor?.nombre || cs.instructor_nombre || 'Por asignar'}
                      {cs.instructor_nombre && !cs.instructor && <span className="ml-1 text-[9px] font-extrabold text-faint">(externo)</span>}
                    </div>
                    <div className="mt-2.5 flex items-center justify-between">
                      <div className="text-[10.5px] font-extrabold text-muted">Cupo {cs.cupo_max}</div>
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-extrabold" style={{ background: paused ? T.line2 : T.successBg, color: paused ? T.muted : T.success }}>
                        {paused ? 'Pausada' : 'Activa'}
                      </span>
                    </div>
                    {/* Demanda real + mapa de sala (clic abre el mapa de reservas) */}
                    {(reservas.data?.[cs.id]?.total > 0 || cs.sala_id) && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setMapaClase(cs) }}
                        className="mt-1.5 w-full cursor-pointer rounded-[7px] border-none bg-orange-50 px-2 py-1 text-left text-[10px] font-extrabold text-orange hover:bg-orange-100">
                        {reservas.data?.[cs.id]?.total > 0
                          ? `📅 ${reservas.data[cs.id].total} reserva${reservas.data[cs.id].total === 1 ? '' : 's'} · próx. ${new Date(reservas.data[cs.id].proxima + 'T12:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}`
                          : '🗺️ Ver mapa de la sala'}
                      </button>
                    )}
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
                    <button onClick={() => toggleAcceso.mutate({ empresaId: empresa?.id, planId: p.id, tipoId: t.id, incluido: !on })}
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
