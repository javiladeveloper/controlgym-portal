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
} from '../hooks/useRutinas.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const FOCOS = ['Pierna y glúteo', 'Pecho y tríceps', 'Espalda y bíceps', 'Hombro y core', 'Full body y cardio', 'Descanso']
const DIA_LETRA = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' }

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

  const { empresa } = useAuth()
  const socio = socios.data?.find((s) => s.id === socioId)
  const dieta = useDietaSocio(socioId)
  const enviar = useEnviarPlan(socioId)
  const rutina = useRutinaSocio(socioId)
  const crearRutina = useCrearRutina(socioId, empresa?.id)
  const crearDieta = useCrearDieta(socioId, empresa?.id)
  const setFoco = useSetFoco(socioId)
  const [meals, setMeals] = useState([])
  const [enviado, setEnviado] = useState(false)

  useEffect(() => {
    if (dieta.data?.comida) setMeals(dieta.data.comida)
    else setMeals([])
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
              <div>
                <div className="mb-[7px] text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Socio</div>
                <select value={socioId} onChange={(e) => { setSocioId(e.target.value); setEnviado(false) }}
                  className="min-w-[230px] cursor-pointer rounded-[10px] border border-line bg-white px-3.5 py-[11px] text-[13.5px] font-bold text-ink outline-none">
                  {socios.data.map((s) => <option key={s.id} value={s.id}>{s.nombre} · N.º {s.codigo}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Chip label="Talla:" value={socio.talla_m ? `${socio.talla_m} m` : '—'} />
                <Chip label="Peso:" value={socio.peso_kg ? `${socio.peso_kg} kg` : '—'} />
                <Chip label="Objetivo:" value={socio.objetivo || '—'} accent />
              </div>
            </div>
          </Card>

          {/* Rutina semanal */}
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
              <div className="mt-4 grid grid-cols-5 gap-[11px]">
                {rutina.data.dias.map((d) => (
                  <div key={d.id} className="flex flex-col gap-2.5 rounded-xl border border-line bg-[#FAFBFC] p-[13px]">
                    <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-navy text-[13px] font-extrabold text-white">
                      {DIA_LETRA[d.dia_semana]}
                    </div>
                    <select value={d.foco || 'Descanso'} onChange={(e) => setFoco.mutate({ diaId: d.id, foco: e.target.value })}
                      className="w-full cursor-pointer rounded-[9px] border border-line bg-white px-1.5 py-[9px] text-[12px] font-extrabold text-ink outline-none hover:border-orange">
                      {FOCOS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {!rutina.data && !rutina.isLoading && (
              <div className="mt-3 text-[12.5px] font-semibold text-muted">Este socio aún no tiene rutina. Créala y ajusta cada día.</div>
            )}
          </Card>

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
              {meals.map((m, i) => (
                <div key={m.id || i} className="flex items-center gap-3">
                  <div className="w-[130px] flex-shrink-0">
                    <div className="text-[12px] font-extrabold">{m.nombre}</div>
                    <div className="text-[10.5px] font-semibold text-muted">{m.hora?.slice(0, 5)}</div>
                  </div>
                  <input value={m.descripcion || ''} onChange={(e) => { const v = e.target.value; setMeals((ms) => ms.map((x, j) => j === i ? { ...x, descripcion: v } : x)); setEnviado(false) }}
                    className="flex-1 rounded-[9px] border border-line bg-[#FAFBFC] px-[13px] py-2.5 text-[13px] font-semibold text-ink outline-none focus:border-orange focus:bg-white" />
                  <input type="number" value={m.kcal ?? 0} onChange={(e) => { const v = Number(e.target.value) || 0; setMeals((ms) => ms.map((x, j) => j === i ? { ...x, kcal: v } : x)); setEnviado(false) }}
                    className="w-[76px] rounded-[9px] border border-line bg-[#FAFBFC] px-2 py-2.5 text-right text-[13px] font-extrabold text-ink outline-none focus:border-orange focus:bg-white" />
                  <div className="w-[26px] text-[11px] font-extrabold text-muted">kcal</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="mt-[18px] flex items-center gap-3.5">
            <button disabled={!dieta.data?.id || enviar.isPending}
              onClick={() => enviar.mutate({ dietaId: dieta.data.id, comidas: meals }, { onSuccess: () => setEnviado(true) })}
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
