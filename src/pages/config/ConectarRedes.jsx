import { useEffect, useRef, useState, useCallback } from 'react'
import { Card } from '../../components/ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { toast } from '../../lib/toast.js'

/**
 * CONECTAR LAS REDES DEL GIMNASIO A FINNY (2026-09-02).
 *
 * Finny estaba construido y desplegado pero no podía atender a nadie: el panel
 * prometía "un asistente que atiende tu WhatsApp 24/7" y no había un solo botón
 * para conectarlo. El motor ya exponía todo (OAuth, Embedded Signup, elección de
 * cuenta); lo que faltaba era esta pantalla.
 *
 * La api key del tenant NUNCA baja acá: todo pasa por /api/leadia?action=canales,
 * que valida que seas admin de la sede y descifra la key en el servidor.
 *
 * Los tres tropiezos de Meta que este componente ya trae resueltos (heredados
 * del panel de LeadAI, donde costaron sangre) están comentados abajo en su sitio:
 * la ref del wabaId, la acumulación de eventos parciales y el redirect_uri.
 */

// v23 y no v21: el flujo v2 del Embedded Signup se DEPRECIA el 15 de octubre de
// 2026 y las versiones viejas del SDK lo arrastran. El panel de LeadAI todavía
// está en v21; Sania ya migró. Nacemos en la versión que sobrevive.
const SDK_VERSION = 'v23.0'

const APP_ID = import.meta.env.VITE_META_APP_ID || ''
const CONFIG_ID = import.meta.env.VITE_META_ES_CONFIG_ID || ''

// Las redes que el motor sabe conectar. `metodo` decide qué flujo se usa:
// whatsapp va por el popup del SDK de Meta, el resto por OAuth con redirect.
const REDES = [
  { tipo: 'whatsapp', nombre: 'WhatsApp', icono: '💬', metodo: 'whatsapp',
    detalle: 'El canal que de verdad vende en Perú. Finny responde al instante, califica y agenda.' },
  { tipo: 'instagram', nombre: 'Instagram', icono: '📸', metodo: 'oauth',
    detalle: 'Los DM de tu cuenta de empresa. Mucha consulta de gimnasio llega por acá.' },
  { tipo: 'messenger', nombre: 'Messenger', icono: '💬', metodo: 'oauth',
    detalle: 'Los mensajes de tu página de Facebook.' },
  { tipo: 'tiktok', nombre: 'TikTok', icono: '🎵', metodo: 'oauth',
    detalle: 'Solo publicación: TikTok no deja que sus mensajes directos lleguen al panel.' },
]

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  return {
    authorization: `Bearer ${data?.session?.access_token || ''}`,
    'content-type': 'application/json',
  }
}

// Solo mensajes que vengan de Facebook de verdad. Se compara el HOSTNAME
// parseado, no `includes('facebook.com')`: eso dejaría pasar facebook.com.evil.io.
function origenConfiable(origen) {
  try {
    const h = new URL(origen).hostname
    return h === 'facebook.com' || h.endsWith('.facebook.com')
  } catch { return false }
}

export default function ConectarRedes({ sedeId, sedeNombre }) {
  const [canales, setCanales] = useState([])
  const [cargando, setCargando] = useState(true)
  const [activo, setActivo] = useState(true)
  // null = no se pudo leer; no se afirma nada en pantalla.
  const [botActivo, setBotActivo] = useState(null)
  const [ocupado, setOcupado] = useState('')
  const [pendientes, setPendientes] = useState({ tipo: null, cuentas: [] })

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (!sedeId) return []
    try {
      const r = await fetch(`/api/leadia?action=canales&op=listar&sedeId=${sedeId}`,
        { headers: await authHeader() })
      const out = await r.json()
      if (!r.ok) throw new Error(out.error || 'No se pudo leer los canales')
      setActivo(out.activo !== false)
      setBotActivo(out.botActivo ?? null)
      const lista = Array.isArray(out.canales) ? out.canales : []
      setCanales(lista)
      return lista
    } catch (e) {
      // El sondeo de fondo no molesta con toasts: si falla una vuelta, se
      // reintenta en la siguiente sin que el usuario vea nada.
      if (!silencioso) toast.error(e.message)
      return []
    } finally { setCargando(false) }
  }, [sedeId])

  useEffect(() => { setCargando(true); cargar() }, [cargar])

  // Tras autorizar en Meta puede que haya varias páginas y ninguna guardada:
  // el motor las deja 10 minutos esperando a que el dueño elija.
  const revisarPendientes = useCallback(async (tipo) => {
    try {
      const r = await fetch(`/api/leadia?action=canales&op=pendientes&tipo=${tipo}&sedeId=${sedeId}`,
        { headers: await authHeader() })
      const out = await r.json()
      if (out?.cuentas?.length) setPendientes({ tipo, cuentas: out.cuentas })
    } catch { /* sin pendientes es el caso normal */ }
  }, [sedeId])

  async function elegirCuenta(tipo, cuentaExterna) {
    setOcupado(cuentaExterna)
    try {
      const r = await fetch(`/api/leadia?action=canales&op=elegir&sedeId=${sedeId}`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ tipo, cuentaExterna, sedeId }),
      })
      const out = await r.json()
      // 410 = se venció el plazo para elegir; hay que volver a autorizar.
      if (r.status === 410) throw new Error(out.error || 'Se venció el tiempo. Vuelve a conectar la red.')
      if (!r.ok) throw new Error(out.error || 'No se pudo conectar')
      setPendientes({ tipo: null, cuentas: [] })
      toast.ok('Cuenta conectada.')
      await cargar()
    } catch (e) {
      toast.error(e.message)
    } finally { setOcupado('') }
  }

  async function conectarOAuth(tipo) {
    setOcupado(tipo)
    try {
      const r = await fetch(`/api/leadia?action=canales&op=oauth-url&tipo=${tipo}&sedeId=${sedeId}`,
        { headers: await authHeader() })
      const out = await r.json()
      if (!r.ok || !out.url) throw new Error(out.error || 'No se pudo iniciar la conexión')
      // A propósito SIN noopener: el popup necesita window.opener para avisarnos
      // por postMessage cuando termina. Si el navegador lo bloquea, va a pestaña.
      const w = 600, h = 700
      const x = window.screenX + (window.outerWidth - w) / 2
      const y = window.screenY + (window.outerHeight - h) / 2
      const popup = window.open(out.url, 'oauth-red', `width=${w},height=${h},left=${x},top=${y}`)
      if (!popup) window.open(out.url, '_blank')
      // No se espera al postMessage: si el navegador lo bloquea, o el usuario
      // termina en otra pestaña, la pantalla se entera igual.
      sondear(tipo)
    } catch (e) {
      toast.error(e.message)
    } finally { setOcupado('') }
  }

  // El popup avisa por postMessage al terminar el OAuth.
  //
  // Se valida el ORIGEN: sin eso, cualquier iframe de terceros en el panel podría
  // mandar {tipo:'canal-oauth'} en bucle y cada mensaje dispararía 4 llamadas al
  // backend — y cada una descifra la api key (pgp_sym_decrypt) y pega al motor.
  // Es un amplificador de carga gratis contra nuestra propia infraestructura.
  //
  // El mensaje lo emite la página de callback del MOTOR (no Facebook), así que
  // el origen confiable es el de la API de LeadAI, que se resuelve al vuelo. Si
  // no se puede determinar, se cae a permitir solo nuestro propio origen.
  useEffect(() => {
    let vivo = true
    let origenMotor = ''
    // Se pregunta una vez cuál es la base del motor para saber a quién creerle.
    ;(async () => {
      try {
        const r = await fetch(`/api/leadia?action=canales&op=origen&sedeId=${sedeId}`,
          { headers: await authHeader() })
        const out = await r.json()
        if (vivo && out?.origen) origenMotor = out.origen
      } catch { /* sin dato: solo se confía en el propio origen */ }
    })()

    function alMensaje(e) {
      const confiable = e.origin === window.location.origin
        || (origenMotor && e.origin === origenMotor)
      if (!confiable) return
      const d = e.data
      if (d && d.tipo === 'canal-oauth') {
        cargar()
        REDES.filter((r) => r.metodo === 'oauth').forEach((r) => revisarPendientes(r.tipo))
      }
    }
    window.addEventListener('message', alMensaje)
    return () => { vivo = false; window.removeEventListener('message', alMensaje) }
  }, [cargar, revisarPendientes, sedeId])

  /**
   * EL ESTADO TIENE QUE SER REACTIVO (2026-09-02, reportado por el owner).
   *
   * Conectó su WhatsApp de verdad —el motor lo registró— y la pantalla siguió
   * diciendo "Sin conectar" hasta recargar a mano.
   *
   * La causa: el refresco colgaba del callback de FB.login, y el asistente de
   * WhatsApp corre en SU PROPIA ventana; muchas veces termina sin devolverle el
   * control al SDK, así que ese callback no llega nunca. Lo mismo con el OAuth
   * de Instagram si el navegador bloquea el postMessage del popup.
   *
   * Ahora la pantalla no espera a que le avisen: mientras hay una conexión en
   * curso se pregunta sola cada 3s si ya apareció el canal. En cuanto lo ve, se
   * pinta y deja de preguntar. El aviso por postMessage sigue existiendo — llega
   * antes cuando funciona — pero ya no es la única vía.
   */
  const sondear = useCallback((tipoEsperado) => {
    let vueltas = 0
    const id = setInterval(async () => {
      vueltas += 1
      const lista = await cargar({ silencioso: true })
      const llego = lista.some((c) => c.tipo === tipoEsperado)
      // 60 vueltas × 3s = 3 min, de sobra para un onboarding de WhatsApp.
      if (llego || vueltas >= 60) {
        clearInterval(id)
        // No hace falta liberar el botón: al llegar el canal, la tarjeta pasa a
        // mostrar la cuenta conectada y el bloque de conectar desaparece entero.
        if (llego) toast.ok('¡Conectado! Finny ya puede atender por ahí.')
      }
    }, 3000)
    return id
  }, [cargar])

  async function refrescarPlaybook() {
    setOcupado('playbook')
    try {
      const r = await fetch(`/api/leadia?action=canales&op=playbook&sedeId=${sedeId}`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ sedeId }),
      })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(out.error || 'No se pudo actualizar')
      toast.ok(`Listo: Finny ya conoce tus ${out.planes} planes con sus precios de hoy.`)
    } catch (e) {
      toast.error(e.message)
    } finally { setOcupado('') }
  }

  async function cambiarBot() {
    setOcupado('bot')
    try {
      const r = await fetch(`/api/leadia?action=canales&op=encender&sedeId=${sedeId}`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ sedeId, activo: !botActivo }),
      })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(out.error || 'No se pudo cambiar')
      setBotActivo(out.activo)
      toast.ok(out.activo
        ? '¡Finny encendido! Ya responde por las redes conectadas.'
        : 'Finny apagado. Los mensajes siguen llegando a Conversaciones.')
    } catch (e) {
      toast.error(e.message)
    } finally { setOcupado('') }
  }

  async function cambiarActivo(canal) {
    setOcupado(canal.id)
    try {
      const r = await fetch(`/api/leadia?action=canales&op=actualizar&sedeId=${sedeId}`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ id: canal.id, activo: !canal.activo, sedeId }),
      })
      // Se lee el cuerpo: el proxy reenvía el error del motor y decir solo "no se
      // pudo cambiar" deja al gym sin saber si fue su sesión, el add-on o Meta.
      const out = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(out.error || 'No se pudo cambiar')
      await cargar()
    } catch (e) {
      toast.error(e.message)
    } finally { setOcupado('') }
  }

  async function desconectar(canal) {
    const ok = window.confirm(
      `¿Desconectar ${canal.nombre || canal.cuentaExterna}?\n\n` +
      'Finny dejará de responder por ahí. Las conversaciones y los leads que ya ' +
      'entraron NO se borran.')
    if (!ok) return
    setOcupado(canal.id)
    try {
      const r = await fetch(`/api/leadia?action=canales&op=eliminar&sedeId=${sedeId}`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({ id: canal.id, sedeId }),
      })
      // Igual que arriba, y acá importa más: el usuario ya confirmó un diálogo
      // destructivo y merece saber por qué no pasó nada.
      const out = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(out.error || 'No se pudo desconectar')
      toast.ok('Canal desconectado.')
      await cargar()
    } catch (e) {
      toast.error(e.message)
    } finally { setOcupado('') }
  }

  // Mientras carga no se afirma nada: mismo criterio que el guion del contador.
  // Arrancar mostrando las redes y saltar a "activa Finny primero" (o al revés)
  // es un parpadeo que hace dudar de lo que se está viendo.
  if (cargando) {
    return <p className="text-[13px] font-semibold text-faint">Cargando las redes…</p>
  }

  if (!activo) {
    return (
      <p className="text-[13px] font-semibold text-muted">
        Primero activa Finny en <span className="font-extrabold">{sedeNombre}</span> y
        después conecta las redes por donde va a atender.
      </p>
    )
  }

  const porTipo = (tipo) => canales.filter((c) => c.tipo === tipo)
  const hayAlguna = canales.length > 0

  return (
    <div>
      {/* EL INTERRUPTOR DE FINNY.
          El bot nace APAGADO a propósito (al contratar el add-on todavía no hay
          número conectado, y un bot "encendido" sin canal es un estado
          mentiroso). Pero sin esta palanca en el panel, el gym conectaba su
          WhatsApp, veía llegar los mensajes... y Finny nunca contestaba, sin
          nada que explicara por qué. Pasó en vivo el 2026-09-02. */}
      {botActivo !== null && (
        <div className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border p-3.5 ${
          botActivo ? 'border-line bg-white' : 'border-orange bg-orange-50'}`}>
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold">
              {botActivo ? '✓ Finny está atendiendo' : 'Finny está apagado'}
            </div>
            <div className="mt-0.5 text-[11.5px] font-semibold leading-relaxed text-muted">
              {botActivo
                ? 'Responde solo a quien escriba por las redes conectadas.'
                : hayAlguna
                  ? 'Ya tienes una red conectada: enciéndelo para que empiece a responder.'
                  : 'Conecta una red y enciéndelo para que empiece a responder.'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* El bot aprende los planes y precios de UNA copia que se le
                manda. Si el gym sube un precio en el panel, Finny sigue
                diciendo el viejo hasta que se le vuelva a mandar. */}
            {botActivo && (
              <button onClick={refrescarPlaybook} disabled={ocupado === 'playbook'}
                title="Vuelve a mandarle a Finny tus planes y precios actuales"
                className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[12px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange disabled:opacity-50">
                {ocupado === 'playbook' ? 'Actualizando…' : 'Actualizar sus precios'}
              </button>
            )}
            <button onClick={cambiarBot} disabled={ocupado === 'bot'}
              className={`cursor-pointer rounded-[9px] border-none px-4 py-2 text-[12px] font-extrabold disabled:opacity-50 ${
                botActivo ? 'bg-line2 text-muted hover:bg-line' : 'bg-orange text-white hover:bg-orange-600'}`}>
              {ocupado === 'bot' ? 'Un momento…' : botActivo ? 'Apagar' : 'Encender a Finny'}
            </button>
          </div>
        </div>
      )}

      <div className="text-[14px] font-extrabold">Redes conectadas</div>
      <p className="mt-1 text-[12.5px] font-semibold leading-relaxed text-muted">
        Por acá le llegan los mensajes a Finny. Sin al menos una red conectada, el
        asistente no puede atender a nadie.
      </p>

      {/* Elegir cuenta cuando Meta devolvió varias páginas */}
      {pendientes.cuentas.length > 0 && (
        <div className="mt-3 rounded-[12px] border border-orange bg-orange-50 p-3.5">
          <div className="text-[12.5px] font-extrabold text-orange">
            Tienes {pendientes.cuentas.length} cuentas. ¿Cuál quieres conectar?
          </div>
          <div className="mt-2.5 space-y-2">
            {pendientes.cuentas.map((c) => (
              <div key={c.cuentaExterna}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-white px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-extrabold">{c.nombre || 'Cuenta'}</div>
                  <div className="truncate text-[11px] font-semibold text-faint">{c.cuentaExterna}</div>
                </div>
                <button
                  onClick={() => elegirCuenta(pendientes.tipo, c.cuentaExterna)}
                  disabled={!!ocupado}
                  className="shrink-0 cursor-pointer rounded-[9px] border-none bg-orange px-3.5 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                  {ocupado === c.cuentaExterna ? 'Conectando…' : 'Conectar esta'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* items-start: sin esto el grid estira cada tarjeta a la altura de la más
          alta (WhatsApp, que trae el bloque de opciones) y las otras quedan con
          un hueco vacío enorme debajo del botón. */}
      <div className="mt-3 grid items-start gap-2.5 sm:grid-cols-2">
        {REDES.map((red) => {
          const conectados = porTipo(red.tipo)
          const hayAlguno = conectados.length > 0
          return (
            <div key={red.tipo}
              className={`rounded-[12px] border p-3.5 ${hayAlguno ? 'border-orange' : 'border-line'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold">
                    <span className="mr-1.5">{red.icono}</span>{red.nombre}
                  </div>
                  <div className="mt-0.5 text-[11.5px] font-semibold leading-relaxed text-muted">
                    {red.detalle}
                  </div>
                </div>
                {/* Un guion no miente: mientras carga no se afirma "sin conectar",
                    que a alguien con su cuenta conectada le resultaría falso. */}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                  hayAlguno ? 'bg-orange-50 text-orange' : 'bg-line2 text-faint'}`}>
                  {cargando ? '—' : hayAlguno ? `${conectados.length} conectada(s)` : 'Sin conectar'}
                </span>
              </div>

              {hayAlguno && (
                <div className="mt-2.5 space-y-2">
                  {conectados.map((c) => (
                    <div key={c.id}
                      className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-extrabold">{c.nombre || c.cuentaExterna}</div>
                        <div className="truncate text-[11px] font-semibold text-faint">
                          {c.creadoEn ? `conectada el ${new Date(c.creadoEn).toLocaleDateString('es-PE')}` : c.cuentaExterna}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          onClick={() => cambiarActivo(c)} disabled={!!ocupado}
                          title={c.activo ? 'Finny responde por acá' : 'Finny no responde por acá'}
                          className={`cursor-pointer rounded-full border-none px-2.5 py-1 text-[10.5px] font-extrabold disabled:opacity-50 ${
                            c.activo ? 'bg-green-50 text-green-600' : 'bg-line2 text-faint'}`}>
                          {c.activo ? '● Activo' : '○ Apagado'}
                        </button>
                        <button
                          onClick={() => desconectar(c)} disabled={!!ocupado}
                          className="cursor-pointer rounded-[8px] border-none bg-transparent px-2 py-1 text-[11px] font-extrabold text-muted hover:text-red disabled:opacity-50">
                          Desconectar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!cargando && !hayAlguno && (
                <div className="mt-2.5">
                  {red.metodo === 'whatsapp'
                    ? <ConectarWhatsApp sedeId={sedeId} alConectar={cargar} alAbrir={() => sondear('whatsapp')} />
                    : (
                      <button
                        onClick={() => conectarOAuth(red.tipo)} disabled={!!ocupado}
                        className="w-full cursor-pointer rounded-[9px] border-none bg-orange py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                        {ocupado === red.tipo ? 'Abriendo…' : `Conectar ${red.nombre}`}
                      </button>
                    )}
                </div>
              )}

              {/* El texto se ajusta al número real de cuentas: afirmar "desconecta
                  la actual" con dos conectadas es sencillamente falso, y el motor
                  puede devolver más de una. */}
              {!cargando && conectados.length === 1 && (
                <div className="mt-2 text-[11px] font-semibold text-faint">
                  Para usar otra cuenta, primero desconecta la actual.
                </div>
              )}
              {!cargando && conectados.length > 1 && (
                <div className="mt-2 text-[11px] font-semibold text-faint">
                  Finny atiende por todas las que estén activas.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * WhatsApp por Embedded Signup de Meta.
 *
 * Portado del panel de LeadAI, donde estos tres detalles costaron depuración:
 *  1. wabaId/phoneNumberId en una REF, no en estado.
 *  2. Los eventos de Meta se acumulan campo por campo.
 *  3. Se captura el redirect_uri que genera el SDK.
 * Cada uno está comentado en su sitio.
 */
function ConectarWhatsApp({ sedeId, alConectar, alAbrir }) {
  const [estado, setEstado] = useState('listo')
  const [error, setError] = useState('')
  const [modo, setModo] = useState('coexistencia')
  const [enCelular, setEnCelular] = useState(false)

  /**
   * (1) Los datos del Embedded Signup en una REF, no en estado.
   * El callback de FB.login CIERRA SOBRE EL RENDER en que se creó: con useState
   * leía siempre el objeto vacío del primer render y el backend recibía el code
   * SIN wabaId. Síntoma: "No se pudo resolver la cuenta de WhatsApp (WABA) del
   * token (scopes: ninguno)".
   */
  const sesionES = useRef({})
  // (3) redirect_uri exacto con el que el SDK abrió el diálogo: Meta exige ese
  // MISMO valor al canjear el code (error 100 si no coincide). Ref por lo mismo.
  const redirectUriDialogo = useRef('')

  useEffect(() => {
    setEnCelular(/android|iphone|ipad|ipod/i.test(navigator.userAgent))
  }, [])

  useEffect(() => {
    if (window.FB || document.getElementById('fb-sdk')) return
    window.fbAsyncInit = () => {
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: true, version: SDK_VERSION })
    }
    const s = document.createElement('script')
    s.id = 'fb-sdk'
    s.src = 'https://connect.facebook.net/en_US/sdk.js'
    s.async = true
    s.defer = true
    s.onerror = () => {
      setEstado('error')
      setError('No se pudo cargar el conector de Meta. Revisa tu conexión y recarga.')
    }
    document.body.appendChild(s)

    const onMsg = (ev) => {
      if (!origenConfiable(ev.origin)) return
      try {
        const d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data
        if (d?.type === 'WA_EMBEDDED_SIGNUP' && d?.data) {
          // (2) Se ACUMULA campo por campo: Meta manda varios eventos durante el
          // flujo y los últimos pueden venir incompletos. Pisar el objeto entero
          // borraría el waba_id que ya había llegado.
          if (d.data.waba_id) sesionES.current.wabaId = d.data.waba_id
          if (d.data.phone_number_id) sesionES.current.phoneNumberId = d.data.phone_number_id
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  async function finalizarConexion(code, modoUsado) {
    try {
      const r = await fetch(`/api/leadia?action=canales&op=whatsapp-embedded&sedeId=${sedeId}`, {
        method: 'POST', headers: await authHeader(),
        body: JSON.stringify({
          sedeId, code,
          wabaId: sesionES.current.wabaId,
          phoneNumberId: sesionES.current.phoneNumberId,
          redirectUri: redirectUriDialogo.current || undefined,
          featureType: modoUsado === 'coexistencia' ? 'whatsapp_business_app_onboarding' : '',
        }),
      })
      const out = await r.json()
      if (!r.ok) throw new Error(out.error || 'No se pudo conectar el número')
      setEstado('listo')
      toast.ok('¡WhatsApp conectado! Finny ya puede atender por ahí.')
      alConectar?.()
    } catch (e) {
      setEstado('error')
      setError(e.message)
    }
  }

  function conectar() {
    if (!window.FB) {
      setEstado('error'); setError('El conector de Meta aún no cargó. Recarga la página.'); return
    }
    if (!APP_ID || !CONFIG_ID) {
      setEstado('error')
      setError('Falta configurar el conector de WhatsApp (VITE_META_APP_ID / VITE_META_ES_CONFIG_ID).')
      return
    }
    setEstado('abriendo'); setError('')
    // Se limpian AMBAS refs antes de abrir. El wabaId viejo conectaría la cuenta
    // equivocada; el redirect_uri viejo hace que Meta responda error 100 al
    // canjear el code — justo el bug que este componente dice tener resuelto.
    sesionES.current = {}
    redirectUriDialogo.current = ''
    // El asistente de WhatsApp corre en su propia ventana y a menudo termina sin
    // devolverle el control al SDK: sin esto el canal se conecta de verdad y la
    // pantalla se queda diciendo "Sin conectar" hasta recargar a mano.
    alAbrir?.()

    // (3) Capturar la URL del diálogo que abre el SDK para extraer su
    // redirect_uri (dinámico, apunta a xd_arbiter).
    const openOriginal = window.open.bind(window)
    let restaurado = false
    const restaurar = () => {
      if (restaurado) return
      restaurado = true
      window.open = openOriginal
    }
    window.open = (...args) => {
      const url = String(args[0] ?? '')
      if (url.includes('dialog/oauth')) {
        try {
          const ru = new URL(url).searchParams.get('redirect_uri')
          if (ru) redirectUriDialogo.current = ru
        } catch { /* ignore */ }
        restaurar()
      }
      return openOriginal(...args)
    }
    // Red de seguridad: si el SDK NUNCA abre un diálogo de oauth (popup
    // bloqueado, falla el config_id), el parche quedaría instalado para siempre
    // y cada intento añadiría una capa más encima de la anterior.
    setTimeout(restaurar, 30_000)

    // EL BOTÓN NO PUEDE QUEDARSE MUERTO (2026-09-02).
    //
    // FB.login solo llama a su callback si META responde (el usuario autorizó o
    // canceló DENTRO del diálogo). Si cierra la ventana con la X, o la deja
    // abierta y se va, no llega nada: el botón se queda en "Abriendo Meta…"
    // para siempre y hay que recargar la página para reintentar. Visto en vivo.
    //
    // Pasado el tiempo de un onboarding con calma, el botón se libera solo. Se
    // usa el updater de estado para no pisar un 'conectando' en curso: ese ya
    // tiene el code y su canje sigue aunque la ventana haya desaparecido.
    setTimeout(() => {
      setEstado((actual) => (actual === 'abriendo' ? 'listo' : actual))
    }, 180_000)

    // OJO: el SDK de Facebook NO acepta un callback async ("Expression is of
    // type asyncfunction, not function"). El trabajo async va aparte.
    window.FB.login(
      (r) => {
        const code = r.authResponse?.code
        if (!code) { setEstado('cancelado'); return }
        setEstado('conectando')
        void finalizarConexion(code, modo)
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: modo === 'coexistencia' ? 'whatsapp_business_app_onboarding' : '',
          sessionInfoVersion: '3',
        },
      },
    )
  }

  return (
    <div>
      <div className="rounded-[10px] border border-line bg-line2/40 p-3">
        <div className="text-[11.5px] font-extrabold text-muted">¿Cómo usas hoy ese número?</div>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11.5px] font-semibold leading-relaxed text-muted">
          <input type="radio" name={`modo-wa-${sedeId}`} className="mt-0.5 accent-orange"
            checked={modo === 'coexistencia'} onChange={() => setModo('coexistencia')} />
          <span>
            <span className="font-extrabold text-ink">Ya lo uso en WhatsApp Business.</span>{' '}
            Se conecta sin perderlo: sigue en tu celular y Finny atiende en paralelo.
          </span>
        </label>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11.5px] font-semibold leading-relaxed text-muted">
          <input type="radio" name={`modo-wa-${sedeId}`} className="mt-0.5 accent-orange"
            checked={modo === 'nuevo'} onChange={() => setModo('nuevo')} />
          <span><span className="font-extrabold text-ink">Es un número nuevo</span>, sin WhatsApp instalado.</span>
        </label>
      </div>

      {enCelular && (
        <div className="mt-2 rounded-[9px] bg-orange-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-orange">
          El asistente de Meta funciona mucho mejor desde una computadora: en el
          celular abre ventanas, te saca de la app a buscar el código y la sesión
          puede vencerse.
        </div>
      )}

      <button
        onClick={conectar}
        disabled={estado === 'abriendo' || estado === 'conectando'}
        className="mt-2.5 w-full cursor-pointer rounded-[9px] border-none bg-orange py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
        {estado === 'abriendo' ? 'Abriendo Meta…'
          : estado === 'conectando' ? 'Conectando…'
          : 'Conectar WhatsApp'}
      </button>

      {estado === 'cancelado' && (
        <div className="mt-2 text-[11px] font-semibold text-faint">
          Se canceló la conexión. Puedes intentarlo otra vez.
        </div>
      )}
      {estado === 'error' && (
        <div className="mt-2 text-[11px] font-bold leading-relaxed text-red">{error}</div>
      )}
    </div>
  )
}
