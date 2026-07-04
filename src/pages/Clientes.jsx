import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Avatar, Badge, GhostButton, PrimaryButton } from '../components/ui.jsx'
import { ChevronLeft } from '../components/icons.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import NuevoSocioModal from '../components/forms/NuevoSocioModal.jsx'
import EditarSocioModal from '../components/forms/EditarSocioModal.jsx'
import { usePanel } from '../store.jsx'
import { useClientes, useSocioFicha } from '../hooks/useClientes.js'
import { estadoBadge, avatarColors, iniciales } from '../lib/uiHelpers.js'

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}
function edadDe(fechaNac) {
  if (!fechaNac) return '—'
  const diff = Date.now() - new Date(fechaNac).getTime()
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000)) + ' años'
}

function Ficha({ socioId, onBack, onVerSocio }) {
  const navigate = useNavigate()
  const { data: ficha, isLoading, error, refetch } = useSocioFicha(socioId)
  const [editOpen, setEditOpen] = useState(false)

  if (isLoading) return <div className="px-7 pt-6"><LoadingState variant="cards" rows={2} /></div>
  if (error) return <div className="px-7 pt-6"><ErrorState error={error} onRetry={refetch} /></div>
  if (!ficha) return null

  const av = avatarColors({ estado: ficha.estado, destacado: false })
  const st = estadoBadge(ficha.membresia?.[0]?.estado || ficha.estado)

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
          <div className="mb-1.5 text-[14px] font-extrabold">Historial de asistencia</div>
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
  // Deep-link desde la búsqueda global: /clientes?socio=<id> abre la ficha
  const [fichaId, setFichaId] = useState(() => new URLSearchParams(window.location.search).get('socio'))
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [editar, setEditar] = useState(null) // socio en edición rápida desde la lista
  const { data: clientes, isLoading, error, refetch } = useClientes(sedeId)
  const [q, setQ] = useState('')

  if (fichaId) return <Ficha socioId={fichaId} onBack={() => setFichaId(null)} onVerSocio={setFichaId} />

  const filtered = (clientes || []).filter(
    (c) => !q || c.nombre.toLowerCase().includes(q.toLowerCase()) || c.codigo?.includes(q),
  )

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
            placeholder="Buscar por nombre o N.º de socio…"
            className="w-[290px] rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-orange"
          />
          <PrimaryButton onClick={() => setNuevoOpen(true)}>Nuevo socio</PrimaryButton>
        </div>
      </div>

      {nuevoOpen && <NuevoSocioModal sedeId={sedeId} onClose={() => setNuevoOpen(false)} />}
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
            const st = estadoBadge(mem?.estado || c.estado)
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
                <div className="text-[12.5px] font-semibold text-muted">
                  {mem?.fecha_fin ? new Date(mem.fecha_fin).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '—'}
                </div>
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
