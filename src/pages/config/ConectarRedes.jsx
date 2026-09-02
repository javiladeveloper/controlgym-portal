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
  const [ocupado, setOcupado] = useState('')
  const [pendientes, setPendientes] = useState({ tipo: null, cuentas: [] })

  const cargar = useCallback(async () => {
    if (!sedeId) return
    try {
      const r = await fetch(`/api/leadia?action=canales&op=listar&sedeId=${sedeId}`,
        { headers: await authHeader() })
      const out = await r.json()
      if (!r.ok) throw new Error(out.error || 'No se pudo leer los canales')
      setActivo(out.activo !== false)
      setCanales(Array.isArray(out.canales) ? out.canales : [])
    } catch (e) {
      toast.error(e.message)
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
    return <p className="text-sm text-gray-500">Cargando las redes…</p>
  }

  if (!activo) {
    return (
      <Card>
        <p className="text-sm text-gray-600">
          Primero activa Finny en <strong>{sedeNombre}</strong> (arriba) y después
          conecta las redes por donde va a atender.
        </p>
      </Card>
    )
  }

  const porTipo = (tipo) => canales.filter((c) => c.tipo === tipo)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Redes conectadas</h3>
        <p className="text-sm text-gray-600">
          Por acá le llegan los mensajes a Finny. Sin al menos una red conectada,
          el asistente no puede atender a nadie.
        </p>
      </div>

      {/* Elegir cuenta cuando Meta devolvió varias páginas */}
      {pendientes.cuentas.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <p className="text-sm font-medium text-amber-900">
            Tienes {pendientes.cuentas.length} cuentas. ¿Cuál quieres conectar?
          </p>
          <div className="mt-3 space-y-2">
            {pendientes.cuentas.map((c) => (
              <div key={c.cuentaExterna} className="flex items-center justify-between gap-3 rounded border border-amber-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.nombre || 'Cuenta'}</p>
                  <p className="truncate text-xs text-gray-500">{c.cuentaExterna}</p>
                </div>
                <button
                  onClick={() => elegirCuenta(pendientes.tipo, c.cuentaExterna)}
                  disabled={!!ocupado}
                  className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  {ocupado === c.cuentaExterna ? 'Conectando…' : 'Conectar esta'}
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {REDES.map((red) => {
        const conectados = porTipo(red.tipo)
        return (
          <Card key={red.tipo}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">
                  <span className="mr-1.5">{red.icono}</span>{red.nombre}
                </p>
                <p className="mt-0.5 text-sm text-gray-600">{red.detalle}</p>
              </div>
              <span className="shrink-0 text-xs text-gray-500">
                {/* Un guion no miente: mientras carga no se afirma "sin conectar",
                    que a alguien con su número conectado le resultaría falso. */}
                {cargando ? '—' : conectados.length ? `${conectados.length} conectada(s)` : 'Sin conectar'}
              </span>
            </div>

            {conectados.length > 0 && (
              <div className="mt-3 space-y-2">
                {conectados.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.nombre || c.cuentaExterna}</p>
                      <p className="truncate text-xs text-gray-500">
                        {c.creadoEn ? `conectada el ${new Date(c.creadoEn).toLocaleDateString('es-PE')}` : c.cuentaExterna}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => cambiarActivo(c)} disabled={!!ocupado}
                        className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                          c.activo ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {c.activo ? 'Activo' : 'Apagado'}
                      </button>
                      <button
                        onClick={() => desconectar(c)} disabled={!!ocupado}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
                        Desconectar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Una cuenta por red: con algo conectado, desaparece el botón. */}
            {!cargando && conectados.length === 0 && (
              <div className="mt-3">
                {red.metodo === 'whatsapp'
                  ? <ConectarWhatsApp sedeId={sedeId} alConectar={cargar} />
                  : (
                    <button
                      onClick={() => conectarOAuth(red.tipo)} disabled={!!ocupado}
                      className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                      {ocupado === red.tipo ? 'Abriendo…' : `Conectar ${red.nombre}`}
                    </button>
                  )}
              </div>
            )}

            {/* El texto se ajusta al número real de cuentas: afirmar "desconecta
                la actual" con dos conectadas es sencillamente falso, y el motor
                puede devolver más de una (no garantiza el límite que el panel
                sugiere). */}
            {!cargando && conectados.length === 1 && (
              <p className="mt-2 text-xs text-gray-500">
                Para usar otra cuenta de {red.nombre}, primero desconecta la actual.
              </p>
            )}
            {!cargando && conectados.length > 1 && (
              <p className="mt-2 text-xs text-gray-500">
                Tienes {conectados.length} cuentas de {red.nombre} conectadas. Finny
                atiende por todas las que estén activas.
              </p>
            )}
          </Card>
        )
      })}
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
function ConectarWhatsApp({ sedeId, alConectar }) {
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
    <div className="space-y-3">
      <div className="rounded border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-medium text-gray-700">¿Cómo usas hoy ese número?</p>
        <label className="mt-2 flex items-start gap-2 text-xs text-gray-700">
          <input type="radio" name="modo-wa" className="mt-0.5" checked={modo === 'coexistencia'}
            onChange={() => setModo('coexistencia')} />
          <span>
            <strong>Ya lo uso en WhatsApp Business</strong> (en mi celular).
            Se conecta sin perderlo: sigue funcionando en la app y Finny atiende en paralelo.
          </span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-xs text-gray-700">
          <input type="radio" name="modo-wa" className="mt-0.5" checked={modo === 'nuevo'}
            onChange={() => setModo('nuevo')} />
          <span><strong>Es un número nuevo</strong>, sin WhatsApp instalado.</span>
        </label>
      </div>

      {enCelular && (
        <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          El asistente de Meta funciona mucho mejor desde una computadora. Desde el
          celular abre ventanas, te hace salir de la app a buscar el código y la
          sesión puede vencerse.
        </p>
      )}

      <button
        onClick={conectar}
        disabled={estado === 'abriendo' || estado === 'conectando'}
        className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {estado === 'abriendo' ? 'Abriendo Meta…'
          : estado === 'conectando' ? 'Conectando…'
          : 'Conectar WhatsApp'}
      </button>

      {estado === 'cancelado' && (
        <p className="text-xs text-gray-600">Se canceló la conexión. Puedes intentarlo otra vez.</p>
      )}
      {estado === 'error' && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
