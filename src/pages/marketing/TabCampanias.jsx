import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { toast } from '../../lib/toast.js'

/**
 * CAMPAÑAS: escribirle a toda la base de una vez (2026-09-02).
 *
 * El panel tenía un botón "Campañas" apagado desde julio, esperando que el
 * dueño decidiera "correo gratis vs WhatsApp API". Resultó falsa disyuntiva:
 * el mensaje se lo cobra META A LA TARJETA DEL GIMNASIO, no a FitCore. Así que
 * ofrecerlo no nos cuesta nada — y para un gym es la venta más barata que hay:
 * escribirle al que ya fue socio y dejó de venir.
 *
 * LA DIFERENCIA CON LEADAI: allá se pegan teléfonos a mano en un textarea.
 * Acá el gimnasio YA tiene su base, así que los destinatarios salen de sus
 * propios segmentos (vencidos, por vencer, activos). Pedirle que copie
 * teléfonos de una pantalla a otra sería absurdo.
 */

const SEGMENTOS = [
  { id: 'vencidos', label: 'Se les venció', ayuda: 'Ya fueron socios y no renovaron. El que más rinde.' },
  { id: 'por_vencer', label: 'Por vencer (7 días)', ayuda: 'Atájalos antes de que se caigan.' },
  { id: 'activos', label: 'Activos', ayuda: 'Con membresía vigente hoy.' },
  { id: 'de_baja', label: 'Nunca compraron', ayuda: 'Se registraron y no llegaron a pagar.' },
]

// Cómo se ve el estado que Meta le da a cada plantilla.
const ESTADO_PLANTILLA = {
  APPROVED: { txt: 'Aprobada', cls: 'bg-green-50 text-green-600' },
  PENDING: { txt: 'En revisión de Meta', cls: 'bg-orange-50 text-orange' },
  REJECTED: { txt: 'Rechazada', cls: 'bg-red-50 text-red' },
}

const ESTADO_CAMPANIA = {
  enviando: { txt: 'Enviando', cls: 'bg-green-50 text-green-600' },
  pausada: { txt: 'Pausada', cls: 'bg-orange-50 text-orange' },
  completada: { txt: 'Completada', cls: 'bg-line2 text-faint' },
}

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  return {
    authorization: `Bearer ${data?.session?.access_token || ''}`,
    'content-type': 'application/json',
  }
}

async function pedir(url, init) {
  const r = await fetch(url, { ...init, headers: await authHeader() })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(out.error || 'Algo salió mal')
  return out
}

export default function TabCampanias({ sedeId }) {
  const qc = useQueryClient()
  const [sub, setSub] = useState('envios') // envios | plantillas
  const [creando, setCreando] = useState(false)

  const estado = useQuery({
    queryKey: ['camp-estado', sedeId],
    queryFn: () => pedir(`/api/leadia?action=campanias&op=estado&sedeId=${sedeId}`),
  })

  const lista = useQuery({
    queryKey: ['camp-lista', sedeId],
    queryFn: () => pedir(`/api/leadia?action=campanias&op=listar&sedeId=${sedeId}`),
    refetchInterval: 30000, // una campaña enviando avanza sola
  })

  const plantillas = useQuery({
    queryKey: ['camp-plantillas', sedeId],
    queryFn: () => pedir(`/api/leadia?action=campanias&op=plantillas&sedeId=${sedeId}`),
  })

  // Sin add-on no hay nada que mostrar; se explica en vez de dejar en blanco.
  if (estado.data?.activo === false) {
    return (
      <Card className="p-6">
        <div className="text-[14px] font-extrabold">Finny todavía no está activo en esta sede</div>
        <p className="mt-1 text-[13px] font-semibold leading-relaxed text-muted">
          Las campañas salen por el WhatsApp de tu gimnasio. Actívalo en
          Configuración › Finny y conecta tu número.
        </p>
      </Card>
    )
  }

  if (estado.data?.sinMarketing) {
    return (
      <Card className="p-6">
        <div className="text-[14px] font-extrabold">Tu plan todavía no incluye campañas</div>
        <p className="mt-1 text-[13px] font-semibold leading-relaxed text-muted">
          Escríbenos y lo activamos. Es lo que te deja avisarle a toda tu base de
          una sola vez — la promo del mes, o que hace rato no vienen.
        </p>
      </Card>
    )
  }

  const cupo = estado.data?.cupo
  const pago = estado.data?.pago
  const items = lista.data?.items || []
  const plts = plantillas.data?.plantillas || []
  const aprobadas = plts.filter((p) => p.estado === 'APPROVED')

  return (
    <div>
      {/* El aviso del gasto va ARRIBA DE TODO, antes de cualquier control: quién
          cobra y a quién. Es la plata del gimnasio, no la nuestra. */}
      <div className="rounded-[12px] bg-orange-50 p-3.5">
        <p className="text-[12px] font-semibold leading-relaxed text-orange">
          💬 Cada mensaje tiene un costo que <strong>Meta le cobra a la cuenta de
          WhatsApp de tu gimnasio</strong>, no a FitCore. El precio por mensaje lo
          pone Meta (~S/0.25 los de promoción).
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        {cupo && (
          <div className="rounded-[10px] border border-line px-3 py-2 text-[11.5px] font-semibold text-muted">
            📨 <strong className="text-ink">{cupo.restante}</strong> envíos disponibles este mes
            {cupo.tope ? ` (de ${cupo.tope})` : ''}
          </div>
        )}
        {/* Solo se pide la tarjeta si SABEMOS que no la tiene. Con null nos
            callamos: pedírsela a quien ya la registró es ruido. */}
        {pago?.tieneMetodoPago === false && (
          <div className="rounded-[10px] border border-orange bg-white px-3 py-2 text-[11.5px] font-semibold text-muted">
            💳 Meta cobra a la tarjeta de tu cuenta y aún no tienes una.{' '}
            <a href={pago.urlPagos} target="_blank" rel="noreferrer"
              className="font-extrabold text-orange underline">Regístrala aquí</a> para que los envíos salgan.
          </div>
        )}
        <button onClick={() => setCreando(true)} disabled={aprobadas.length === 0}
          className="ml-auto cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
          + Nueva campaña
        </button>
      </div>

      <div className="mt-3 flex gap-1.5">
        {[['envios', 'Envíos'], ['plantillas', 'Plantillas']].map(([v, txt]) => (
          <button key={v} onClick={() => { setSub(v); setCreando(false) }}
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition-colors ${
              sub === v ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
            {txt}
          </button>
        ))}
      </div>

      {sub === 'envios' && (
        creando
          ? <FormCampania sedeId={sedeId} aprobadas={aprobadas}
              onCerrar={() => setCreando(false)}
              onListo={() => { setCreando(false); qc.invalidateQueries({ queryKey: ['camp-lista', sedeId] }) }} />
          : <ListaEnvios sedeId={sedeId} items={items} cargando={lista.isLoading}
              hayPlantillas={aprobadas.length > 0} onCrear={() => setCreando(true)} />
      )}

      {sub === 'plantillas' && (
        <Plantillas sedeId={sedeId} plantillas={plts} cargando={plantillas.isLoading}
          error={plantillas.error} onCambio={() => qc.invalidateQueries({ queryKey: ['camp-plantillas', sedeId] })} />
      )}
    </div>
  )
}

function ListaEnvios({ items, cargando, hayPlantillas, onCrear }) {
  if (cargando) return <p className="mt-4 text-[13px] font-semibold text-faint">Cargando…</p>

  if (items.length === 0) {
    return (
      <Card className="mt-3 p-8 text-center">
        <div className="text-[14px] font-extrabold">Todavía no enviaste campañas</div>
        <p className="mx-auto mt-1 max-w-md text-[12.5px] font-semibold leading-relaxed text-muted">
          {hayPlantillas
            ? 'Elige a quiénes escribirles y qué decirles. Toma un minuto.'
            : 'Primero crea una plantilla y espera que Meta la apruebe. Después lanzas tu primer envío.'}
        </p>
        {hayPlantillas && (
          <button onClick={onCrear}
            className="mt-3 cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600">
            Crear la primera
          </button>
        )}
      </Card>
    )
  }

  return (
    <div className="mt-3 space-y-2.5">
      {items.map((c) => {
        const e = ESTADO_CAMPANIA[c.estado] || { txt: c.estado, cls: 'bg-line2 text-faint' }
        const total = c.total || 0
        const hechos = (c.enviados || 0) + (c.fallidos || 0)
        const pct = total > 0 ? Math.round((hechos / total) * 100) : 0
        return (
          <Card key={c.id} className="p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-extrabold">📨 {c.nombre}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${e.cls}`}>{e.txt}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line2">
              <div className="h-full bg-orange" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] font-semibold text-muted">
              {c.enviados || 0} enviados · {c.fallidos || 0} fallidos · {total} en total
            </div>
          </Card>
        )
      })}
    </div>
  )
}

/** Elegir a quiénes y qué decirles. */
function FormCampania({ sedeId, aprobadas, onCerrar, onListo }) {
  const [nombre, setNombre] = useState('')
  const [plantilla, setPlantilla] = useState(aprobadas[0]?.nombre || '')
  const [segmento, setSegmento] = useState('vencidos')
  const [enviando, setEnviando] = useState(false)

  // Cuántos son, de verdad, en esta sede. Se pide al elegir el segmento para
  // que el dueño vea el número ANTES de lanzar, no después.
  const dest = useQuery({
    queryKey: ['camp-dest', sedeId, segmento],
    queryFn: () => pedir(`/api/leadia?action=destinatarios&segmento=${segmento}&sedeId=${sedeId}`),
  })

  const elegida = aprobadas.find((p) => p.nombre === plantilla)
  const cuantos = dest.data?.total ?? 0

  async function lanzar() {
    if (enviando) return
    setEnviando(true)
    try {
      const out = await pedir(`/api/leadia?action=campanias&op=crear&sedeId=${sedeId}`, {
        method: 'POST',
        body: JSON.stringify({
          sedeId, nombre, plantillaNombre: plantilla,
          cuerpoVista: elegida?.cuerpo,
          contactos: dest.data?.contactos || [],
        }),
      })
      toast.ok(`Campaña creada: ${out.total || cuantos} destinatarios. Los mensajes salen de a pocos para cuidar tu número.`)
      onListo()
    } catch (e) {
      toast.error(e.message)
    } finally { setEnviando(false) }
  }

  const puede = nombre.trim() && plantilla && cuantos > 0 && !enviando

  return (
    <Card className="mt-3 p-4">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <div className="text-[14px] font-extrabold">Escríbeles a tus socios</div>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">
            Eliges a quiénes y qué decirles. Los mensajes salen de a pocos para cuidar tu número.
          </p>
        </div>
        <button onClick={onCerrar} className="cursor-pointer border-none bg-transparent text-[16px] text-faint hover:text-ink">✕</button>
      </div>

      <label className="mt-3 block">
        <span className="text-[11.5px] font-extrabold text-muted">Nombre (solo para reconocerla)</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Promo setiembre — los que se fueron"
          className="mt-1 w-full rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold outline-none focus:border-orange" />
      </label>

      <div className="mt-3">
        <span className="text-[11.5px] font-extrabold text-muted">¿A quiénes?</span>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {SEGMENTOS.map((s) => (
            <button key={s.id} onClick={() => setSegmento(s.id)}
              className={`cursor-pointer rounded-[10px] border p-2.5 text-left transition-colors ${
                segmento === s.id ? 'border-orange bg-orange-50' : 'border-line bg-white hover:border-orange'}`}>
              <div className="text-[12.5px] font-extrabold">{s.label}</div>
              <div className="text-[11px] font-semibold text-muted">{s.ayuda}</div>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11.5px] font-semibold text-muted">
          {dest.isLoading ? 'Contando…'
            : cuantos > 0
              ? <><strong className="text-ink">{cuantos}</strong> socios con teléfono en esta sede.</>
              : 'No hay nadie con teléfono en este grupo.'}
        </p>
      </div>

      <label className="mt-3 block">
        <span className="text-[11.5px] font-extrabold text-muted">Mensaje (plantilla aprobada por Meta)</span>
        <select value={plantilla} onChange={(e) => setPlantilla(e.target.value)}
          className="mt-1 w-full rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold outline-none focus:border-orange">
          {aprobadas.map((p) => <option key={p.nombre} value={p.nombre}>{p.nombre}</option>)}
        </select>
      </label>

      {elegida?.cuerpo && (
        <div className="mt-2 whitespace-pre-wrap rounded-[10px] bg-line2/50 p-3 text-[12px] font-semibold leading-relaxed text-muted">
          {elegida.cuerpo}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
        <span className="text-[11px] font-semibold text-faint">
          {cuantos > 0 && `Se enviará a ${cuantos} personas. Meta te cobrará por cada mensaje.`}
        </span>
        <button onClick={lanzar} disabled={!puede}
          className="shrink-0 cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
          {enviando ? 'Creando…' : 'Lanzar campaña'}
        </button>
      </div>
    </Card>
  )
}

/** Las plantillas: se crean acá, las aprueba Meta. */
function Plantillas({ sedeId, plantillas, cargando, error, onCambio }) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState('MARKETING')
  const [cuerpo, setCuerpo] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function crear() {
    if (guardando) return
    setGuardando(true)
    try {
      await pedir(`/api/leadia?action=campanias&op=crear-plantilla&sedeId=${sedeId}`, {
        method: 'POST',
        body: JSON.stringify({ sedeId, nombre, categoria, cuerpo }),
      })
      toast.ok('Plantilla enviada a Meta. La revisión toma minutos u horas.')
      setNombre(''); setCuerpo(''); setAbierto(false); onCambio()
    } catch (e) {
      toast.error(e.message)
    } finally { setGuardando(false) }
  }

  return (
    <div className="mt-3">
      {!abierto && (
        <button onClick={() => setAbierto(true)}
          className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange">
          + Nueva plantilla
        </button>
      )}

      {abierto && (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
            <div>
              <div className="text-[14px] font-extrabold">Nueva plantilla</div>
              {/* Que Meta la revisa se dice ACÁ, no después de que la mande: si
                  alguien escribe pensando enviar en 5 minutos, se lleva un chasco. */}
              <p className="mt-0.5 text-[12px] font-semibold leading-relaxed text-muted">
                Meta revisa cada mensaje antes de dejarte enviarlo (minutos u horas).
                Escribe <code className="font-mono">{'{{1}}'}</code> donde quieras el nombre del socio.
              </p>
            </div>
            <button onClick={() => setAbierto(false)} className="cursor-pointer border-none bg-transparent text-[16px] text-faint hover:text-ink">✕</button>
          </div>

          <label className="mt-3 block">
            <span className="text-[11.5px] font-extrabold text-muted">Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: promo setiembre"
              className="mt-1 w-full rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold outline-none focus:border-orange" />
            <span className="mt-1 block text-[11px] font-semibold text-faint">
              Se guarda en minúsculas con guiones bajos (regla de Meta).
            </span>
          </label>

          <div className="mt-3">
            <span className="text-[11.5px] font-extrabold text-muted">Tipo</span>
            <div className="mt-1.5 flex gap-1.5">
              {[['MARKETING', 'Promoción'], ['UTILITY', 'Aviso o recordatorio']].map(([v, txt]) => (
                <button key={v} onClick={() => setCategoria(v)}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-extrabold transition-colors ${
                    categoria === v ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted'}`}>
                  {txt}
                </button>
              ))}
            </div>
          </div>

          <label className="mt-3 block">
            <span className="text-[11.5px] font-extrabold text-muted">Mensaje</span>
            <textarea value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} rows={4}
              placeholder={'Hola {{1}} 👋 Te extrañamos en el gym. Este mes tenemos 2x1 en la mensualidad — responde este mensaje y te cuento.'}
              className="mt-1 w-full resize-none rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold outline-none focus:border-orange" />
          </label>

          <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
            <button onClick={() => setAbierto(false)}
              className="cursor-pointer border-none bg-transparent px-3 py-2 text-[12px] font-extrabold text-muted">Cancelar</button>
            <button onClick={crear} disabled={!nombre.trim() || cuerpo.trim().length < 10 || guardando}
              className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
              {guardando ? 'Enviando…' : 'Enviar a revisión de Meta'}
            </button>
          </div>
        </Card>
      )}

      {cargando && <p className="mt-3 text-[13px] font-semibold text-faint">Cargando…</p>}

      {error && (
        <Card className="mt-3 p-4 text-[12.5px] font-semibold text-orange">{error.message}</Card>
      )}

      {!cargando && !error && plantillas.length === 0 && !abierto && (
        <Card className="mt-3 p-8 text-center">
          <div className="text-[14px] font-extrabold">Sin plantillas todavía</div>
          <p className="mt-1 text-[12.5px] font-semibold text-muted">
            Las campañas usan mensajes que Meta aprueba antes. Crea el primero.
          </p>
        </Card>
      )}

      {plantillas.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {plantillas.map((p) => {
            const e = ESTADO_PLANTILLA[p.estado] || { txt: p.estado, cls: 'bg-line2 text-faint' }
            return (
              <Card key={p.nombre} className="p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-extrabold">{p.nombre}</div>
                    <div className="text-[11px] font-semibold text-faint">
                      {p.categoria === 'UTILITY' ? 'Aviso o recordatorio' : 'Promoción'}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${e.cls}`}>{e.txt}</span>
                </div>
                {p.cuerpo && (
                  <p className="mt-2 whitespace-pre-wrap text-[12px] font-semibold leading-relaxed text-muted">{p.cuerpo}</p>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
