import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Card, Badge } from '../components/ui.jsx'
import { TargetIcon, CheckIcon } from '../components/icons.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import {
  useSociosSelect, useDietaSocio, useEnviarPlan,
  useRutinaSocio, useCrearRutina, useSetFoco, useCrearDieta,
  useEjerciciosRutina, useGuardarEjercicio, useEliminarEjercicio,
  useGuardarComida, useAgregarComida, useEliminarComida, useGuardarSuplementos,
  useGuardarNotasRutina, useBancoEjercicios, useAgregarDia, useEliminarDia,
  useSolicitudesCarga, useResponderSolicitud, useAsignarPlanAutomatico,
} from '../hooks/useRutinas.js'
import Modal, { Campo, inputCls, BotonesModal } from '../components/Modal.jsx'
import { useObjetivos, usePlantillasRutina, usePlantillasDieta } from '../hooks/usePlantillas.js'
import { toast } from '../lib/toast.js'
import { useProductos } from '../hooks/useOperaciones.js'
import BancoEjerciciosModal from '../components/forms/BancoEjerciciosModal.jsx'
import BuscadorEjercicios from '../components/forms/BuscadorEjercicios.jsx'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const FOCOS = ['Pierna y glúteo', 'Pecho y tríceps', 'Espalda y bíceps', 'Hombro y core', 'Full body y cardio', 'Descanso']
const DIA_NOMBRE = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' }

// Foco del día como texto LIBRE (con sugerencias): la app escribe focos
// personalizados tipo "Espalda, hombro y cardio" y el panel debe respetarlos
function FocoInput({ dia, onGuardar }) {
  const [v, setV] = useState(dia.foco || '')
  useEffect(() => { setV(dia.foco || '') }, [dia.foco])
  // Permitir DEJAR VACÍO el foco (día de descanso sin etiqueta): se persiste
  // el valor recortado tal cual, incluso si queda vacío, siempre que cambie.
  const commit = () => { const nv = v.trim(); if (nv !== (dia.foco || '')) onGuardar(nv) }
  return (
    <>
      <input list="focos-sugeridos" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        className="w-full rounded-[9px] border border-line bg-white px-1.5 py-[9px] text-[12px] font-extrabold text-ink outline-none hover:border-orange focus:border-orange" />
      <datalist id="focos-sugeridos">{FOCOS.map((f) => <option key={f} value={f} />)}</datalist>
    </>
  )
}

// Autocompletado de ejercicios: sugiere SOLO mientras se escribe (2+ letras,
// máx. 6) — nada de listas kilométricas al hacer clic. Si no existe, se
// avisa que quedará agregado al banco al guardar.
function InputEjercicio({ value, onChange, onBlur, onKeyDown, placeholder, className, banco, onSelect }) {
  const [foco, setFoco] = useState(false)
  const q = (value || '').trim().toLowerCase()
  const sug = foco && q.length >= 2
    ? banco.filter((e) => e.nombre.toLowerCase().includes(q)).slice(0, 6)
    : []
  const existe = banco.some((e) => e.nombre.toLowerCase() === q)
  return (
    <div className="relative min-w-[150px] flex-1">
      <input value={value || ''} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder}
        onFocus={() => setFoco(true)}
        onBlur={(e) => { setTimeout(() => setFoco(false), 120); onBlur?.(e) }}
        className={className + ' w-full'} autoComplete="off" />
      {foco && q.length >= 2 && (sug.length > 0 || !existe) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-[10px] border border-line bg-white shadow-lg">
          {sug.filter((e) => e.nombre.toLowerCase() !== q).map((e) => (
            <button key={e.id} type="button"
              onMouseDown={(ev) => {
                ev.preventDefault()
                setFoco(false)
                // Si el consumidor define onSelect (campo 'nuevo ejercicio'),
                // elegir una sugerencia EJECUTA la acción (agrega la fila) en vez
                // de solo rellenar el texto. Si no, actualiza el valor y en el
                // caso de fila existente forzamos el commit (blur) para persistir.
                if (onSelect) { onSelect(e.nombre); return }
                onChange({ target: { value: e.nombre } })
                onBlur?.({ target: { value: e.nombre } })
              }}
              className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-3 py-2 text-left text-[12.5px] font-bold hover:bg-[#FFF4EC]">
              {e.nombre}
              {e.grupo_muscular && <span className="text-[10.5px] font-extrabold text-faint">{e.grupo_muscular}</span>}
            </button>
          ))}
          {!existe && (
            <div className="border-t border-line2 px-3 py-1.5 text-[10.5px] font-bold text-faint">
              ✚ "{value}" es nuevo — se agregará al banco al guardar
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Suplementos frecuentes para autocompletar (además de los del Kardex del gym)
const SUPLEMENTOS_BASE = [
  'Proteína whey', 'Creatina monohidrato', 'Pre-entreno', 'BCAA', 'Glutamina',
  'Multivitamínico', 'Omega 3', 'Cafeína', 'Magnesio', 'Colágeno', 'Vitamina D',
  'Caseína', 'Ganador de masa (mass gainer)', 'Electrolitos', 'Zinc',
]

// UNA sola caja: escribes normal y, según la línea que estás tipeando (2+
// letras), sugiere — primero lo EN STOCK del gym (con precio), luego los
// frecuentes. Elegir completa ESA línea.
function SuplementosEditor({ value, onChange, onCommit, enStock }) {
  const [foco, setFoco] = useState(false)
  const lineas = (value || '').split('\n')
  const ultima = (lineas[lineas.length - 1] || '').replace(/^[·\-\s]+/, '').trim().toLowerCase()
  const yaCompleta = ultima.includes('—')
  const sugerencias = (!foco || yaCompleta || ultima.length < 2) ? [] : [
    ...enStock.filter((p) => p.nombre.toLowerCase().includes(ultima))
      .map((p) => ({ nombre: p.nombre, stock: p.stock, precio: p.precio })),
    ...SUPLEMENTOS_BASE.filter((n) => n.toLowerCase().includes(ultima)
      && !enStock.some((p) => p.nombre.toLowerCase().includes(n.toLowerCase())))
      .map((n) => ({ nombre: n })),
  ].slice(0, 6)

  const pick = (s) => {
    const linea = s.stock != null
      ? `· ${s.nombre} — lo tenemos en el gym, cómpralo en recepción (S/ ${Number(s.precio)})`
      : `· ${s.nombre} — [indica dosis y momento]`
    const nuevo = [...lineas.slice(0, -1), linea].join('\n')
    onChange(nuevo)
    onCommit(nuevo)
  }

  return (
    <div className="relative">
      <textarea rows={3} value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFoco(true)}
        onBlur={() => { setTimeout(() => setFoco(false), 120); onCommit(value) }}
        placeholder="Escribe y te sugerimos (ej. crea… → Creatina). Una línea por suplemento."
        className="w-full resize-none rounded-[9px] border border-line bg-white px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-orange" />
      {sugerencias.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 -mt-1 overflow-hidden rounded-[10px] border border-line bg-white shadow-lg">
          {sugerencias.map((s) => (
            <button key={s.nombre} type="button"
              onMouseDown={(ev) => { ev.preventDefault(); pick(s) }}
              className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent px-3 py-2 text-left text-[12.5px] font-bold hover:bg-[#FFF4EC]">
              <span>{s.stock != null ? '🏪 ' : ''}{s.nombre}</span>
              {s.stock != null
                ? <span className="text-[10.5px] font-extrabold text-green-600">en stock · S/ {Number(s.precio)}</span>
                : <span className="text-[10.5px] font-extrabold text-faint">frecuente</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Fila editable de una comida del plan (guarda al salir del campo).
// El chip de día define si aplica TODOS los días o uno específico (plan semanal).
function ComidaFila({ comida, onGuardar, onEliminar }) {
  const [c, setC] = useState(comida)
  useEffect(() => { setC(comida) }, [comida])
  const set = (k) => (ev) => setC((s) => ({ ...s, [k]: ev.target.value }))
  const commit = (patch = {}) => {
    const final = { ...c, ...patch }
    if (JSON.stringify(final) !== JSON.stringify(comida)) onGuardar(final)
  }
  const cls = 'rounded-[9px] border border-line bg-[#FAFBFC] px-2.5 py-2.5 text-[13px] font-semibold text-ink outline-none focus:border-orange focus:bg-white'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={c.nombre || ''} onChange={set('nombre')} onBlur={() => commit()} placeholder="Comida"
        className={cls + ' w-[118px] font-extrabold'} />
      <input type="time" value={(c.hora || '').slice(0, 5)} onChange={set('hora')} onBlur={() => commit()}
        className={cls + ' w-[92px]'} />
      <select value={c.dia_semana ?? ''} title="¿Qué día aplica?"
        onChange={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); setC((s) => ({ ...s, dia_semana: v })); commit({ dia_semana: v }) }}
        className={cls + ' w-[104px] cursor-pointer font-extrabold ' + (c.dia_semana ? 'text-orange' : 'text-muted')}>
        <option value="">Todos</option>
        {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => (
          <option key={d} value={i + 1}>{d}</option>
        ))}
      </select>
      <input value={c.descripcion || ''} onChange={set('descripcion')} onBlur={() => commit()} placeholder="Qué come…"
        className={cls + ' min-w-[160px] flex-1'} />
      <input type="number" value={c.kcal ?? 0} onChange={set('kcal')} onBlur={() => commit()}
        className={cls + ' w-[72px] text-right font-extrabold'} />
      <span className="text-[11px] font-extrabold text-muted">kcal</span>
      <button onClick={() => onEliminar(comida.id)} title="Quitar comida"
        className="cursor-pointer rounded-[7px] border-none bg-transparent px-1 text-[12px] text-faint hover:text-red">🗑</button>
    </div>
  )
}

// Fila editable de un ejercicio (guarda al salir del campo)
function EjercicioFila({ ej, banco, onGuardar, onEliminar }) {
  const [e, setE] = useState(ej)
  useEffect(() => { setE(ej) }, [ej])
  const set = (k) => (ev) => setE((s) => ({ ...s, [k]: ev.target.value }))
  const commit = () => { if (JSON.stringify(e) !== JSON.stringify(ej)) onGuardar(e) }
  // Commit del NOMBRE: al elegir una sugerencia del autocompletado, el blur llega
  // ANTES de que el setState del nombre se aplique (estado async), así que si el
  // evento trae el nombre elegido lo fusionamos para no persistir el nombre viejo.
  const commitNombre = (ev) => {
    const merged = ev?.target?.value != null ? { ...e, nombre: ev.target.value } : e
    if (JSON.stringify(merged) !== JSON.stringify(ej)) onGuardar(merged)
  }
  const cls = 'rounded-[8px] border border-line bg-white px-2 py-1.5 text-[12px] font-bold outline-none focus:border-orange'
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line2 py-1.5 first:border-0">
      <InputEjercicio value={e.nombre} onChange={set('nombre')} onBlur={commitNombre} placeholder="Ejercicio"
        banco={banco} className={cls + ' font-extrabold'} />
      <input value={e.series ?? ''} onChange={set('series')} onBlur={commit} placeholder="Ser." type="number" min="1" title="Series" className={cls + ' w-[52px] text-center'} />
      <input value={e.reps || ''} onChange={set('reps')} onBlur={commit} placeholder="Reps" title="Repeticiones" className={cls + ' w-[64px] text-center'} />
      <input value={e.carga || ''} onChange={set('carga')} onBlur={commit} placeholder="Carga" title="Carga (40kg, banda…)" className={cls + ' w-[76px] text-center'} />
      <input value={e.descanso || ''} onChange={set('descanso')} onBlur={commit} placeholder="Desc." title="Descanso" className={cls + ' w-[58px] text-center'} />
      <input value={e.notas || ''} onChange={set('notas')} onBlur={commit} placeholder="Nota técnica" className={cls + ' min-w-[120px] flex-1'} />
      <button onClick={() => onEliminar(ej.id)} title="Quitar ejercicio"
        className="cursor-pointer rounded-[7px] border-none bg-transparent px-1 text-[12px] text-faint hover:text-red">🗑</button>
    </div>
  )
}

// El módulo completo llega junto con la app del socio: crear rutinas/dietas
// aquí y que el socio las vea en su celular. Sin app, el flujo queda cojo,
// así que se muestra como próximamente (el código de abajo queda listo).
const EN_CONSTRUCCION = false // la app del socio ya existe: módulo activo

function RutinasEnConstruccion() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-7">
      <div className="max-w-[440px] text-center">
        <div className="text-[56px]">🏗️</div>
        <h1 className="mt-3 text-[22px] font-extrabold tracking-[-0.3px]">Rutinas y dietas, muy pronto</h1>
        <p className="mt-2 text-[13.5px] font-semibold leading-relaxed text-muted">
          Este módulo se lanza junto con la <b className="text-ink">app del socio</b>: tu entrenador arma la rutina
          y el plan de alimentación desde aquí, y tu socio los ve al instante en su celular.
        </p>
        <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full border border-orange bg-orange-50 px-4 py-2 text-[12px] font-extrabold text-orange">
          📱 Llega con la app — ya puedes reservarla en Configuración → Mi plan
        </div>
      </div>
    </div>
  )
}

export default function Rutinas() {
  if (EN_CONSTRUCCION) return <RutinasEnConstruccion />
  return <RutinasImpl />
}

const haceCuanto = (ts) => {
  const h = (Date.now() - new Date(ts).getTime()) / 3600000
  return h < 1 ? 'hace minutos' : h < 24 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} día${Math.round(h / 24) === 1 ? '' : 's'}`
}

// Bandeja de solicitudes "quiero subir de carga" que llegan desde la app.
// Quedan EN ESPERA hasta que cualquier trainer/admin decida — si el que
// firmó la rutina no está (enfermo, otro turno, ya no trabaja), otro las
// toma, o él mismo las encuentra aquí cuando vuelva.
function SolicitudesCarga({ empresaId, onIrSocio }) {
  const solicitudes = useSolicitudesCarga(empresaId)
  const responder = useResponderSolicitud(empresaId)
  const [rechazando, setRechazando] = useState(null) // solicitud a la que se le escribe el "aún no"
  const [nota, setNota] = useState('')
  // Si la consulta falla, avisar en vez de ocultar todo silenciosamente.
  if (solicitudes.error) {
    return (
      <Card className="mt-[18px] p-[15px]" style={{ borderLeft: '4px solid #EF4444' }}>
        <div className="text-[13px] font-bold text-red">No se pudieron cargar las solicitudes de carga. Reintenta en un momento.</div>
      </Card>
    )
  }
  if (!solicitudes.data?.length) return null
  return (
    <Card className="mt-[18px] p-[19px]" style={{ borderLeft: '4px solid #FF6B35' }}>
      <div className="text-[14.5px] font-extrabold">🏋️ Solicitudes de subir carga ({solicitudes.data.length})</div>
      <div className="mt-0.5 text-[12px] font-semibold text-muted">
        Pedidas desde la app del socio. Esperan aquí hasta que un trainer decida — cualquiera del equipo puede responder.
      </div>
      {solicitudes.data.map((s) => (
        <div key={s.id} className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[10px] bg-surface px-3.5 py-3">
          <div className="min-w-0">
            <button onClick={() => onIrSocio(s.socio_id)} title="Ver su rutina"
              className="cursor-pointer border-none bg-transparent p-0 text-[13.5px] font-extrabold text-ink hover:text-orange">
              {s.socio?.nombre} <span className="text-[11px] font-bold text-faint">N.º {s.socio?.codigo} · {haceCuanto(s.creado_at)}</span>
            </button>
            {s.asignado?.nombre && (
              <span className="ml-2 rounded-full bg-[#EEF1FF] px-2 py-0.5 text-[10.5px] font-extrabold text-[#4C5AA8]">
                → {s.asignado.nombre.split(' ')[0]}
              </span>
            )}
            <div className="text-[12.5px] font-bold text-muted">
              {s.ejercicio_nombre || 'Su rutina'}{s.carga_actual && s.carga_deseada ? `: ${s.carga_actual} → ${s.carga_deseada}` : ''}
              {s.mensaje_socio && <span className="font-semibold text-faint"> — "{s.mensaje_socio}"</span>}
            </div>
          </div>
          {rechazando === s.id ? (
            <div className="flex flex-wrap items-center gap-2">
              <input autoFocus value={nota} onChange={(e) => setNota(e.target.value)} placeholder="¿Por qué aún no? (le llega al socio)"
                className="w-[230px] rounded-[9px] border border-line bg-white px-3 py-1.5 text-[12px] outline-none focus:border-orange" />
              <button disabled={responder.isPending}
                onClick={() => responder.mutate({ solicitud: s, aprobar: false, nota }, { onSuccess: () => { setRechazando(null); setNota('') }, onError: (e) => toast.error(e.message) })}
                className="cursor-pointer rounded-[9px] border-none bg-amber-500 px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50">
                Enviar
              </button>
              <button onClick={() => { setRechazando(null); setNota('') }}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-extrabold text-muted">✕</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button disabled={responder.isPending}
                onClick={() => responder.mutate({ solicitud: s, aprobar: true }, { onError: (e) => toast.error(e.message) })}
                className="cursor-pointer rounded-[9px] border-none bg-green px-3.5 py-2 text-[11.5px] font-extrabold text-white hover:bg-green-600 disabled:opacity-50">
                ✓ Aprobar{s.carga_deseada ? ` ${s.carga_deseada}` : ''}
              </button>
              <button onClick={() => { setRechazando(s.id); setNota('') }}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[11.5px] font-extrabold text-muted hover:border-amber-500 hover:text-amber-600">
                Aún no
              </button>
            </div>
          )}
        </div>
      ))}
    </Card>
  )
}

// Asignar plantilla a mano: el flujo automático solo corre al inscribir (y solo
// si el socio ya tenía objetivo + peso + talla). Este modal cubre a todos los
// demás: pide/confirma esos 3 datos, los guarda en el socio y dispara el mismo
// RPC que copia rutina + dieta de la plantilla del objetivo, moduladas por IMC.
function AsignarPlantillaModal({ socio, onClose }) {
  const objetivos = useObjetivos()
  const conPlan = (objetivos.data || []).filter((o) => o.tiene_plan)
  const [objetivoId, setObjetivoId] = useState(socio.objetivo_id || '')
  const [peso, setPeso] = useState(socio.peso_kg || '')
  const [talla, setTalla] = useState(socio.talla_m || '')
  const asignar = useAsignarPlanAutomatico(socio.id)

  const MOTIVOS = {
    ya_tiene_plan: 'Este socio ya tiene una rutina activa. Elimínala primero si quieres reemplazarla por la plantilla.',
    objetivo_sin_plan: 'Ese objetivo no tiene plantilla asociada.',
    sin_peso_talla: 'Faltan peso y talla para calcular el IMC.',
    sin_objetivo: 'Elige un objetivo para saber qué plantilla usar.',
    socio_inexistente: 'No se encontró al socio.',
  }

  function submit(e) {
    e.preventDefault()
    let t = Number(talla)
    if (t > 3) t = t / 100 // talla en cm (175) → metros, como en EditarSocioModal
    asignar.mutate(
      { objetivoId, pesoKg: Number(peso), tallaM: t },
      {
        onSuccess: (d) => {
          if (d?.asignado) {
            toast.ok(`Plantilla "${d.objetivo}" asignada · IMC ${d.imc}. Revisa y ajusta antes de enviarla a la app.`)
            onClose()
          } else {
            toast.error(MOTIVOS[d?.motivo] || 'No se pudo asignar la plantilla.')
          }
        },
        onError: (er) => toast.error(er.message),
      },
    )
  }

  return (
    <Modal title="⚡ Usar plantilla" subtitle={`Copia la rutina y dieta del objetivo, ajustadas al IMC de ${socio.nombre}.`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Campo label="Objetivo *">
          <select required value={objetivoId} onChange={(e) => setObjetivoId(e.target.value)} className={inputCls + ' cursor-pointer'}>
            <option value="">Elige un objetivo…</option>
            {conPlan.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Peso (kg) *">
            <input required type="number" step="0.1" min="1" value={peso} onChange={(e) => setPeso(e.target.value)} className={inputCls} placeholder="70" />
          </Campo>
          <Campo label="Talla (m) *">
            <input required type="number" step="0.01" min="0.5" value={talla} onChange={(e) => setTalla(e.target.value)} className={inputCls} placeholder="1.70" />
          </Campo>
        </div>
        <p className="-mt-1 text-[11.5px] font-semibold text-faint">
          Estos datos se guardan en la ficha del socio. La plantilla llega con las calorías y cargas ya ajustadas a su IMC; luego puedes editar cada día.
        </p>
        <BotonesModal onCancel={onClose} busy={asignar.isPending} submitLabel="Asignar plantilla" />
      </form>
    </Modal>
  )
}

function RutinasImpl() {
  const location = useLocation()
  const { sedeId } = usePanel()
  const socios = useSociosSelect(sedeId)
  const [socioId, setSocioId] = useState(location.state?.socioId ?? null)
  // Si el socio llegó por navegación desde la ficha (botón "Generar rutina y
  // dieta"), el efecto de abajo NO debe reencauzar la primera vez: la lista
  // sede-scoped puede tardar en cargar o el socio puede ser de otra sede, y
  // pisarlo dejaría la ficha en blanco justo cuando el usuario vino a verla.
  const vinoDeNavegacion = useRef(!!location.state?.socioId)

  // Al cargar socios, seleccionar el primero si no hay uno. Y si el socio
  // seleccionado ya no existe en la sede actual (cambio de sede), reencauzar
  // al primero en vez de quedar con la ficha en blanco apuntando a un id ausente.
  useEffect(() => {
    if (!socios.data?.length) return
    if (vinoDeNavegacion.current) { vinoDeNavegacion.current = false; return }
    const existe = socioId && socios.data.some((s) => s.id === socioId)
    if (!existe) setSocioId(socios.data[0].id)
  }, [socios.data, socioId])

  const { empresa, rol } = useAuth()
  // Cada especialista lo suyo: el nutricionista no toca la rutina;
  // entrenador y admin ven ambas (gyms sin nutricionista)
  const veRutina = rol !== 'nutricionista'
  const objetivosCatalogo = useObjetivos().data || []
  // Si el socio vino por navegación y aún no está en la lista sede-scoped
  // (otra sede, o la lista no cargó todavía), usamos un socio "de vista"
  // mínimo con lo que trajo la navegación: el nombre se ve y las queries de
  // rutina/dieta son socio-scoped (no dependen de la sede), así que funcionan igual.
  const socio = socios.data?.find((s) => s.id === socioId)
    || (socioId && socioId === location.state?.socioId
      ? { id: socioId, nombre: location.state?.socio || 'Socio', codigo: null, talla_m: null, peso_kg: null, objetivo: null }
      : undefined)
  const dieta = useDietaSocio(socioId)
  const enviar = useEnviarPlan(socioId)
  const rutina = useRutinaSocio(socioId)
  const crearRutina = useCrearRutina(socioId, empresa?.id)
  const crearDieta = useCrearDieta(socioId, empresa?.id)
  const setFoco = useSetFoco(socioId)
  const [meals, setMeals] = useState([])
  const [enviado, setEnviado] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [suplementos, setSuplementos] = useState('')
  const [notasRutina, setNotasRutina] = useState('')
  const guardarNotas = useGuardarNotasRutina(socioId)
  const guardarComida = useGuardarComida(socioId)
  const agregarComida = useAgregarComida(socioId, empresa?.id)
  const eliminarComida = useEliminarComida(socioId)
  const guardarSuplementos = useGuardarSuplementos(socioId)
  // Suplementos con stock en el Kardex del gym: recomendar lo que SÍ se puede
  // comprar en recepción (y de paso, venta cruzada)
  const productos = useProductos(sedeId)
  const suplementosStock = (productos.data || []).filter((p) => p.categoria === 'Suplementos' && p.stock > 0)
  const [diaSel, setDiaSel] = useState(null) // día cuya lista de ejercicios se edita
  const [bancoOpen, setBancoOpen] = useState(false) // gestión del banco de ejercicios (media)
  const [catalogoOpen, setCatalogoOpen] = useState(false) // "Agregar del catálogo" al día activo
  const [tab, setTab] = useState('socios') // 'socios' | 'plantillas'
  const [plantillaOpen, setPlantillaOpen] = useState(false) // modal "Usar plantilla"

  // Ejercicios de la rutina (mismas filas que escribe la app del entrenador)
  const diasIds = (rutina.data?.dias || []).map((d) => d.id)
  const ejercicios = useEjerciciosRutina(rutina.data?.id, diasIds)
  const guardarEj = useGuardarEjercicio(rutina.data?.id, empresa?.id)
  const eliminarEj = useEliminarEjercicio(rutina.data?.id)
  const [nuevoEj, setNuevoEj] = useState('')
  const banco = useBancoEjercicios(empresa?.id) // catálogo para autocompletar
  const agregarDia = useAgregarDia(socioId, empresa?.id)
  const eliminarDia = useEliminarDia(socioId)
  const diasFaltantes = [1, 2, 3, 4, 5, 6, 7].filter((n) => !(rutina.data?.dias || []).some((d) => d.dia_semana === n))

  useEffect(() => {
    if (!diaSel && rutina.data?.dias?.length) setDiaSel(rutina.data.dias[0].id)
    setNotasRutina(rutina.data?.notas || '')
  }, [rutina.data, diaSel])

  const diaActivo = (rutina.data?.dias || []).find((d) => d.id === diaSel)
  const ejsDelDia = (ejercicios.data || []).filter((e) => e.rutina_dia_id === diaSel)

  // Agregar un ejercicio al día activo. El orden se calcula del MÁXIMO existente
  // +1 (no de length+1) para no colisionar con órdenes tras borrar intermedios.
  // Además marca el plan como NO enviado: la rutina cambió y hay que reenviarla.
  const agregarEj = (nombre) => {
    const nextOrden = ejsDelDia.reduce((mx, e) => Math.max(mx, Number(e.orden) || 0), 0) + 1
    guardarEj.mutate(
      { rutina_dia_id: diaSel, nombre, series: 3, reps: '12', descanso: '60s', orden: nextOrden },
      { onError: (er) => toast.error(er.message) },
    )
    setEnviado(false)
  }

  // Buscador de socios (con 17+ el dropdown no escala)
  const sociosFiltrados = (socios.data || []).filter((s) =>
    !busqueda || s.nombre.toLowerCase().includes(busqueda.toLowerCase()) || s.codigo?.includes(busqueda))

  useEffect(() => {
    if (dieta.data?.comida) setMeals(dieta.data.comida)
    else setMeals([])
    setSuplementos(dieta.data?.suplementos || '')
  }, [dieta.data])

  // Total de calorías del DÍA base (comidas que se repiten todos los días,
  // dia_semana null). No sumamos las excepciones por día (lunes, sábado…):
  // pertenecen a días distintos y sumarlas juntas inflaría un total que no
  // corresponde a la ingesta de ningún día real.
  const kcalTotal = meals
    .filter((m) => (m.dia_semana ?? null) === null)
    .reduce((n, m) => n + (Number(m.kcal) || 0), 0)

  return (
    <div className="max-w-[1020px] px-7 pb-9 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Rutinas y dietas</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Genera el plan y envíalo a la app del socio</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex rounded-[10px] border border-line bg-white p-1">
            <button onClick={() => setTab('socios')}
              className={`cursor-pointer rounded-[8px] border-none px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors ${tab === 'socios' ? 'bg-orange text-white' : 'bg-transparent text-muted hover:text-orange'}`}>
              Por socio
            </button>
            <button onClick={() => setTab('plantillas')}
              className={`cursor-pointer rounded-[8px] border-none px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors ${tab === 'plantillas' ? 'bg-orange text-white' : 'bg-transparent text-muted hover:text-orange'}`}>
              Plantillas
            </button>
          </div>
          {veRutina && tab === 'socios' && (
            <button onClick={() => setBancoOpen(true)}
              className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange">
              🎬 Banco de ejercicios
            </button>
          )}
        </div>
      </div>

      {bancoOpen && <BancoEjerciciosModal onClose={() => setBancoOpen(false)} />}
      {plantillaOpen && socio && <AsignarPlantillaModal socio={socio} onClose={() => setPlantillaOpen(false)} />}
      {catalogoOpen && diaSel && (
        <Modal title="Catálogo de ejercicios" subtitle="Elige uno para agregarlo al día seleccionado" width={720} onClose={() => setCatalogoOpen(false)}>
          <BuscadorEjercicios onElegir={(ej) => {
            agregarEj(ej.nombre)
            toast.ok(`${ej.nombre} agregado`)
            setCatalogoOpen(false)
          }} />
        </Modal>
      )}

      {tab === 'plantillas' && <PlantillasPanel empresaId={empresa?.id} />}

      {tab === 'socios' && (
      <>
      {veRutina && (
        <SolicitudesCarga empresaId={empresa?.id}
          onIrSocio={(id) => { setSocioId(id); setBusqueda(''); setDiaSel(null); setEnviado(false) }} />
      )}

      {socios.isLoading && <LoadingState variant="cards" rows={2} />}
      {socios.error && <ErrorState error={socios.error} onRetry={socios.refetch} />}
      {socios.data?.length === 0 && <EmptyState message="No hay socios en esta sede." />}

      {socio && (
        <>
          <Card className="mt-[18px] p-[19px]">
            <div className="flex flex-wrap items-end gap-4">
              <div className="relative min-w-[260px]">
                <div className="mb-[7px] text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Socio</div>
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                  placeholder={`🔍 ${socio.nombre} — busca otro…`}
                  className="w-full rounded-[10px] border border-line bg-white px-3.5 py-[11px] text-[13.5px] font-bold text-ink outline-none focus:border-orange" />
                {busqueda && (
                  <div className="absolute left-0 z-20 mt-1 max-h-[220px] w-[280px] overflow-y-auto rounded-[10px] border border-line bg-white shadow-lg">
                    {sociosFiltrados.slice(0, 8).map((s) => (
                      <button key={s.id}
                        onClick={() => { setSocioId(s.id); setBusqueda(''); setDiaSel(null); setEnviado(false) }}
                        className="block w-full cursor-pointer border-none bg-transparent px-3.5 py-2.5 text-left text-[13px] font-bold hover:bg-[#FFF4EC]">
                        {s.nombre} <span className="font-semibold text-faint">· N.º {s.codigo}</span>
                      </button>
                    ))}
                    {sociosFiltrados.length === 0 && (
                      <div className="px-3.5 py-3 text-[12px] font-semibold text-faint">Nadie coincide.</div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Chip label="Talla:" value={socio.talla_m ? `${socio.talla_m} m` : '—'} />
                <Chip label="Peso:" value={socio.peso_kg ? `${socio.peso_kg} kg` : '—'} />
                {(() => {
                  // IMC = peso / talla² — el punto de partida del especialista.
                  // Si la talla vino en cm (p.ej. 175 en vez de 1.75), la
                  // normalizamos a metros (>3 → /100) como hace EditarSocioModal,
                  // para no calcular un IMC absurdo.
                  const p = Number(socio.peso_kg)
                  let t = Number(socio.talla_m)
                  if (t > 3) t = t / 100
                  if (!t || !p) return null
                  const imc = p / (t * t)
                  const [etiqueta, color, bg] =
                    imc < 18.5 ? ['Bajo peso', '#B45309', '#FEF3C7']
                    : imc < 25 ? ['Normal', '#1D9E75', '#E7F6F0']
                    : imc < 30 ? ['Sobrepeso', '#B45309', '#FEF3C7']
                    : ['Obesidad', '#E24B4A', '#FDECEC']
                  return (
                    <div className="rounded-[10px] px-[15px] py-2.5 text-[12.5px] font-bold" style={{ background: bg, color }}>
                      IMC: <span className="font-extrabold">{imc.toFixed(1)}</span> · {etiqueta}
                    </div>
                  )
                })()}
                {/* Texto libre del socio; si no tiene, el objetivo de catálogo (plan automático) */}
                <Chip label="Objetivo:" value={socio.objetivo || objetivosCatalogo.find((o) => o.id === socio.objetivo_id)?.nombre || '—'} accent />
              </div>
            </div>
          </Card>

          {/* Rutina semanal — la da el entrenador (el nutricionista no la ve) */}
          {veRutina && (
          <Card className="mt-[15px] p-[19px]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14.5px] font-extrabold">Rutina semanal</div>
                <div className="mt-0.5 text-[12px] font-semibold text-muted">Elige el enfoque de cada día · se guarda al instante</div>
              </div>
              {!rutina.data && !rutina.isLoading && (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setPlantillaOpen(true)}
                    className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange">
                    ⚡ Usar plantilla
                  </button>
                  <button onClick={() => crearRutina.mutate()} disabled={crearRutina.isPending}
                    className="cursor-pointer rounded-[10px] border-none bg-orange px-4 py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                    {crearRutina.isPending ? 'Creando…' : 'Crear rutina semanal'}
                  </button>
                </div>
              )}
            </div>
            {rutina.data?.dias?.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-[11px] sm:grid-cols-5">
                {rutina.data.dias.map((d) => {
                  const nEjs = (ejercicios.data || []).filter((e) => e.rutina_dia_id === d.id).length
                  return (
                    <div key={d.id} onClick={() => setDiaSel(d.id)}
                      className={`flex cursor-pointer flex-col gap-2.5 rounded-xl border p-[13px] transition-colors ${diaSel === d.id ? 'border-orange bg-orange-50/60' : 'border-line bg-[#FAFBFC] hover:border-orange'}`}>
                      <div className="flex items-center justify-between">
                        <div className="rounded-[8px] bg-navy px-2.5 py-1 text-[11.5px] font-extrabold text-white">
                          {DIA_NOMBRE[d.dia_semana]}
                        </div>
                        <span className="text-[10px] font-extrabold text-faint">{nEjs > 0 ? `${nEjs} ejerc.` : ''}</span>
                      </div>
                      <FocoInput dia={d} onGuardar={(foco) => { setFoco.mutate({ diaId: d.id, foco }); setEnviado(false) }} />
                    </div>
                  )
                })}
              </div>
            )}

            {/* Sumar los días que falten (martes, jueves…) */}
            {rutina.data?.id && diasFaltantes.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11.5px] font-extrabold text-muted">+ Agregar día:</span>
                {diasFaltantes.map((n) => (
                  <button key={n} disabled={agregarDia.isPending}
                    onClick={() => { agregarDia.mutate({ rutinaId: rutina.data.id, diaSemana: n }, { onSuccess: (d) => setDiaSel(d.id) }); setEnviado(false) }}
                    className="cursor-pointer rounded-full border border-dashed border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted hover:border-orange hover:text-orange disabled:opacity-50">
                    {DIA_NOMBRE[n]}
                  </button>
                ))}
              </div>
            )}

            {/* Ejercicios del día seleccionado — mismas filas que edita la app */}
            {diaActivo && (
              <div className="mt-4 rounded-xl border border-line bg-white p-[13px]">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px] font-extrabold">
                    Ejercicios del {['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][diaActivo.dia_semana]}
                    <span className="ml-1.5 font-bold text-muted">· {diaActivo.foco || 'sin foco'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] font-bold text-faint">serie · reps · carga · descanso — se guarda al salir del campo</span>
                    <button onClick={() => setCatalogoOpen(true)}
                      className="cursor-pointer rounded-[7px] border border-orange bg-transparent px-2 py-1 text-[10.5px] font-extrabold text-orange hover:bg-orange-50">
                      📚 Agregar del catálogo
                    </button>
                    <button onClick={() => { if (window.confirm(`¿Quitar el ${DIA_NOMBRE[diaActivo.dia_semana]} y sus ${ejsDelDia.length} ejercicios de la rutina?`)) { eliminarDia.mutate(diaSel); setDiaSel(null); setEnviado(false) } }}
                      className="cursor-pointer rounded-[7px] border border-line bg-white px-2 py-1 text-[10.5px] font-extrabold text-muted hover:border-red hover:text-red">
                      🗑 Quitar día
                    </button>
                  </div>
                </div>
                {ejsDelDia.map((ej) => (
                  <EjercicioFila key={ej.id} ej={ej} banco={banco.data || []}
                    onGuardar={(e) => { guardarEj.mutate(e, { onError: (er) => toast.error(er.message) }); setEnviado(false) }}
                    onEliminar={(id) => { eliminarEj.mutate(id); setEnviado(false) }} />
                ))}
                {ejsDelDia.length === 0 && (
                  <div className="py-2 text-[12px] font-semibold text-faint">Sin ejercicios aún — agrega el primero:</div>
                )}
                <div className="mt-2 flex gap-2 border-t border-line2 pt-2.5">
                  <InputEjercicio value={nuevoEj} onChange={(e) => setNuevoEj(e.target.value)} banco={banco.data || []}
                    onSelect={(nombre) => { agregarEj(nombre); setNuevoEj('') }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && nuevoEj.trim()) { agregarEj(nuevoEj.trim()); setNuevoEj('') } }}
                    placeholder="Nuevo ejercicio (ej. Press banca) y Enter…"
                    className="rounded-[9px] border border-dashed border-line bg-[#FAFBFC] px-3 py-2 text-[12.5px] font-bold outline-none focus:border-orange" />
                  <button onClick={() => { if (nuevoEj.trim()) { agregarEj(nuevoEj.trim()); setNuevoEj('') } }}
                    className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600">
                    + Agregar
                  </button>
                </div>
              </div>
            )}
            {!rutina.data && !rutina.isLoading && (
              <div className="mt-3 text-[12.5px] font-semibold text-muted">Este socio aún no tiene rutina. Créala desde cero, o usa una plantilla según su objetivo e IMC.</div>
            )}

            {/* Indicaciones generales del plan (el socio las ve en su app) */}
            {rutina.data?.id && (
              <div className="mt-4">
                <div className="mb-1.5 text-[12.5px] font-extrabold">📝 Indicaciones generales</div>
                <textarea rows={2} value={notasRutina} onChange={(e) => { setNotasRutina(e.target.value); setEnviado(false) }}
                  onBlur={() => guardarNotas.mutate({ rutinaId: rutina.data.id, notas: notasRutina })}
                  placeholder="Ej.: Calentar 10 min antes de empezar · Hidratarse entre series · Si hay dolor articular, parar y avisar…"
                  className="w-full resize-none rounded-[9px] border border-line bg-[#FAFBFC] px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-orange focus:bg-white" />
              </div>
            )}
          </Card>
          )}

          {/* Plan de comidas */}
          <Card className="mt-[15px] p-[19px]">
            <div className="flex items-center gap-3.5">
              <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] bg-orange-50"><TargetIcon size={19} stroke={T.primary} /></div>
              <div className="flex-1">
                <div className="text-[14.5px] font-extrabold">Plan de alimentación</div>
                <div className="mt-0.5 text-[12.5px] font-semibold text-muted">Edita cada comida y sus calorías</div>
              </div>
              <div className="rounded-full bg-green-50 px-[13px] py-1.5 text-[12px] font-extrabold text-green" title="Suma de la base diaria (las comidas 'Todos'); las excepciones por día no se suman aquí">Base diaria: {kcalTotal.toLocaleString('es-PE')} kcal</div>
            </div>

            {dieta.isLoading && <div className="mt-4"><LoadingState variant="table" rows={3} /></div>}
            {!dieta.isLoading && meals.length === 0 && (
              <div className="mt-4 rounded-[10px] bg-surface px-4 py-6 text-center">
                <div className="text-[12.5px] font-semibold text-muted">Este socio aún no tiene un plan de dieta.</div>
                <button onClick={() => crearDieta.mutate()} disabled={crearDieta.isPending}
                  className="mt-3 cursor-pointer rounded-[10px] border-none bg-orange px-5 py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                  {crearDieta.isPending ? 'Creando…' : 'Crear plan de dieta'}
                </button>
              </div>
            )}
            {/* Agrupado por día: primero la base diaria, luego cada excepción.
                Cambiar el chip de día de una comida la mueve a su grupo. */}
            <div className="mt-4 flex flex-col gap-2.5">
              {(() => {
                const orden = (a, b) => String(a.hora || '').localeCompare(String(b.hora || ''))
                const grupos = [
                  { dia: null, titulo: '📌 Base diaria (se repite todos los días)' },
                  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ dia: n, titulo: `📅 Solo los ${DIA_NOMBRE[n].toLowerCase()}` })),
                ]
                return grupos.map((g) => {
                  const filas = meals.filter((m) => (m.dia_semana ?? null) === g.dia).sort(orden)
                  if (filas.length === 0) return null
                  return (
                    <div key={g.dia ?? 'todos'}
                      className={`rounded-xl border p-2.5 ${g.dia ? 'border-orange/30 bg-orange-50/40' : 'border-line bg-white'}`}>
                      <div className={`mb-2 text-[11.5px] font-extrabold ${g.dia ? 'text-orange' : 'text-muted'}`}>{g.titulo}</div>
                      <div className="hidden flex-wrap items-center gap-2 pb-1 text-[9.5px] font-extrabold uppercase tracking-[0.5px] text-faint sm:flex">
                        <span className="w-[118px]">Comida</span><span className="w-[92px]">Hora</span>
                        <span className="w-[104px]">Día</span><span className="min-w-[160px] flex-1">Qué come</span>
                        <span className="w-[72px] text-right">Calorías</span><span className="w-[40px]" />
                      </div>
                      <div className="flex flex-col gap-2">
                        {filas.map((m) => (
                          <ComidaFila key={m.id} comida={m}
                            onGuardar={(c) => { guardarComida.mutate(c, { onError: (e) => toast.error(e.message) }); setEnviado(false) }}
                            onEliminar={(id) => { eliminarComida.mutate(id); setEnviado(false) }} />
                        ))}
                      </div>
                    </div>
                  )
                })
              })()}
              {dieta.data?.id && (
                <button onClick={() => agregarComida.mutate({ dietaId: dieta.data.id, orden: (meals.reduce((mx, m) => Math.max(mx, Number(m.orden) || 0), 0)) + 1 })}
                  className="cursor-pointer self-start rounded-[9px] border border-dashed border-line bg-white px-3.5 py-2 text-[12px] font-extrabold text-muted hover:border-orange hover:text-orange">
                  + Agregar comida <span className="font-semibold text-faint">(nace en "Todos"; cámbiale el día para hacerla semanal)</span>
                </button>
              )}
            </div>

            {/* Suplementos recomendados: el plus del especialista */}
            {dieta.data?.id && (
              <div className="mt-4 rounded-xl border border-line bg-[#FAFBFC] p-[13px]">
                <div className="mb-1.5 text-[12.5px] font-extrabold">💊 Suplementos y recomendaciones</div>
                <SuplementosEditor value={suplementos} enStock={suplementosStock}
                  onChange={(v) => { setSuplementos(v); setEnviado(false) }}
                  onCommit={(v) => guardarSuplementos.mutate({ dietaId: dieta.data.id, suplementos: v })} />
                <p className="mt-1 text-[10.5px] font-bold text-faint">El socio lo ve en su app como tarjeta 💊 junto a su plan de hoy.</p>
                {/* Lo que el gym tiene en stock: un clic lo recomienda (venta cruzada) */}
                {suplementosStock.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] font-extrabold uppercase text-faint">En stock del gym:</span>
                    {suplementosStock.map((p) => (
                      <button key={p.id} type="button"
                        onClick={() => {
                          const linea = `${p.nombre} — disponible en recepción (S/ ${Number(p.precio)})`
                          if (suplementos.includes(p.nombre)) return
                          const nuevo = suplementos ? `${suplementos}\n· ${linea}` : `· ${linea}`
                          setSuplementos(nuevo)
                          guardarSuplementos.mutate({ dietaId: dieta.data.id, suplementos: nuevo })
                          setEnviado(false)
                        }}
                        className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-extrabold transition-colors ${suplementos.includes(p.nombre) ? 'border-green-300 bg-green-50 text-green-700' : 'border-line bg-white text-muted hover:border-orange hover:text-orange'}`}>
                        {suplementos.includes(p.nombre) ? '✓ ' : '+ '}{p.nombre} <span className="font-bold text-faint">({p.stock})</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <div className="mt-[18px] flex items-center gap-3.5">
            <button disabled={(!dieta.data?.id && !rutina.data?.id) || enviar.isPending}
              onClick={() => enviar.mutate({ dietaId: dieta.data?.id, rutinaId: veRutina ? rutina.data?.id : null }, { onSuccess: () => setEnviado(true) })}
              className="cursor-pointer rounded-[11px] border-none bg-orange px-6 py-[13px] text-[14px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] transition-colors hover:bg-orange-600 active:scale-[0.98] disabled:opacity-50">
              {enviar.isPending ? 'Enviando…' : 'Enviar a la app del socio'}
            </button>
            {enviado && (
              <div className="flex animate-fadeSlide items-center gap-2 rounded-[10px] bg-green-50 px-4 py-[11px]">
                <CheckIcon size={15} stroke={T.success} />
                <span className="text-[13px] font-extrabold text-green-600">Plan enviado a la app de {socio.nombre}</span>
              </div>
            )}
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}

// Pestaña "Plantillas": lista informativa de las plantillas de rutina/dieta
// por objetivo (global del sistema vs. personalizada del gym). Sin editor de
// contenido — el editor completo de ejercicios/comidas de la plantilla se
// deja para una task futura; aquí solo se muestra qué plantilla aplicaría.
function PlantillasPanel({ empresaId }) {
  const objetivos = useObjetivos()
  const rutinas = usePlantillasRutina(empresaId)
  const dietas = usePlantillasDieta(empresaId)
  const cargando = objetivos.isLoading || rutinas.isLoading || dietas.isLoading
  const error = objetivos.error || rutinas.error || dietas.error

  return (
    <Card className="mt-[18px] p-[19px]">
      <div className="text-[14.5px] font-extrabold">📋 Plantillas del plan automático</div>
      <p className="mt-0.5 text-[12px] font-semibold text-muted">
        Al inscribir a un socio con objetivo + peso + talla, el sistema copia estas plantillas (moduladas por su IMC) como su rutina y dieta iniciales.
        También puedes asignarlas a mano: en «Por socio», elige al socio y pulsa «⚡ Usar plantilla».
        Prioriza la plantilla personalizada del gym; si no existe, usa la global. El editor de ejercicios/comidas de cada plantilla llega en una próxima mejora.
      </p>

      {cargando && <div className="mt-4"><LoadingState variant="table" rows={4} /></div>}
      {error && <ErrorState error={error} onRetry={() => { objetivos.refetch(); rutinas.refetch(); dietas.refetch() }} />}

      {!cargando && !error && (
        <div className="mt-4 flex flex-col gap-2.5">
          {(objetivos.data || []).map((o) => {
            const rGym = (rutinas.data || []).find((r) => r.objetivo_id === o.id && r.empresa_id)
            const rGlobal = (rutinas.data || []).find((r) => r.objetivo_id === o.id && !r.empresa_id)
            const dGym = (dietas.data || []).find((d) => d.objetivo_id === o.id && d.empresa_id)
            const dGlobal = (dietas.data || []).find((d) => d.objetivo_id === o.id && !d.empresa_id)
            const rutinaUsada = rGym || rGlobal
            const dietaUsada = dGym || dGlobal
            return (
              <div key={o.id} className="rounded-xl border border-line bg-[#FAFBFC] p-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13.5px] font-extrabold">{o.nombre}</div>
                  {!o.tiene_plan && <Badge bg="#F1F2F4" color="#6B7280">Sin plan automático</Badge>}
                </div>
                {o.tiene_plan && (
                  <div className="mt-2 flex flex-col gap-1.5 text-[12.5px] font-bold text-muted">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>🏋️ Rutina:</span>
                      {rutinaUsada ? (
                        <>
                          <span className="text-ink">{rutinaUsada.nombre}</span>
                          <Badge bg={rGym ? '#E7F6F0' : '#EEF1FF'} color={rGym ? '#1D9E75' : '#4C5AA8'}>
                            {rGym ? 'Personalizada (tu gym)' : 'Global'}
                          </Badge>
                        </>
                      ) : <span className="text-faint">— sin plantilla aún</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>🍽️ Dieta:</span>
                      {dietaUsada ? (
                        <>
                          <span className="text-ink">{dietaUsada.nombre}</span>
                          <Badge bg={dGym ? '#E7F6F0' : '#EEF1FF'} color={dGym ? '#1D9E75' : '#4C5AA8'}>
                            {dGym ? 'Personalizada (tu gym)' : 'Global'}
                          </Badge>
                        </>
                      ) : <span className="text-faint">— sin plantilla aún</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {(objetivos.data || []).length === 0 && (
            <EmptyState message="Aún no hay objetivos en el catálogo." />
          )}
        </div>
      )}
    </Card>
  )
}

function Chip({ label, value, accent }) {
  return (
    <div className={`rounded-[10px] px-[15px] py-2.5 text-[12.5px] font-bold text-muted ${accent ? 'bg-orange-50' : 'bg-surface'}`}>
      {label} <span className="font-extrabold" style={{ color: accent ? T.primary : T.navy }}>{value}</span>
    </div>
  )
}
