import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { money } from '../../lib/uiHelpers.js'

// Mi plan: suscripción del gimnasio a FitControl.
// Trial de 30 días sin tarjeta → activar pago automático con Culqi.
const PLANES = [
  { slug: 'estudio', nombre: 'Estudio', base: 49, conApp: 79, para: 'Yoga, pilates, baile y gyms pequeños' },
  { slug: 'crecimiento', nombre: 'Crecimiento', base: 99, conApp: 139, para: 'Para captar y crecer' },
  { slug: 'cadena', nombre: 'Cadena', base: 179, conApp: 229, para: 'Multi-sede y franquicias' },
]

const ESTADOS = {
  prueba: { label: 'En prueba gratis', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  activa: { label: 'Activa ✓', cls: 'bg-green-50 text-green-700 border-green-200' },
  pendiente_pago: { label: 'Pago pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  vencida: { label: 'Prueba vencida', cls: 'bg-red-50 text-red border-red-200' },
  cancelada: { label: 'Cancelada', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
}

const CULQI_PK = import.meta.env.VITE_CULQI_PUBLIC_KEY

function cargarCulqi() {
  return new Promise((resolve, reject) => {
    if (window.Culqi) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.culqi.com/js/v4'
    s.onload = resolve
    s.onerror = () => reject(new Error('No se pudo cargar Culqi'))
    document.head.appendChild(s)
  })
}

export default function TabPlan() {
  const { empresa, usuario } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { tipo: 'ok'|'error', texto }

  const sus = useQuery({
    queryKey: ['mi-suscripcion', empresa?.id],
    enabled: !!empresa?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_mi_suscripcion')
      if (error) throw error
      return data
    },
  })

  const pagos = useQuery({
    queryKey: ['pagos-plataforma', empresa?.id],
    enabled: !!empresa?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pago_plataforma')
        .select('id, monto, moneda, estado, pagado_at')
        .order('pagado_at', { ascending: false })
        .limit(24)
      if (error) throw error
      return data
    },
  })

  const s = sus.data
  const activa = s?.estado === 'activa'
  const diasTrial = s?.trial_hasta
    ? Math.max(0, Math.ceil((new Date(s.trial_hasta) - Date.now()) / 86400000))
    : 0

  async function cambiarPlan(planSlug, conApp) {
    if (activa) {
      setMsg({ tipo: 'error', texto: 'Tu pago automático ya está activo. Para cambiar de plan escríbenos por WhatsApp y lo hacemos al toque.' })
      return
    }
    const { error } = await supabase.rpc('elegir_plan', { p_empresa_id: empresa.id, p_plan: planSlug, p_con_app: conApp })
    if (error) setMsg({ tipo: 'error', texto: error.message })
    else { setMsg(null); qc.invalidateQueries({ queryKey: ['mi-suscripcion'] }) }
  }

  async function activarPago() {
    setMsg(null)
    if (!CULQI_PK) {
      setMsg({ tipo: 'error', texto: 'Los pagos con tarjeta se habilitan muy pronto. Mientras tanto puedes pagar por Yape/Plin — escríbenos por WhatsApp.' })
      return
    }
    setBusy(true)
    try {
      await cargarCulqi()
      window.Culqi.publicKey = CULQI_PK
      // Callback global ANTES de configurar (Culqi lo invoca con el token o error)
      window.culqi = async function () {
        if (window.Culqi.token) {
          try {
            const { data: sess } = await supabase.auth.getSession()
            const res = await fetch('/api/culqi/suscribir', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${sess?.session?.access_token || ''}`,
              },
              body: JSON.stringify({
                empresa_id: empresa.id,
                token_id: window.Culqi.token.id,
                email: usuario?.email,
              }),
            })
            const out = await res.json()
            if (!res.ok) throw new Error(out.error || 'No se pudo activar')
            setMsg({ tipo: 'ok', texto: '¡Pago automático activado! Tu tarjeta se cargará cada mes.' })
            qc.invalidateQueries({ queryKey: ['mi-suscripcion'] })
          } catch (e) {
            setMsg({ tipo: 'error', texto: e.message })
          } finally {
            setBusy(false)
          }
        } else if (window.Culqi.error) {
          setMsg({ tipo: 'error', texto: window.Culqi.error.user_message || 'Tarjeta rechazada' })
          setBusy(false)
        }
      }
      // Solo tarjeta: Yape/billeteras del checkout requieren config extra y
      // hacen que el modal no abra si no están habilitadas en la cuenta.
      window.Culqi.settings({
        title: 'FitControl',
        currency: 'PEN',
        amount: Math.round(Number(s.monto) * 100),
      })
      window.Culqi.options({
        lang: 'auto',
        installments: false,
        paymentMethods: { tarjeta: true, yape: false, bancaMovil: false, agente: false, billetera: false, cuotealo: false },
        style: { buttonBackground: '#FF6B35' },
      })
      window.Culqi.open()
      // Watchdog: si en 6s no apareció el modal de Culqi, liberar el botón con ayuda
      setTimeout(() => {
        const abierto = document.querySelector('iframe[src*="culqi"], #culqi-checkout, .culqi-checkout')
        if (!abierto) {
          setBusy(false)
          setMsg({
            tipo: 'error',
            texto: 'El formulario de pago no se abrió. Desactiva bloqueadores de anuncios para este sitio e inténtalo de nuevo — o abre la consola (F12) y cuéntanos qué error aparece.',
          })
        }
      }, 6000)
    } catch (e) {
      setMsg({ tipo: 'error', texto: e.message })
      setBusy(false)
    }
  }

  if (sus.isLoading) return <p className="text-[13px] font-semibold text-faint">Cargando tu plan…</p>
  if (sus.isError) return <p className="text-[13px] font-bold text-red">No se pudo cargar la suscripción: {sus.error.message}</p>

  const est = ESTADOS[s?.estado] || ESTADOS.prueba

  return (
    <div className="max-w-[720px]">
      <Card className="p-[19px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-extrabold">Tu suscripción a FitControl</div>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">
              Plan <b className="text-ink capitalize">{s.plan_slug}</b>{s.con_app ? ' + App del socio' : ''} · {money(Number(s.monto))} al mes
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[11.5px] font-extrabold ${est.cls}`}>{est.label}</span>
        </div>

        {s.estado === 'prueba' && (
          <div className="mt-4 rounded-[10px] border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800">
            Te quedan <b>{diasTrial} días de prueba gratis</b> (hasta el {new Date(s.trial_hasta).toLocaleDateString('es-PE')}).
            Y cuando actives tu tarjeta, el primer cobro recién sale <b>1 mes después</b> — actives cuando actives.
          </div>
        )}
        {s.estado === 'vencida' && (
          <div className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-bold text-red">
            Tu prueba gratis terminó. Activa tu tarjeta hoy: tienes 1 mes más de regalo y el primer cobro sale recién en 30 días.
          </div>
        )}
        {s.estado === 'pendiente_pago' && (
          <div className="mt-4 rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-bold text-amber-800">
            El último cobro no pasó. Verifica tu tarjeta o escríbenos por WhatsApp.
          </div>
        )}

        {!activa && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={activarPago} disabled={busy}>
              {busy ? 'Abriendo pago seguro…' : `💳 Activar pago automático · ${money(Number(s.monto))}/mes`}
            </PrimaryButton>
            <span className="text-[11.5px] font-semibold text-faint">Pago seguro con Culqi · puedes cancelar cuando quieras</span>
          </div>
        )}
        {activa && s.proximo_cobro && (
          <p className="mt-4 text-[12.5px] font-semibold text-muted">
            Próximo cobro: <b className="text-ink">{new Date(s.proximo_cobro).toLocaleDateString('es-PE')}</b>
          </p>
        )}

        {msg && (
          <div className={`mt-4 rounded-[10px] px-4 py-2.5 text-[13px] font-bold ${msg.tipo === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red'}`}>
            {msg.texto}
          </div>
        )}
      </Card>

      {/* Cambiar de plan (solo antes de activar el pago) */}
      <Card className="mt-4 p-[19px]">
        <div className="text-[13.5px] font-extrabold">Cambiar de plan</div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PLANES.map((p) => {
            const seleccionado = s.plan_slug === p.slug
            return (
              <button key={p.slug} onClick={() => cambiarPlan(p.slug, s.con_app)}
                className={`rounded-[10px] border p-3 text-center transition-colors ${seleccionado ? 'border-orange bg-orange-50' : 'border-line bg-white hover:border-orange'}`}>
                <div className="text-[13px] font-extrabold">{p.nombre}</div>
                <div className="text-[15px] font-extrabold text-orange">S/ {s.con_app ? p.conApp : p.base}<span className="text-[10px] text-muted">/mes</span></div>
                <div className="mt-0.5 text-[10px] font-semibold leading-tight text-muted">{p.para}</div>
              </button>
            )
          })}
        </div>
        <label className="mt-3 flex items-start gap-2">
          <input type="checkbox" checked={!!s.con_app} disabled={activa}
            onChange={(e) => cambiarPlan(s.plan_slug, e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-orange-600" />
          <span className="text-[12.5px] font-bold">
            📱 App para mis socios{' '}
            <b className="text-orange">
              +S/ {(PLANES.find((p) => p.slug === s.plan_slug)?.conApp ?? 0) - (PLANES.find((p) => p.slug === s.plan_slug)?.base ?? 0)}/mes
            </b>{' '}
            <span className="font-semibold text-muted">— cubre a todos tus socios (muy pronto; se cobra recién cuando la actives)</span>
          </span>
        </label>
        {activa && <p className="mt-2 text-[11.5px] font-semibold text-faint">Con el pago activo, los cambios de plan se coordinan por WhatsApp para ajustar el cobro.</p>}
      </Card>

      {/* Historial de pagos */}
      <Card className="mt-4 p-[19px]">
        <div className="text-[13.5px] font-extrabold">Historial de pagos</div>
        {(pagos.data || []).length === 0 ? (
          <p className="mt-2 text-[12px] font-semibold text-faint">Aún no hay cobros — estás en tu período de prueba.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {pagos.data.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-[9px] border border-line px-3.5 py-2">
                <span className="text-[12.5px] font-bold">{new Date(p.pagado_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                <span className="text-[12.5px] font-extrabold">{money(Number(p.monto))}</span>
                <span className={`text-[11px] font-extrabold ${p.estado === 'exitoso' ? 'text-green-600' : 'text-red'}`}>
                  {p.estado === 'exitoso' ? '✓ Pagado' : p.estado === 'fallido' ? '✕ Falló' : 'Reembolsado'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
