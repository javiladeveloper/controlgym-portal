import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Card } from '../components/ui.jsx'
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
} from '../hooks/useRutinas.js'
import { toast } from '../lib/toast.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const FOCOS = ['Pierna y glúteo', 'Pecho y tríceps', 'Espalda y bíceps', 'Hombro y core', 'Full body y cardio', 'Descanso']
const DIA_NOMBRE = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' }

// Foco del día como texto LIBRE (con sugerencias): la app escribe focos
// personalizados tipo "Espalda, hombro y cardio" y el panel debe respetarlos
function FocoInput({ dia, onGuardar }) {
  const [v, setV] = useState(dia.foco || '')
  useEffect(() => { setV(dia.foco || '') }, [dia.foco])
  const commit = () => { if (v.trim() && v !== dia.foco) onGuardar(v.trim()) }
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
function InputEjercicio({ value, onChange, onBlur, onKeyDown, placeholder, className, banco }) {
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
              onMouseDown={(ev) => { ev.preventDefault(); onChange({ target: { value: e.nombre } }) }}
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
  const cls = 'rounded-[8px] border border-line bg-white px-2 py-1.5 text-[12px] font-bold outline-none focus:border-orange'
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line2 py-1.5 first:border-0">
      <InputEjercicio value={e.nombre} onChange={set('nombre')} onBlur={commit} placeholder="Ejercicio"
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

function RutinasImpl() {
  const location = useLocation()
  const { sedeId } = usePanel()
  const socios = useSociosSelect(sedeId)
  const [socioId, setSocioId] = useState(location.state?.socioId ?? null)

  // Al cargar socios, seleccionar el primero si no hay uno.
  useEffect(() => {
    if (!socioId && socios.data?.length) setSocioId(socios.data[0].id)
  }, [socios.data, socioId])

  const { empresa, rol } = useAuth()
  // Cada especialista lo suyo: el nutricionista no toca la rutina;
  // entrenador y admin ven ambas (gyms sin nutricionista)
  const veRutina = rol !== 'nutricionista'
  const socio = socios.data?.find((s) => s.id === socioId)
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
  const [diaSel, setDiaSel] = useState(null) // día cuya lista de ejercicios se edita

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

  // Buscador de socios (con 17+ el dropdown no escala)
  const sociosFiltrados = (socios.data || []).filter((s) =>
    !busqueda || s.nombre.toLowerCase().includes(busqueda.toLowerCase()) || s.codigo?.includes(busqueda))

  useEffect(() => {
    if (dieta.data?.comida) setMeals(dieta.data.comida)
    else setMeals([])
    setSuplementos(dieta.data?.suplementos || '')
  }, [dieta.data])

  const kcalTotal = meals.reduce((n, m) => n + (Number(m.kcal) || 0), 0)

  return (
    <div className="max-w-[1020px] px-7 pb-9 pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Rutinas y dietas</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">Genera el plan y envíalo a la app del socio</p>

      {socios.isLoading && <LoadingState variant="cards" rows={2} />}
      {socios.error && <ErrorState error={socios.error} onRetry={socios.refetch} />}
      {socios.data?.length === 0 && <EmptyState message="No hay socios en esta sede." />}

      {socio && (
        <>
          <Card className="mt-[18px] p-[19px]">
            <div className="flex flex-wrap items-end gap-4">
              <div className="min-w-[260px]">
                <div className="mb-[7px] text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Socio</div>
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                  placeholder={`🔍 ${socio.nombre} — busca otro…`}
                  className="w-full rounded-[10px] border border-line bg-white px-3.5 py-[11px] text-[13.5px] font-bold text-ink outline-none focus:border-orange" />
                {busqueda && (
                  <div className="absolute z-20 mt-1 max-h-[220px] w-[280px] overflow-y-auto rounded-[10px] border border-line bg-white shadow-lg">
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
                <Chip label="Objetivo:" value={socio.objetivo || '—'} accent />
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
                <button onClick={() => crearRutina.mutate()} disabled={crearRutina.isPending}
                  className="cursor-pointer rounded-[10px] border-none bg-orange px-4 py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                  {crearRutina.isPending ? 'Creando…' : 'Crear rutina semanal'}
                </button>
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
                      <FocoInput dia={d} onGuardar={(foco) => setFoco.mutate({ diaId: d.id, foco })} />
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
                    onClick={() => agregarDia.mutate({ rutinaId: rutina.data.id, diaSemana: n }, { onSuccess: (d) => setDiaSel(d.id) })}
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
                    <button onClick={() => { if (window.confirm(`¿Quitar el ${DIA_NOMBRE[diaActivo.dia_semana]} y sus ${ejsDelDia.length} ejercicios de la rutina?`)) { eliminarDia.mutate(diaSel); setDiaSel(null) } }}
                      className="cursor-pointer rounded-[7px] border border-line bg-white px-2 py-1 text-[10.5px] font-extrabold text-muted hover:border-red hover:text-red">
                      🗑 Quitar día
                    </button>
                  </div>
                </div>
                {ejsDelDia.map((ej) => (
                  <EjercicioFila key={ej.id} ej={ej} banco={banco.data || []}
                    onGuardar={(e) => guardarEj.mutate(e, { onError: (er) => toast.error(er.message) })}
                    onEliminar={(id) => eliminarEj.mutate(id)} />
                ))}
                {ejsDelDia.length === 0 && (
                  <div className="py-2 text-[12px] font-semibold text-faint">Sin ejercicios aún — agrega el primero:</div>
                )}
                <div className="mt-2 flex gap-2 border-t border-line2 pt-2.5">
                  <InputEjercicio value={nuevoEj} onChange={(e) => setNuevoEj(e.target.value)} banco={banco.data || []}
                    onKeyDown={(e) => { if (e.key === 'Enter' && nuevoEj.trim()) { guardarEj.mutate({ rutina_dia_id: diaSel, nombre: nuevoEj.trim(), series: 3, reps: '12', descanso: '60s', orden: ejsDelDia.length + 1 }); setNuevoEj('') } }}
                    placeholder="Nuevo ejercicio (ej. Press banca) y Enter…"
                    className="rounded-[9px] border border-dashed border-line bg-[#FAFBFC] px-3 py-2 text-[12.5px] font-bold outline-none focus:border-orange" />
                  <button onClick={() => { if (nuevoEj.trim()) { guardarEj.mutate({ rutina_dia_id: diaSel, nombre: nuevoEj.trim(), series: 3, reps: '12', descanso: '60s', orden: ejsDelDia.length + 1 }); setNuevoEj('') } }}
                    className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600">
                    + Agregar
                  </button>
                </div>
              </div>
            )}
            {!rutina.data && !rutina.isLoading && (
              <div className="mt-3 text-[12.5px] font-semibold text-muted">Este socio aún no tiene rutina. Créala y ajusta cada día.</div>
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
              <div className="rounded-full bg-green-50 px-[13px] py-1.5 text-[12px] font-extrabold text-green">Total: {kcalTotal.toLocaleString('es-PE')} kcal</div>
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
            <div className="mt-4 flex flex-col gap-2.5">
              {meals.map((m) => (
                <ComidaFila key={m.id} comida={m}
                  onGuardar={(c) => { guardarComida.mutate(c, { onError: (e) => toast.error(e.message) }); setEnviado(false) }}
                  onEliminar={(id) => { eliminarComida.mutate(id); setEnviado(false) }} />
              ))}
              {dieta.data?.id && (
                <button onClick={() => agregarComida.mutate({ dietaId: dieta.data.id, orden: meals.length + 1 })}
                  className="cursor-pointer self-start rounded-[9px] border border-dashed border-line bg-white px-3.5 py-2 text-[12px] font-extrabold text-muted hover:border-orange hover:text-orange">
                  + Comida (usa el chip de día para el plan semanal)
                </button>
              )}
            </div>

            {/* Suplementos recomendados: el plus del especialista */}
            {dieta.data?.id && (
              <div className="mt-4 rounded-xl border border-line bg-[#FAFBFC] p-[13px]">
                <div className="mb-1.5 text-[12.5px] font-extrabold">💊 Suplementos y recomendaciones</div>
                <textarea rows={2} value={suplementos} onChange={(e) => { setSuplementos(e.target.value); setEnviado(false) }}
                  onBlur={() => guardarSuplementos.mutate({ dietaId: dieta.data.id, suplementos })}
                  placeholder="Ej.: Proteína whey 1 scoop post-entreno · Creatina 5g diarios con agua · Dormir 7-8 horas…"
                  className="w-full resize-none rounded-[9px] border border-line bg-white px-3 py-2.5 text-[13px] font-semibold outline-none focus:border-orange" />
                <p className="mt-1 text-[10.5px] font-bold text-faint">El socio lo ve en su app como tarjeta 💊 junto a su plan de hoy.</p>
              </div>
            )}
          </Card>

          <div className="mt-[18px] flex items-center gap-3.5">
            <button disabled={(!dieta.data?.id && !rutina.data?.id) || enviar.isPending}
              onClick={() => enviar.mutate({ dietaId: dieta.data?.id, rutinaId: veRutina ? rutina.data?.id : null, comidas: meals }, { onSuccess: () => setEnviado(true) })}
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
    </div>
  )
}

function Chip({ label, value, accent }) {
  return (
    <div className={`rounded-[10px] px-[15px] py-2.5 text-[12.5px] font-bold text-muted ${accent ? 'bg-orange-50' : 'bg-surface'}`}>
      {label} <span className="font-extrabold" style={{ color: accent ? T.primary : T.navy }}>{value}</span>
    </div>
  )
}
