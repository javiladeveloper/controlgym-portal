import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, Avatar, Badge, GhostButton, PrimaryButton } from '../components/ui.jsx'
import { ChevronLeft } from '../components/icons.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import NuevoSocioModal from '../components/forms/NuevoSocioModal.jsx'
import EditarSocioModal from '../components/forms/EditarSocioModal.jsx'
import ImportarSociosModal from '../components/forms/ImportarSociosModal.jsx'
import { usePanel } from '../store.jsx'
import { useClientes, useSocioFicha } from '../hooks/useClientes.js'
import { estadoBadge, avatarColors, iniciales, estadoMembresiaVivo, fechaLocal } from '../lib/uiHelpers.js'

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}
function edadDe(fechaNac) {
  if (!fechaNac) return '—'
  const nac = fechaLocal(fechaNac)
  const diff = Date.now() - (nac ? nac.getTime() : NaN)
  // Fecha inválida o futura (dedazo en el año): no mostrar edad negativa/NaN
  if (isNaN(diff) || diff < 0) return '—'
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000)) + ' años'
}

// IMC = peso / talla². Devuelve null si faltan datos o son absurdos.
function imcDe(talla, peso) {
  const t = Number(talla), p = Number(peso)
  if (!t || !p || t < 0.5 || t > 2.6 || p < 10 || p > 400) return null
  const imc = p / (t * t)
  const cat = imc < 18.5 ? 'Bajo peso' : imc < 25 ? 'Normal' : imc < 30 ? 'Sobrepeso' : 'Obesidad'
  return { valor: imc.toFixed(1), cat }
}

function Ficha({ socioId, onBack, onVerSocio }) {
  const navigate = useNavigate()
  const { data: ficha, isLoading, error, refetch } = useSocioFicha(socioId)
  const [editOpen, setEditOpen] = useState(false)

  if (isLoading) return <div className="px-7 pt-6"><LoadingState variant="cards" rows={2} /></div>
  if (error) return <div className="px-7 pt-6"><ErrorState error={error} onRetry={refetch} /></div>
  if (!ficha) return null

  const av = avatarColors({ estado: ficha.estado, destacado: false })
  const st = ficha.estado === 'inactivo'
    ? { bg: '#E9EBF0', color: '#5B6472', label: 'De baja — ya no es miembro' }
    : estadoBadge(estadoMembresiaVivo(ficha.membresia?.[0]) || ficha.estado)

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-muted transition-colors hover:text-orange">
        <ChevronLeft /> Volver a clientes
      </button>

      <div className="mt-4 flex items-center gap-4">
        <Avatar ini={iniciales(ficha.nombre)} bg={av.bg} color={av.color} size={58} fontSize={19} />
        <div className="flex-1">
          <div className="text-[21px] font-extrabold tracking-[-0.3px]">{ficha.nombre}</div>
          <div className="mt-0.5 text-[13px] font-semibold text-muted">
            Socio N.º {ficha.codigo} · Plan {ficha.membresia?.[0]?.plan?.nombre || '—'}
          </div>
        </div>
        <Badge bg={st.bg} color={st.color} className="!px-[13px] !py-1.5 !text-[11.5px]">{st.label}</Badge>
        <GhostButton onClick={() => setEditOpen(true)}>✏️ Editar</GhostButton>
        <PrimaryButton onClick={() => navigate('/rutinas', { state: { socioId: ficha.id, socio: ficha.nombre } })}>
          Generar rutina y dieta
        </PrimaryButton>
      </div>

      {editOpen && (
        <EditarSocioModal socio={ficha} onClose={() => setEditOpen(false)} onSaved={refetch} />
      )}

      <div className="mt-[18px] grid grid-cols-2 gap-[15px]">
        <Card className="p-[19px]">
          <div className="mb-3 text-[14px] font-extrabold">Datos del socio</div>
          <div className="grid grid-cols-2 gap-[13px]">
            <Field label="Edad" value={edadDe(ficha.fecha_nacimiento)} />
            <Field label="Teléfono" value={ficha.telefono || '—'} />
            <Field label="Talla" value={ficha.talla_m ? `${ficha.talla_m} m` : '—'} />
            <Field label="Peso" value={ficha.peso_kg ? `${ficha.peso_kg} kg` : '—'} />
            {(() => {
              const imc = imcDe(ficha.talla_m, ficha.peso_kg)
              return (
                <div className="col-span-2">
                  <FieldLabel>IMC</FieldLabel>
                  <div className="mt-[3px] text-[14.5px] font-extrabold">
                    {imc ? <>{imc.valor} <span className="text-[12px] font-bold text-muted">· {imc.cat}</span></> : '—'}
                  </div>
                </div>
              )
            })()}
            <div className="col-span-2">
              <FieldLabel>Objetivo</FieldLabel>
              <div className="mt-[3px] text-[14.5px] font-extrabold text-orange">{ficha.objetivo || '—'}</div>
            </div>
            {ficha.membresia?.[0]?.promocion && (
              <div className="col-span-2">
                <FieldLabel>Promo de ingreso</FieldLabel>
                <div className="mt-[3px] text-[13.5px] font-extrabold">🎁 {ficha.membresia[0].promocion.nombre}</div>
                {(ficha.grupoPromo || []).length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-bold text-muted">
                    Entró con:
                    {ficha.grupoPromo.map((g) => (
                      <button key={g.id} onClick={() => { setEditOpen(false); onVerSocio?.(g.id) }}
                        className="cursor-pointer rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11.5px] font-extrabold text-ink hover:border-orange hover:text-orange">
                        {g.nombre}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-[19px]">
          <div className="text-[14px] font-extrabold">Constancia (últimas 8 semanas)</div>
          {(() => {
            // Visitas por semana: detecta al socio que se está "enfriando"
            const semanas = Array.from({ length: 8 }, () => 0)
            const ahora = Date.now()
            for (const e of ficha.entradas8sem || []) {
              const idx = 7 - Math.min(7, Math.floor((ahora - new Date(e.ocurrido_en).getTime()) / (7 * 86400000)))
              semanas[idx]++
            }
            const max = Math.max(1, ...semanas)
            const estaSemana = semanas[7]
            const promedio = semanas.slice(0, 7).reduce((a, b) => a + b, 0) / 7
            const enfriando = promedio >= 1.5 && estaSemana === 0
            return (
              <>
                <div className="mt-2.5 flex h-[72px] items-stretch gap-1.5">
                  {semanas.map((n, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <div className="w-full rounded-t-[4px]"
                        style={{ height: `${Math.round((n / max) * 100)}%`, minHeight: 2, background: n === 0 ? '#E5E7EB' : i === 7 ? '#FF6B35' : '#1D9E75' }}
                        title={`${n} visita${n === 1 ? '' : 's'}`} />
                      <div className="text-[9px] font-bold text-faint">{i === 7 ? 'hoy' : `-${7 - i}s`}</div>
                    </div>
                  ))}
                </div>
                <div className={`mt-2 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-extrabold ${enfriando ? 'bg-red-50 text-red' : 'bg-surface text-muted'}`}>
                  {enfriando
                    ? '⚠️ Venía seguido y esta semana no apareció — buen momento para escribirle'
                    : `Promedio: ${promedio.toFixed(1)} visitas/semana · esta semana: ${estaSemana}`}
                </div>
              </>
            )
          })()}
          <div className="mb-1.5 mt-4 border-t border-line2 pt-3 text-[14px] font-extrabold">Últimas visitas</div>
          {ficha.visitas.length === 0 && <div className="py-4 text-[12.5px] font-semibold text-muted">Sin visitas registradas.</div>}
          {ficha.visitas.map((v) => (
            <div key={v.id} className="flex items-center justify-between border-b border-line2 py-2.5">
              <div>
                <div className="text-[13px] font-extrabold">{fmtFecha(v.ocurrido_en)}</div>
                <div className="text-[11.5px] font-semibold text-muted capitalize">{v.direccion} · {v.resultado}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}

export default function Clientes() {
  const { sedeId, sedeNombre } = usePanel()
  // La ficha vive en la URL (/clientes?socio=<id>): así el deep-link entra,
  // F5 la conserva, el botón Atrás del navegador la cierra y el enlace se
  // puede copiar. setFichaId escribe/borra el query param.
  const [searchParams, setSearchParams] = useSearchParams()
  const fichaId = searchParams.get('socio')
  const setFichaId = (id) => setSearchParams(
    (prev) => {
      const next = new URLSearchParams(prev)
      if (id) next.set('socio', id); else next.delete('socio')
      return next
    },
    { replace: false },
  )
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [importarOpen, setImportarOpen] = useState(false)
  const [editar, setEditar] = useState(null) // socio en edición rápida desde la lista
  const { data: clientes, isLoading, error, refetch } = useClientes(sedeId)
  const [q, setQ] = useState('')

  if (fichaId) return <Ficha socioId={fichaId} onBack={() => setFichaId(null)} onVerSocio={setFichaId} />

  // Búsqueda DNI-first: por nombre, código, DNI, teléfono o correo.
  const filtered = (clientes || []).filter((c) => {
    if (!q) return true
    const t = q.toLowerCase().trim()
    return (
      c.nombre?.toLowerCase().includes(t) ||
      c.codigo?.includes(q) ||
      c.documento?.includes(q) ||
      c.telefono?.replace(/\D/g, '').includes(q.replace(/\D/g, '')) && q.replace(/\D/g, '') !== '' ||
      c.email?.toLowerCase().includes(t)
    )
  })

  // Grupos de promos 2x1/NxM: quiénes entraron juntos (misma promo, misma fecha)
  const grupos = new Map()
  for (const c of clientes || []) {
    const m = c.membresia?.[0]
    if (m?.promocion && ['2x1', 'grupal'].includes(m.promocion.tipo)) {
      const k = `${m.promocion.id}|${m.fecha_inicio}`
      if (!grupos.has(k)) grupos.set(k, [])
      grupos.get(k).push(c.nombre)
    }
  }
  const companerosDe = (c) => {
    const m = c.membresia?.[0]
    if (!m?.promocion || !['2x1', 'grupal'].includes(m.promocion.tipo)) return []
    return (grupos.get(`${m.promocion.id}|${m.fecha_inicio}`) || []).filter((n) => n !== c.nombre)
  }

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Clientes</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">
            {clientes?.length ?? 0} socios · {sedeNombre}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, DNI, N.º, teléfono o correo…"
            className="w-[290px] rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-orange"
          />
          <GhostButton onClick={() => setImportarOpen(true)} title="Migra tus socios desde tu Excel en minutos">⬆ Importar</GhostButton>
          <PrimaryButton onClick={() => setNuevoOpen(true)}>Nuevo socio</PrimaryButton>
        </div>
      </div>

      {nuevoOpen && <NuevoSocioModal sedeId={sedeId} onClose={() => setNuevoOpen(false)} />}
      {importarOpen && <ImportarSociosModal sedeId={sedeId} onClose={() => setImportarOpen(false)} />}
      {editar && <EditarSocioModal socio={editar} onClose={() => setEditar(null)} onSaved={refetch} />}

      {isLoading && <LoadingState variant="table" rows={6} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && !error && filtered.length === 0 && (
        q
          ? <EmptyState icon="🔍" message={`Nadie coincide con «${q}».`} />
          : <EmptyState icon="💪" message="Aún no tienes socios en esta sede — registra al primero y arranca."
              actionLabel="+ Registrar mi primer socio" onAction={() => setNuevoOpen(true)} />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <Card className="mt-[18px] overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-[2.2fr_1.3fr_1fr_1fr_150px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Socio</div><div>Plan</div><div>Estado</div><div>Vence</div><div />
          </div>
          {filtered.map((c) => {
            const mem = c.membresia?.[0]
            const av = avatarColors({ estado: c.estado })
            const deBaja = c.estado === 'inactivo'
            const st = deBaja ? { bg: '#E9EBF0', color: '#5B6472', label: 'De baja' } : estadoBadge(estadoMembresiaVivo(mem) || c.estado)
            const grupo = companerosDe(c)
            return (
              <div key={c.id}
                onClick={(e) => { if (e.target.closest('button,a')) return; setFichaId(c.id) }}
                className="grid min-w-[720px] cursor-pointer grid-cols-[2.2fr_1.3fr_1fr_1fr_150px] items-center gap-3 border-t border-line2 px-5 py-[13px] hover:bg-[#FAFBFC]">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar ini={iniciales(c.nombre)} bg={av.bg} color={av.color} />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-extrabold">{c.nombre}</div>
                    <div className="text-[11.5px] font-semibold text-muted">Socio N.º {c.codigo}</div>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ink">{mem?.plan?.nombre || '—'}</div>
                  {mem?.promocion && (
                    <div className="truncate text-[10.5px] font-extrabold text-orange" title={grupo.length ? `Entró con: ${grupo.join(', ')}` : mem.promocion.nombre}>
                      🎁 {mem.promocion.nombre}{grupo.length > 0 && ` · con ${grupo.join(' y ')}`}
                    </div>
                  )}
                </div>
                <div><Badge bg={st.bg} color={st.color}>{st.label}</Badge></div>
                {(() => {
                  // Señal visual de urgencia: rojo si ya venció, ámbar si vence
                  // en los próximos 7 días, gris si está vigente/sin membresía.
                  const fin = mem?.fecha_fin ? fechaLocal(mem.fecha_fin) : null
                  let cls = 'text-muted'
                  if (fin && !deBaja) {
                    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
                    const dias = Math.round((fin - hoy) / 86400000)
                    if (dias < 0) cls = 'text-red'
                    else if (dias <= 7) cls = 'text-amber-600'
                  }
                  return (
                    <div className={`text-[12.5px] font-semibold ${cls}`}>
                      {fin ? fin.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '—'}
                    </div>
                  )
                })()}
                <div className="flex items-center justify-end gap-1.5">
                  <button onClick={() => setEditar(c)} title="Editar socio"
                    className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-2 text-[12px] text-muted hover:border-orange hover:text-orange">✏️</button>
                  <GhostButton className="!py-2" onClick={() => setFichaId(c.id)}>Ver ficha</GhostButton>
                </div>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

function FieldLabel({ children }) {
  return <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">{children}</div>
}
function Field({ label, value }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-[3px] text-[14.5px] font-extrabold">{value}</div>
    </div>
  )
}
