import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, Avatar, Badge, GhostButton, PrimaryButton } from '../components/ui.jsx'
import { ChevronLeft } from '../components/icons.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import NuevoSocioModal from '../components/forms/NuevoSocioModal.jsx'
import EditarSocioModal from '../components/forms/EditarSocioModal.jsx'
import ImportarSociosModal from '../components/forms/ImportarSociosModal.jsx'
import { usePanel } from '../store.jsx'
import { useClientes, useSocioFicha, useValidarFoto, useAutorizacionMenor, useAutorizarMenor, useHistorialPagos, useMedidasSocio } from '../hooks/useClientes.js'
import { useAuth } from '../context/AuthContext.jsx'
import { toast } from '../lib/toast.js'
import { estadoBadge, avatarColors, iniciales, estadoMembresiaVivo, fechaLocal, claseVence, fechaCorta, money } from '../lib/uiHelpers.js'
import { metodoPagoLabel } from '../lib/pagos.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

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
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const { data: ficha, isLoading, error, refetch } = useSocioFicha(socioId)
  const validarFoto = useValidarFoto()
  const [editOpen, setEditOpen] = useState(false)

  function onValidarFoto(aprobar) {
    validarFoto.mutate({ socioId, aprobar }, {
      onSuccess: () => { toast.ok(aprobar ? 'Foto aprobada' : 'Foto rechazada'); refetch() },
      onError: (e) => toast.error(e.message),
    })
  }

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
        {/* Foto del socio si la subió y está aprobada; si no, iniciales */}
        {ficha.foto_url && ficha.foto_estado === 'aprobada' ? (
          <img src={ficha.foto_url} alt={ficha.nombre} className="h-[58px] w-[58px] flex-shrink-0 rounded-full object-cover" />
        ) : (
          <Avatar ini={iniciales(ficha.nombre)} bg={av.bg} color={av.color} size={58} fontSize={19} />
        )}
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

      {/* Foto pendiente de validar (la subió el socio desde su app) */}
      {ficha.foto_estado === 'pendiente' && ficha.foto_url && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-[12px] border border-amber-200 bg-amber-50 p-4">
          <img src={ficha.foto_url} alt="" className="h-16 w-16 flex-shrink-0 rounded-[10px] object-cover" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-extrabold text-amber-800">Foto por validar</div>
            <div className="text-[12px] font-semibold text-amber-700">El socio subió su foto para el reconocimiento facial. Revísala: rostro de frente, buena luz, sin gorra ni lentes.</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onValidarFoto(true)} disabled={validarFoto.isPending}
              className="cursor-pointer rounded-[9px] border-none bg-green px-3.5 py-2 text-[12.5px] font-extrabold text-white hover:bg-green-600 disabled:opacity-50">Aprobar</button>
            <button onClick={() => onValidarFoto(false)} disabled={validarFoto.isPending}
              className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-muted hover:border-red hover:text-red disabled:opacity-50">Rechazar</button>
          </div>
        </div>
      )}

      {/* Autorización del apoderado (solo si es menor) */}
      {ficha.es_menor && <AutorizacionMenor socioId={socioId} />}

      {editOpen && (
        <EditarSocioModal socio={ficha} onClose={() => setEditOpen(false)} onSaved={refetch} />
      )}

      <div className="mt-[18px] grid grid-cols-1 gap-[15px] lg:grid-cols-2">
        <div className="flex flex-col gap-[15px]">
        <Card className="p-[19px]">
          <div className="mb-3 text-[14px] font-extrabold">Datos del socio</div>
          <div className="grid grid-cols-2 gap-[13px] sm:grid-cols-2">
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

        <MembresiaActual ficha={ficha} moneda={moneda} />
        </div>

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

      {(ficha.membresia?.length || 0) > 1 && <MembresiasAnteriores membresias={ficha.membresia.slice(1)} moneda={moneda} />}
      <HistorialPagos socioId={socioId} moneda={moneda} />
      <Progreso socioId={socioId} talla={ficha.talla_m} />
    </div>
  )
}

// Días restantes de la membresía (o hace cuántos venció). null si no hay fecha.
function diasRestantes(fechaFin) {
  const fin = fechaLocal(fechaFin)
  if (!fin) return null
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  return Math.round((fin - hoy) / 86400000)
}

// Card "Membresía actual": la más reciente (ficha.membresia[0]), con estado
// vivo, vigencia, días restantes y saldo pendiente si lo hay.
function MembresiaActual({ ficha, moneda }) {
  const mem = ficha.membresia?.[0]
  if (!mem) {
    return (
      <Card className="p-[19px]">
        <div className="mb-3 text-[14px] font-extrabold">Membresía actual</div>
        <EmptyState message="Sin membresía — inscríbelo desde Membresías" />
      </Card>
    )
  }
  const st = estadoBadge(estadoMembresiaVivo(mem) || mem.estado)
  const dias = diasRestantes(mem.fecha_fin)
  const totalDebido = Number(mem.precio_pagado || 0) + Number(mem.matricula_pagada || 0)
  const pagado = Number(mem.monto_pagado || 0)
  const saldo = Math.max(0, totalDebido - pagado)
  return (
    <Card className="p-[19px]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[14px] font-extrabold">Membresía actual</div>
        <Badge bg={st.bg} color={st.color}>{st.label}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-[13px]">
        <div className="col-span-2">
          <FieldLabel>Plan</FieldLabel>
          <div className="mt-[3px] text-[14.5px] font-extrabold">{mem.plan?.nombre || '—'}</div>
        </div>
        <div className="col-span-2">
          <FieldLabel>Vigencia</FieldLabel>
          <div className="mt-[3px] text-[13.5px] font-extrabold">
            {fechaLocal(mem.fecha_inicio) ? fechaCorta(mem.fecha_inicio) : '—'} → {fechaLocal(mem.fecha_fin) ? fechaCorta(mem.fecha_fin) : '—'}
          </div>
          {dias !== null && (
            <div className={`mt-0.5 text-[12px] font-bold ${dias < 0 ? 'text-red' : dias <= 7 ? 'text-amber-600' : 'text-muted'}`}>
              {dias < 0 ? `Venció hace ${Math.abs(dias)} día${Math.abs(dias) === 1 ? '' : 's'}` : dias === 0 ? 'Vence hoy' : `${dias} día${dias === 1 ? '' : 's'} restante${dias === 1 ? '' : 's'}`}
            </div>
          )}
        </div>
        <div className="col-span-2">
          <FieldLabel>Pagado</FieldLabel>
          <div className="mt-[3px] text-[14.5px] font-extrabold">
            {money(pagado, moneda)} <span className="text-[12px] font-bold text-muted">de {money(totalDebido, moneda)}</span>
          </div>
          {saldo > 0 && (
            <div className="mt-1 inline-block rounded-[7px] bg-amber-50 px-2 py-[3px] text-[11.5px] font-extrabold text-amber-700">
              Saldo pendiente: {money(saldo, moneda)}
            </div>
          )}
        </div>
        {mem.promocion && (
          <div className="col-span-2">
            <FieldLabel>Promo</FieldLabel>
            <div className="mt-[3px] text-[13px] font-extrabold">🎁 {mem.promocion.nombre}</div>
          </div>
        )}
      </div>
    </Card>
  )
}

// Card colapsable con las membresías anteriores (todas menos la vigente).
// Mismo patrón que HistorialPagos: colapsada por defecto.
function MembresiasAnteriores({ membresias, moneda }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Card className="mt-[15px] p-[19px]">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent p-0 text-left">
        <div className="text-[14.5px] font-extrabold">📋 Membresías anteriores</div>
        <span className="text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : `Ver ${membresias.length} anterior${membresias.length === 1 ? '' : 'es'} ▼`}</span>
      </button>
      {abierto && (
        <div className="mt-3.5 border-t border-line2 pt-3.5">
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[1.6fr_1.4fr_1fr_1fr] gap-3 border-b border-line2 pb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
                <div>Plan</div><div>Vigencia</div><div>Estado</div><div className="text-right">Pagado</div>
              </div>
              {membresias.map((m) => {
                const st = estadoBadge(m.estado)
                return (
                  <div key={m.id} className="grid grid-cols-[1.6fr_1.4fr_1fr_1fr] items-center gap-3 border-b border-line2 py-2.5">
                    <div className="truncate text-[12.5px] font-bold">{m.plan?.nombre || '—'}</div>
                    <div className="text-[12px] font-semibold text-muted">{fechaCorta(m.fecha_inicio)} → {fechaCorta(m.fecha_fin)}</div>
                    <div><Badge bg={st.bg} color={st.color} className="!text-[10.5px]">{st.label}</Badge></div>
                    <div className="text-right text-[12.5px] font-extrabold">{money(m.monto_pagado, moneda)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
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
                <div className={`text-[12.5px] font-semibold ${claseVence(mem?.fecha_fin, !deBaja)}`}>
                  {fechaCorta(mem?.fecha_fin)}
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

// Tabla de pagos del socio (caja + app). Vive en un sub-componente aparte para
// que el hook useHistorialPagos (y su query a Supabase) solo se monte cuando
// el usuario expande la card — no en cada carga de la ficha.
function TablaHistorialPagos({ socioId, moneda }) {
  const historial = useHistorialPagos(socioId)
  const pagos = historial.data || []
  const total = pagos.reduce((acc, p) => acc + Number(p.monto || 0), 0)
  return (
    <div className="mt-3.5 border-t border-line2 pt-3.5">
      {historial.isLoading && <LoadingState variant="table" rows={3} />}
      {historial.isError && <ErrorState error={historial.error} onRetry={historial.refetch} />}
      {!historial.isLoading && !historial.isError && pagos.length === 0 && (
        <EmptyState message="Aún no hay pagos registrados" />
      )}
      {!historial.isLoading && !historial.isError && pagos.length > 0 && (
        <>
          <div className="mb-3 text-[13px] font-extrabold">
            Total acumulado: <span className="text-orange">{money(total, moneda)}</span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[1fr_2fr_1fr_1fr] gap-3 border-b border-line2 pb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
                <div>Fecha</div><div>Concepto</div><div>Método</div><div className="text-right">Monto</div>
              </div>
              {pagos.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_2fr_1fr_1fr] items-center gap-3 border-b border-line2 py-2.5">
                  <div className="text-[12.5px] font-bold">
                    {new Date(p.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </div>
                  <div className="truncate text-[12.5px] font-semibold">{p.concepto || '—'}</div>
                  <div className="text-[12px] font-semibold text-muted">{metodoPagoLabel(p.metodo)}</div>
                  <div className="text-right text-[12.5px] font-extrabold">{money(p.monto, moneda)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Card colapsada por defecto en la ficha del socio. TablaHistorialPagos (y su
// query) solo se monta tras expandir, así no se consulta de gratis.
function HistorialPagos({ socioId, moneda }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Card className="mt-[15px] p-[19px]">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent p-0 text-left">
        <div className="text-[14.5px] font-extrabold">💳 Historial de pagos</div>
        <span className="text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver pagos ▼'}</span>
      </button>
      {abierto && <TablaHistorialPagos socioId={socioId} moneda={moneda} />}
    </Card>
  )
}

// Contenido del progreso (peso/IMC en el tiempo). Sub-componente aparte para
// que useMedidasSocio solo se monte al expandir la card, igual que el patrón
// de historial de pagos.
function TablaProgreso({ socioId, talla }) {
  const medidas = useMedidasSocio(socioId)
  const regs = medidas.data || []
  if (medidas.isLoading) return <div className="mt-3.5 border-t border-line2 pt-3.5"><LoadingState variant="table" rows={2} /></div>
  if (medidas.isError) return <div className="mt-3.5 border-t border-line2 pt-3.5"><ErrorState error={medidas.error} onRetry={medidas.refetch} /></div>
  if (regs.length === 0) {
    return (
      <div className="mt-3.5 border-t border-line2 pt-3.5">
        <EmptyState message="Aún no hay medidas registradas — se registran desde la app o al inscribir" />
      </div>
    )
  }
  const primero = regs[0]
  const ultimo = regs[regs.length - 1]
  const deltaPeso = ultimo.peso_kg != null && primero.peso_kg != null ? Number(ultimo.peso_kg) - Number(primero.peso_kg) : null
  const pesos = regs.map((r) => Number(r.peso_kg) || 0)
  const maxPeso = Math.max(1, ...pesos)
  const minPeso = Math.min(...pesos.filter((p) => p > 0))

  return (
    <div className="mt-3.5 border-t border-line2 pt-3.5">
      {deltaPeso !== null && (
        <div className="mb-3.5 text-[13px] font-extrabold">
          Peso: {primero.peso_kg} → {ultimo.peso_kg} kg{' '}
          <span className={deltaPeso === 0 ? 'text-muted' : deltaPeso < 0 ? 'text-green-600' : 'text-amber-600'}>
            ({deltaPeso > 0 ? '+' : ''}{deltaPeso.toFixed(1)} kg)
          </span>
        </div>
      )}

      {/* Mini barras de peso por registro, mismo patrón visual que la
          constancia (divs con altura relativa al máximo). */}
      <div className="mb-4 flex h-[64px] items-stretch gap-1.5">
        {regs.map((r, i) => {
          const p = Number(r.peso_kg) || 0
          const rango = Math.max(1, maxPeso - minPeso)
          const alto = p > 0 ? 25 + Math.round(((p - minPeso) / rango) * 75) : 2
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${p || '—'} kg`}>
              <div className="w-full rounded-t-[4px]" style={{ height: `${alto}%`, minHeight: 2, background: i === regs.length - 1 ? '#FF6B35' : '#1D9E75' }} />
            </div>
          )
        })}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[480px]">
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-3 border-b border-line2 pb-2 text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Fecha</div><div>Peso</div><div>Talla</div><div>IMC</div>
          </div>
          {[...regs].reverse().map((r, i) => {
            const t = r.talla_m || talla
            const imc = imcDe(t, r.peso_kg)
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr] items-center gap-3 border-b border-line2 py-2.5">
                <div className="text-[12.5px] font-bold">{fechaCorta(r.fecha)}</div>
                <div className="text-[12.5px] font-semibold">{r.peso_kg ? `${r.peso_kg} kg` : '—'}</div>
                <div className="text-[12.5px] font-semibold">{t ? `${t} m` : '—'}</div>
                <div className="text-[12.5px] font-extrabold">{imc ? `${imc.valor} · ${imc.cat}` : '—'}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Card colapsable de progreso corporal. Colapsada por defecto; el hook de
// medidas solo se monta al expandir (mismo patrón que Historial de pagos).
function Progreso({ socioId, talla }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <Card className="mt-[15px] p-[19px]">
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-none bg-transparent p-0 text-left">
        <div className="text-[14.5px] font-extrabold">📈 Progreso</div>
        <span className="text-[12px] font-extrabold text-muted">{abierto ? 'Ocultar ▲' : 'Ver progreso ▼'}</span>
      </button>
      {abierto && <TablaProgreso socioId={socioId} talla={talla} />}
    </Card>
  )
}

// Autorización virtual del apoderado para un socio menor. Muestra el estado y
// permite registrar la firma (nombre + DNI del apoderado + consentimiento).
function AutorizacionMenor({ socioId }) {
  const est = useAutorizacionMenor(socioId)
  const autorizar = useAutorizarMenor(socioId)
  const [form, setForm] = useState(false)
  const [nombre, setNombre] = useState('')
  const [doc, setDoc] = useState('')
  const estado = est.data?.estado
  const inp = 'rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange'

  function firmar() {
    if (!nombre.trim()) { toast.error('Nombre del apoderado'); return }
    autorizar.mutate({ autorizadoPor: nombre.trim(), documento: doc.trim() }, {
      onSuccess: () => { toast.ok('Autorización registrada'); setForm(false); setNombre(''); setDoc('') },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="mt-4 rounded-[12px] border border-line bg-[#FAFBFC] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13.5px] font-extrabold">
            🧒 Autorización del apoderado
            {estado === 'autorizada' ? <Badge bg={T.successBg} color={T.success}>Autorizado</Badge>
              : estado === 'revocada' ? <Badge bg={T.dangerBg} color={T.danger}>Revocada</Badge>
              : <Badge bg={T.warningBg} color={T.warningStrong}>Sin autorización</Badge>}
          </div>
          {estado === 'autorizada' && (
            <div className="mt-0.5 text-[12px] font-semibold text-muted">
              Por {est.data.autorizado_por}{est.data.documento ? ` · DNI ${est.data.documento}` : ''}
              {est.data.autorizada_at ? ` · ${new Date(est.data.autorizada_at).toLocaleDateString('es-PE')}` : ''}
            </div>
          )}
        </div>
        {!form && (
          <button onClick={() => setForm(true)}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-muted hover:border-orange hover:text-orange">
            {estado === 'autorizada' ? 'Actualizar' : 'Registrar autorización'}
          </button>
        )}
      </div>

      {form && (
        <div className="mt-3">
          <p className="mb-2 text-[12px] font-semibold leading-[1.5] text-muted">
            Como apoderado del menor, autorizo su ingreso y participación en las actividades del
            gimnasio, y declaro conocer las normas de seguridad.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del apoderado" className={inp} />
            <input value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="DNI del apoderado (opcional)" className={inp} />
          </div>
          <div className="mt-2.5 flex gap-2">
            <button onClick={firmar} disabled={autorizar.isPending}
              className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">Confirmar autorización</button>
            <button onClick={() => setForm(false)}
              className="cursor-pointer rounded-[9px] border border-line bg-white px-4 py-2 text-[12.5px] font-extrabold text-muted">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
