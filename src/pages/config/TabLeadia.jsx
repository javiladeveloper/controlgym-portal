import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui.jsx'
import ConectarRedes from './ConectarRedes.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { money } from '../../lib/uiHelpers.js'
import { toast } from '../../lib/toast.js'

// Tiers del add-on de IA (espejo de precio_leadia / conversaciones_leadia en BD).
const TIERS = [
  { key: 'basica', nombre: 'IA Básica', precio: 39, conv: 400 },
  { key: 'pro', nombre: 'IA Pro', precio: 69, conv: 800, popular: true },
  { key: 'full', nombre: 'IA Full', precio: 119, conv: 1600 },
]

// Etiquetas legibles de los tipos de nodo del árbol (formato de Leadia).
const TIPO_NODO = {
  inicio: 'Inicio', mensaje: 'Mensaje', opciones: 'Menú de opciones',
  fija: 'Respuesta fija', ia: '🤖 Responde la IA', pedir_dato: 'Pedir dato',
  escalar: 'Pasar a un humano', condicion: 'Condición', accion: 'Acción',
}

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  return { authorization: `Bearer ${data?.session?.access_token || ''}`, 'content-type': 'application/json' }
}

export default function TabLeadia() {
  const { empresa } = useAuth()
  const qc = useQueryClient()
  const [activando, setActivando] = useState(null) // sede_id en curso
  const [editorSede, setEditorSede] = useState(null) // sede cuyo árbol se edita

  // Estado del add-on por sede (misma RPC que la card de Mi plan, ya trae leadia_*)
  const sedes = useQuery({
    queryKey: ['suscripciones-mis-sedes-leadia'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suscripciones_mis_sedes')
      if (error) throw error
      return data
    },
  })

  async function activar(sedeId, tier) {
    setActivando(sedeId)
    try {
      const res = await fetch('/api/leadia?action=aprovisionar', {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ sedeId, tier }),
      })
      const out = await res.json()
      if (!res.ok || !out.ok) throw new Error(out.error || 'No se pudo activar')
      toast.ok('¡IA activada para esta sede! Ya puedes ajustar su flujo.')
      qc.invalidateQueries({ queryKey: ['suscripciones-mis-sedes-leadia'] })
    } catch (e) {
      toast.error(e.message)
    } finally { setActivando(null) }
  }

  const lista = sedes.data || []

  if (editorSede) {
    return <EditorArbol sede={editorSede} onVolver={() => setEditorSede(null)} />
  }

  return (
    <div className="max-w-[760px]">
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🤖 IA Leadia — vendedor con inteligencia artificial</div>
        <p className="mt-1 text-[13px] font-semibold leading-relaxed text-muted">
          Un asistente que atiende el WhatsApp de tu gimnasio 24/7: responde al instante, califica a cada
          interesado y te avisa a quién seguir. Los interesados listos para inscribirse entran solos a tu CRM.
          Se cobra como add-on por sede, además de tu plan.
        </p>
      </Card>

      {sedes.isLoading && <p className="mt-4 text-[13px] font-semibold text-faint">Cargando…</p>}

      {lista.map((s) => {
        const activo = !!s.leadia_tier
        const tier = TIERS.find((t) => t.key === s.leadia_tier)
        return (
          <Card key={s.sede_id} className="mt-4 p-[19px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[14px] font-extrabold">{s.sede_nombre}</div>
                {activo
                  ? <div className="mt-0.5 text-[12px] font-semibold text-green-600">✓ {tier?.nombre} activa · {money(s.leadia_monto)}/mes · {tier?.conv} conversaciones/mes</div>
                  : <div className="mt-0.5 text-[12px] font-semibold text-muted">Sin IA. Elige un plan para activarla en esta sede.</div>}
              </div>
              {activo && (
                <button onClick={() => setEditorSede(s)}
                  className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2 text-[12.5px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange">
                  🌳 Ajustar el flujo del bot
                </button>
              )}
            </div>

            {!activo && (
              <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                {TIERS.map((t) => (
                  <div key={t.key} className={`rounded-[12px] border p-3.5 ${t.popular ? 'border-orange' : 'border-line'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-extrabold">{t.nombre}</span>
                      {t.popular && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-extrabold text-orange">Recomendado</span>}
                    </div>
                    <div className="mt-1 text-[18px] font-extrabold tabular-nums">{money(t.precio)}<span className="text-[11px] font-semibold text-faint">/mes</span></div>
                    <div className="mt-0.5 text-[11.5px] font-semibold text-muted">{t.conv} conversaciones/mes</div>
                    <button onClick={() => activar(s.sede_id, t.key)} disabled={activando === s.sede_id}
                      className="mt-2.5 w-full cursor-pointer rounded-[9px] border-none bg-orange py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                      {activando === s.sede_id ? 'Activando…' : 'Activar'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Las redes por donde Finny atiende. Sin al menos una conectada el
                bot existe pero no puede recibir un solo mensaje: hasta hoy el
                panel prometía "atiende tu WhatsApp" sin dar dónde conectarlo. */}
            {activo && (
              <div className="mt-4 border-t border-line pt-4">
                <ConectarRedes sedeId={s.sede_id} sedeNombre={s.sede_nombre} />
              </div>
            )}
          </Card>
        )
      })}

      {!sedes.isLoading && lista.length === 0 && (
        <Card className="mt-4 p-6 text-center text-[13px] font-semibold text-muted">No hay sedes activas.</Card>
      )}
    </div>
  )
}

// ── Editor del árbol (acotado): edita los textos de los nodos y guarda ──────
function EditorArbol({ sede, onVolver }) {
  const estado = useQuery({
    queryKey: ['leadia-flujo', sede.sede_id],
    queryFn: async () => {
      const res = await fetch(`/api/leadia?action=estado&sedeId=${sede.sede_id}`, { headers: await authHeader() })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error || 'No se pudo cargar el flujo')
      return out
    },
  })
  const flujo = (estado.data?.flujos || [])[0] || null
  const [grafo, setGrafo] = useState(null)
  const [busy, setBusy] = useState(false)

  // inicializar el grafo editable una vez cargado
  if (flujo?.grafo && grafo === null) setGrafo(flujo.grafo)

  function editarNodo(id, campo, valor) {
    setGrafo((g) => ({
      ...g,
      nodos: g.nodos.map((n) => n.id === id ? { ...n, datos: { ...n.datos, [campo]: valor } } : n),
    }))
  }

  async function guardar() {
    setBusy(true)
    try {
      const res = await fetch('/api/leadia?action=guardar-flujo', {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ sedeId: sede.sede_id, flujoId: flujo.id, grafo }),
      })
      const out = await res.json()
      if (!res.ok || !out.ok) throw new Error(out.error || 'No se pudo guardar')
      toast.ok('Flujo guardado — el bot ya responde con estos textos.')
    } catch (e) {
      toast.error(e.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-[720px]">
      <button onClick={onVolver} className="mb-3 cursor-pointer border-none bg-transparent p-0 text-[12.5px] font-extrabold text-muted hover:text-orange">← Volver</button>
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🌳 Flujo del bot · {sede.sede_nombre}</div>
        <p className="mt-1 text-[12.5px] font-semibold text-muted">
          Ajusta los textos con los que el bot atiende. El paso <b>🤖 Responde la IA</b> es donde la inteligencia
          artificial conversa libre; los demás son mensajes/menús fijos que puedes personalizar.
        </p>

        {estado.isLoading && <p className="mt-4 text-[13px] font-semibold text-faint">Cargando el flujo…</p>}
        {estado.isError && <p className="mt-4 text-[13px] font-bold text-red">No se pudo cargar: {estado.error.message}</p>}
        {estado.data && !flujo && <p className="mt-4 text-[13px] font-semibold text-muted">Esta sede aún no tiene un flujo. Se creó al activar la IA — recarga en un momento.</p>}

        {grafo && (
          <div className="mt-4 flex flex-col gap-3">
            {grafo.nodos.filter((n) => n.tipo !== 'inicio').map((n) => (
              <div key={n.id} className="rounded-[10px] border border-line p-3.5">
                <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">{TIPO_NODO[n.tipo] || n.tipo}</div>
                {n.tipo === 'ia' ? (
                  <textarea rows={2} value={n.datos.instruccion || ''} onChange={(e) => editarNodo(n.id, 'instruccion', e.target.value)}
                    className="w-full resize-none rounded-[8px] border border-line bg-[#FAFBFC] px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange focus:bg-white"
                    placeholder="Instrucción para la IA (cómo debe responder)…" />
                ) : n.tipo === 'opciones' ? (
                  <input value={(n.datos.opciones || []).join(' · ')} onChange={(e) => editarNodo(n.id, 'opciones', e.target.value.split('·').map((x) => x.trim()).filter(Boolean))}
                    className="w-full rounded-[8px] border border-line bg-white px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange"
                    placeholder="Opción 1 · Opción 2 · Opción 3" />
                ) : n.tipo === 'escalar' ? (
                  <input value={n.datos.motivo || ''} onChange={(e) => editarNodo(n.id, 'motivo', e.target.value)}
                    className="w-full rounded-[8px] border border-line bg-white px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange"
                    placeholder="Motivo por el que se pasa a un humano" />
                ) : (
                  <textarea rows={2} value={n.datos.texto || ''} onChange={(e) => editarNodo(n.id, 'texto', e.target.value)}
                    className="w-full resize-none rounded-[8px] border border-line bg-white px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange"
                    placeholder="Texto del mensaje…" />
                )}
              </div>
            ))}
            <div className="flex justify-end">
              <button onClick={guardar} disabled={busy}
                className="cursor-pointer rounded-[10px] border-none bg-orange px-5 py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                {busy ? 'Guardando…' : 'Guardar flujo'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
