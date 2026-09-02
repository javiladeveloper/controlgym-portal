import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/ui.jsx'
import { usePanel } from '../store.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { toast } from '../lib/toast.js'

/**
 * LA BANDEJA DE FINNY (2026-09-02).
 *
 * Finny quedó atendiendo el WhatsApp del gimnasio y el gym no tenía dónde ver
 * esas conversaciones. Un bot que le habla a tus clientes sin que puedas leer
 * lo que dice —ni meter mano cuando hace falta— es una caja negra: el dueño se
 * entera del problema cuando ya perdió la venta.
 *
 * Tres cosas, nada más:
 *  1. la lista de conversaciones, la más reciente arriba,
 *  2. el hilo completo de una,
 *  3. responder a mano — y al hacerlo el bot se calla en ESA conversación,
 *     para que la IA no pise a la persona a mitad de frase.
 *
 * La api key del tenant no baja acá: todo pasa por /api/leadia?action=bandeja.
 */

// Cómo se ve cada nivel de interés que calculó la IA.
const NIVEL = {
  caliente: { txt: '🔥 Caliente', cls: 'bg-red-50 text-red' },
  tibio: { txt: 'Tibio', cls: 'bg-orange-50 text-orange' },
  frio: { txt: 'Frío', cls: 'bg-line2 text-faint' },
}

const CANAL = { whatsapp: '💬', instagram: '📸', messenger: '💬', tiktok: '🎵', externo: '📇' }

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  return {
    authorization: `Bearer ${data?.session?.access_token || ''}`,
    'content-type': 'application/json',
  }
}

function cuando(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  if (min < 1440) return `hace ${Math.floor(min / 60)} h`
  return d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })
}

export default function Bandeja() {
  const { sedeId } = usePanel()
  const qc = useQueryClient()
  const [abierta, setAbierta] = useState(null) // id del lead abierto
  const [filtro, setFiltro] = useState('')     // '' | frio | tibio | caliente

  const lista = useQuery({
    queryKey: ['bandeja', sedeId, filtro],
    enabled: !!sedeId,
    // La conversación es cosa viva: si alguien escribe mientras el gym mira la
    // pantalla, tiene que aparecer sin que nadie recargue.
    refetchInterval: 20000,
    queryFn: async () => {
      const q = new URLSearchParams({ sedeId, op: 'listar' })
      if (filtro) q.set('nivel', filtro)
      const r = await fetch(`/api/leadia?action=bandeja&${q}`, { headers: await authHeader() })
      const out = await r.json()
      if (!r.ok) throw new Error(out.error || 'No se pudo cargar la bandeja')
      return out
    },
  })

  if (!sedeId) {
    return <Card className="p-6 text-[13px] font-semibold text-muted">Elige una sede para ver sus conversaciones.</Card>
  }

  const datos = lista.data
  const items = datos?.items || []

  // Sin add-on no hay bandeja que mostrar. Se explica, no se deja en blanco.
  if (datos && datos.activo === false) {
    return (
      <Card className="p-6">
        <div className="text-[14px] font-extrabold">Finny todavía no está activo en esta sede</div>
        <p className="mt-1 text-[13px] font-semibold leading-relaxed text-muted">
          Actívalo en Configuración › Finny y conecta al menos una red. Desde ahí
          atiende a tus interesados, y sus conversaciones aparecen acá.
        </p>
      </Card>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-extrabold">Conversaciones</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">
            Lo que Finny está hablando con tus interesados. Puedes responder tú
            cuando haga falta.
          </p>
        </div>
        <div className="flex gap-1.5">
          {[['', 'Todas'], ['caliente', '🔥 Calientes'], ['tibio', 'Tibios'], ['frio', 'Fríos']].map(([v, txt]) => (
            <button key={v} onClick={() => setFiltro(v)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition-colors ${
                filtro === v ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
              {txt}
            </button>
          ))}
        </div>
      </div>

      {lista.isLoading && <p className="mt-4 text-[13px] font-semibold text-faint">Cargando…</p>}
      {lista.isError && (
        <Card className="mt-4 p-5 text-[13px] font-bold text-red">{lista.error.message}</Card>
      )}

      {!lista.isLoading && !lista.isError && items.length === 0 && (
        <Card className="mt-4 p-8 text-center">
          <div className="text-[14px] font-extrabold">Todavía no hay conversaciones</div>
          <p className="mt-1 text-[13px] font-semibold text-muted">
            En cuanto alguien le escriba a tu WhatsApp, la charla aparece acá.
          </p>
        </Card>
      )}

      {items.length > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <Card className="overflow-hidden p-0">
            <div className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {items.map((l) => {
                const n = NIVEL[l.nivelInteres] || NIVEL.frio
                const sel = abierta === l.id
                return (
                  <button key={l.id} onClick={() => setAbierta(l.id)}
                    className={`block w-full cursor-pointer border-none px-4 py-3 text-left transition-colors ${
                      sel ? 'bg-orange-50' : 'bg-white hover:bg-line2/50'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-extrabold">
                        {CANAL[l.canalOrigen] || '💬'} {l.nombre || l.contactoExterno}
                      </span>
                      <span className="shrink-0 text-[10.5px] font-semibold text-faint">{cuando(l.actualizadoEn)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-extrabold ${n.cls}`}>{n.txt}</span>
                      {l.resumenIA && (
                        <span className="truncate text-[11px] font-semibold text-muted">{l.resumenIA}</span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          {abierta
            ? <Hilo key={abierta} sedeId={sedeId} leadId={abierta} alResponder={() => {
                qc.invalidateQueries({ queryKey: ['bandeja', sedeId] })
              }} />
            : (
              <Card className="flex items-center justify-center p-10 text-[13px] font-semibold text-faint">
                Elige una conversación para leerla.
              </Card>
            )}
        </div>
      )}
    </div>
  )
}

/** El hilo abierto: mensajes + caja para responder. */
function Hilo({ sedeId, leadId, alResponder }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const finRef = useRef(null)

  const hilo = useQuery({
    queryKey: ['bandeja-hilo', sedeId, leadId],
    refetchInterval: 15000,
    queryFn: async () => {
      const r = await fetch(`/api/leadia?action=bandeja&op=hilo&id=${leadId}&sedeId=${sedeId}`,
        { headers: await authHeader() })
      const out = await r.json()
      if (!r.ok) throw new Error(out.error || 'No se pudo cargar la conversación')
      return out
    },
  })

  const mensajes = hilo.data?.mensajes || []

  // Al abrir y al llegar algo nuevo, se baja al último mensaje: leer una charla
  // empezando por arriba obliga a hacer scroll cada vez.
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'end' })
  }, [mensajes.length])

  const enviar = useCallback(async () => {
    const msg = texto.trim()
    if (!msg || enviando) return
    setEnviando(true)
    try {
      const r = await fetch(`/api/leadia?action=bandeja&op=responder&sedeId=${sedeId}`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ sedeId, sujeto: hilo.data?.contactoExterno, mensaje: msg }),
      })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(out.error || 'No se pudo enviar')
      setTexto('')
      await hilo.refetch()
      alResponder?.()
      toast.ok('Enviado. Finny queda en pausa en esta conversación.')
    } catch (e) {
      toast.error(e.message)
    } finally { setEnviando(false) }
  }, [texto, enviando, sedeId, hilo, alResponder])

  if (hilo.isLoading) {
    return <Card className="p-6 text-[13px] font-semibold text-faint">Cargando la conversación…</Card>
  }
  if (hilo.isError) {
    return <Card className="p-6 text-[13px] font-bold text-red">{hilo.error.message}</Card>
  }

  const lead = hilo.data

  return (
    <Card className="flex max-h-[70vh] flex-col overflow-hidden p-0">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[14px] font-extrabold">
          {CANAL[lead.canalOrigen] || '💬'} {lead.nombre || lead.contactoExterno}
        </div>
        {lead.resumenIA && (
          <p className="mt-0.5 text-[11.5px] font-semibold leading-relaxed text-muted">{lead.resumenIA}</p>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {mensajes.length === 0 && (
          <p className="text-[12.5px] font-semibold text-faint">Todavía no hay mensajes en esta conversación.</p>
        )}
        {mensajes.map((m) => {
          const mio = m.direccion !== 'entrante'
          return (
            <div key={m.id} className={`flex ${mio ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[78%] rounded-[12px] px-3 py-2 ${
                mio ? 'bg-orange-50' : 'bg-line2'}`}>
                <p className="whitespace-pre-wrap text-[12.5px] font-semibold leading-relaxed">{m.contenido}</p>
                <div className="mt-1 text-[10px] font-semibold text-faint">
                  {/* De quién salió: distinguir la IA de una persona importa —
                      el gym quiere saber qué dijo su bot y qué dijo su gente. */}
                  {m.direccion === 'entrante' ? 'Cliente'
                    : m.origen === 'humano' ? 'Tú'
                    : m.origen === 'fija' ? 'Respuesta fija'
                    : 'Finny'} · {cuando(m.creadoEn)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={finRef} />
      </div>

      <div className="border-t border-line p-3">
        <textarea
          value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
          rows={2} placeholder="Escribe tu respuesta… (Enter para enviar)"
          className="w-full resize-none rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold outline-none focus:border-orange" />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10.5px] font-semibold text-faint">
            Al responder tú, Finny deja de contestar en esta conversación.
          </span>
          <button onClick={enviar} disabled={!texto.trim() || enviando}
            className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </Card>
  )
}
