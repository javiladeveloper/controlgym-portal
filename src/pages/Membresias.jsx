import { useState } from 'react'
import { Card, Badge, GhostButton } from '../components/ui.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import PlanesModal from '../components/forms/PlanesModal.jsx'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePlanes, useMembresias, useToggleFreeze, useRenovar, useAnularMembresia } from '../hooks/useMembresias.js'
import { estadoBadge, money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

function PlanCard({ p, moneda, popular }) {
  if (popular) {
    return (
      <div className="relative rounded-card bg-navy p-[19px]">
        {p.badge && <div className="absolute right-4 top-4 rounded-full bg-orange px-2.5 py-1 text-[10px] font-extrabold tracking-[0.5px] text-white">{p.badge}</div>}
        <div className="text-[13px] font-extrabold text-faint">{p.nombre}</div>
        <div className="mt-1.5 text-[26px] font-extrabold text-white">{money(p.precio, moneda)} <span className="text-[13px] font-semibold text-faint">/{p.unidad}</span></div>
        <div className="mt-1.5 text-[12.5px] font-semibold text-faint">{p.descripcion}</div>
        <div className="mt-[5px] text-[11.5px] font-extrabold text-green-400">
          {p.dias_congelamiento_anio ? `Congela hasta ${p.dias_congelamiento_anio} días/año` : 'Sin congelamiento'}
        </div>
        {p.cobra_matricula && <div className="mt-1 text-[11px] font-bold text-faint">Matrícula: {money(p.precio_matricula, moneda)}</div>}
      </div>
    )
  }
  return (
    <div className="rounded-card border border-line bg-white p-[19px]">
      <div className="text-[13px] font-extrabold text-muted">{p.nombre}</div>
      <div className="mt-1.5 text-[26px] font-extrabold">{money(p.precio, moneda)} <span className="text-[13px] font-semibold text-muted">/{p.unidad}</span></div>
      <div className="mt-1.5 text-[12.5px] font-semibold text-muted">{p.descripcion}</div>
      <div className="mt-[5px] text-[11.5px] font-extrabold" style={{ color: p.dias_congelamiento_anio ? T.success : T.faint }}>
        {p.dias_congelamiento_anio ? `Congela hasta ${p.dias_congelamiento_anio} días/año` : 'Sin congelamiento'}
      </div>
      {p.cobra_matricula && <div className="mt-1 text-[11px] font-bold text-muted">Matrícula: {money(p.precio_matricula, moneda)}</div>}
    </div>
  )
}

export default function Membresias() {
  const { sedeId } = usePanel()
  const { empresa, rol } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const planes = usePlanes()
  const membresias = useMembresias(sedeId)
  const freeze = useToggleFreeze(sedeId)
  const renovar = useRenovar(sedeId)
  const anular = useAnularMembresia(sedeId)
  const [planesOpen, setPlanesOpen] = useState(false)
  const [anulando, setAnulando] = useState(null) // membresía en confirmación de anulación

  function onAnular(m, devolver) {
    anular.mutate({ membresiaId: m.id, devolver }, {
      onSuccess: () => setAnulando(null),
      onError: (e) => { alert('No se pudo anular: ' + e.message); setAnulando(null) },
    })
  }

  const populares = new Set((planes.data || []).filter((p) => p.badge).map((p) => p.id))

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Membresías</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Planes y gestión de membresías de socios</p>
        </div>
        {rol === 'admin' && (
          <GhostButton onClick={() => setPlanesOpen(true)}>⚙️ Gestionar planes</GhostButton>
        )}
      </div>
      {planesOpen && <PlanesModal onClose={() => setPlanesOpen(false)} />}

      {/* Planes */}
      {planes.isLoading && <LoadingState variant="cards" rows={4} />}
      {planes.error && <ErrorState error={planes.error} onRetry={planes.refetch} />}
      {planes.data && (
        <div className="mt-5 grid grid-cols-4 gap-[15px]">
          {planes.data.map((p) => <PlanCard key={p.id} p={p} moneda={moneda} popular={populares.has(p.id)} />)}
        </div>
      )}

      {/* Gestión */}
      <Card className="mt-[15px] overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[14.5px] font-extrabold">Gestión de membresías</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Renueva, congela o reactiva según lo que permite cada plan</div>
        </div>
        <div className="grid grid-cols-[1.9fr_1.3fr_1.1fr_1fr_210px] items-center gap-3 bg-surface px-5 py-[11px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
          <div>Socio</div><div>Plan</div><div>Estado</div><div>Vence</div><div>Acciones</div>
        </div>

        {membresias.isLoading && <LoadingState variant="table" rows={5} />}
        {membresias.error && <ErrorState error={membresias.error} onRetry={membresias.refetch} />}
        {(membresias.data || []).map((m) => {
          const st = estadoBadge(m.estado)
          const dias = m.plan?.dias_congelamiento_anio || 0
          const frozen = m.estado === 'congelada'
          const busy = freeze.isPending || renovar.isPending
          return (
            <div key={m.id} className="grid grid-cols-[1.9fr_1.3fr_1.1fr_1fr_210px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div>
                <div className="text-[13.5px] font-extrabold">{m.socio?.nombre}</div>
                <div className="text-[11.5px] font-semibold text-muted">Socio N.º {m.socio?.codigo}</div>
              </div>
              <div>
                <div className="text-[13px] font-bold">{m.plan?.nombre}</div>
                <div className="text-[10.5px] font-extrabold text-faint">{dias ? `Congela hasta ${dias} días/año` : 'Sin congelamiento'}</div>
              </div>
              <div><Badge bg={st.bg} color={st.color}>{st.label}</Badge></div>
              <div className="text-[12.5px] font-bold text-muted">
                {m.fecha_fin ? new Date(m.fecha_fin).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '—'}
              </div>
              {anulando === m.id ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10.5px] font-extrabold text-red">¿Anular?</span>
                  <button disabled={anular.isPending} onClick={() => onAnular(m, false)}
                    className="cursor-pointer rounded-[8px] border-none bg-red px-2.5 py-1.5 text-[10.5px] font-extrabold text-white disabled:opacity-50">Sí</button>
                  <button disabled={anular.isPending} onClick={() => onAnular(m, true)}
                    className="cursor-pointer rounded-[8px] border border-red bg-white px-2.5 py-1.5 text-[10.5px] font-extrabold text-red disabled:opacity-50">Sí + devolver S/</button>
                  <button onClick={() => setAnulando(null)}
                    className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[10.5px] font-extrabold text-muted">No</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    disabled={busy || m.estado === 'cancelada'}
                    onClick={() => renovar.mutate(m.id)}
                    className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-3 py-2 text-[11.5px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-50"
                  >
                    Renovar
                  </button>
                  {dias && m.estado !== 'cancelada' ? (
                    <button
                      disabled={busy}
                      onClick={() => freeze.mutate({ membresiaId: m.id, dias: frozen ? null : 15 })}
                      className="cursor-pointer rounded-[9px] border border-[#C6CBD4] bg-transparent px-3 py-2 text-[11.5px] font-extrabold text-ink transition-colors hover:border-ink hover:bg-surface disabled:opacity-50"
                    >
                      {frozen ? 'Reactivar' : 'Congelar'}
                    </button>
                  ) : null}
                  {m.estado !== 'cancelada' && (
                    <button
                      disabled={busy}
                      onClick={() => setAnulando(m.id)}
                      title="Anular membresía"
                      className="cursor-pointer rounded-[9px] border border-line bg-transparent px-2.5 py-2 text-[11.5px] font-extrabold text-muted transition-colors hover:border-red hover:text-red disabled:opacity-50"
                    >
                      ✕
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </Card>

      {(freeze.error || renovar.error) && (
        <div className="mt-3"><ErrorState error={freeze.error || renovar.error} /></div>
      )}
    </div>
  )
}
