import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import LoadingOverlay from '../../components/LoadingOverlay.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { money, fechaLocal } from '../../lib/uiHelpers.js'

import { PLANES_GYM, PLAN_MIEMBROS, planPorSlug, precioPlan, appIncluida, planQueConviene } from '../../config/planesComerciales.js'

// Mi plan: suscripción del negocio a FitCore.
// Trial de 30 días sin tarjeta → activar pago automático con Culqi.
// Los gimnasios pueden cambiar entre sus 3 tamaños; los segmentos
// (academia/niños/trainer) tienen plan único.

const ESTADOS = {
  prueba: { label: 'En prueba gratis', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  activa: { label: 'Activa ✓', cls: 'bg-green-50 text-green-700 border-green-200' },
  pendiente_pago: { label: 'Pago pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  vencida: { label: 'Prueba vencida', cls: 'bg-red-50 text-red border-red-200' },
  cancelada: { label: 'Cancelada', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
}

const CULQI_PK = (import.meta.env.VITE_CULQI_PUBLIC_KEY || '').trim()

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
  const [fase, setFase] = useState(null) // 'abriendo' | 'activando' — para el overlay de carga
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

  // Facturas del plan 'miembros' sin pagar (vacío en los demás planes).
  const facturas = useQuery({
    queryKey: ['mis-facturas-pendientes', empresa?.id],
    enabled: !!empresa?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mis_facturas_pendientes')
      if (error) throw error
      return data || []
    },
  })

  // Lo que va acumulando este mes en el plan 'miembros'. Sin esto el gym no
  // sabría cuánto va a pagar hasta que le llega la factura.
  const consumo = useQuery({
    queryKey: ['mi-consumo-actual', empresa?.id],
    enabled: !!empresa?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mi_consumo_actual')
      if (error) throw error
      return data || []
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
  // trial_hasta es un DATE (medianoche). Se parsea como fecha LOCAL para no
  // desfasar en Perú (UTC-5), y el conteo se hace por diferencia de DÍAS de
  // calendario (no por horas): coincide con la BD, que marca 'vencida' cuando
  // trial_hasta < current_date. Así "0" = último día, "1" = falta 1 día, etc.
  const diasTrial = (() => {
    const fin = s?.trial_hasta ? fechaLocal(s.trial_hasta) : null
    if (!fin) return 0
    fin.setHours(0, 0, 0, 0)
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    return Math.max(0, Math.round((fin - hoy) / 86400000))
  })()

  async function cambiarPlan(planSlug, conApp) {
    // Subir de 'miembros' a un plan fijo es self-service: es justo el gym que ya
    // demostró que paga, y mandarlo a WhatsApp mata el embudo. El resto de
    // cambios con pago activo sí se coordinan (hay una suscripción que tocar).
    const subiendoDesdeMiembros = s?.plan_slug === 'miembros' && planSlug !== 'miembros'
    if (activa && !subiendoDesdeMiembros) {
      setMsg({ tipo: 'error', texto: 'Tu pago automático ya está activo. Para cambiar de plan escríbenos por WhatsApp y lo hacemos al toque.' })
      return
    }
    // Bajar a 'miembros' le quita la app a sus socios y cambia cómo se le cobra:
    // eso no puede pasar de un clic sin avisar.
    if (planSlug === 'miembros' && s?.plan_slug !== 'miembros') {
      const n = (consumo.data || []).reduce((a, x) => a + Number(x.socios || 0), 0)
      const actual = planPorSlug(s?.plan_slug)
      const estimado = n > 0 ? `Con tus socios de hoy pagarías ~S/ ${n}/mes` : 'Pagarías S/ 1 por cada socio activo'
      const comparado = actual?.precio ? ` (hoy pagas S/ ${actual.precio}).` : '.'
      if (!window.confirm(
        `¿Pasar al plan Miembros?\n\n` +
        `• Tus socios PERDERÁN el acceso a la app: tu gym deja de aparecer en ella.\n` +
        `• Dejas de pagar una cuota fija y pasas a S/ 1 por socio activo, cobrado a fin de mes.\n` +
        `• ${estimado}${comparado}\n\n` +
        `Puedes volver a un plan fijo cuando quieras.`,
      )) return
    }
    const { error } = await supabase.rpc('elegir_plan', { p_empresa_id: empresa.id, p_plan: planSlug, p_con_app: conApp })
    if (error) setMsg({ tipo: 'error', texto: error.message })
    else {
      setMsg({
        tipo: 'ok',
        texto: planSlug === 'miembros'
          ? '✓ Estás en el plan Miembros. A fin de mes te llega la cuenta por tus socios activos.'
          : '✓ Plan actualizado. El nuevo monto aplica al activar tu pago automático.',
      })
      qc.invalidateQueries({ queryKey: ['mi-suscripcion'] })
      qc.invalidateQueries({ queryKey: ['mi-consumo-actual'] })
    }
  }

  // Upgrade self-service: el plan ya está activo y quiere sumar la app.
  // Usa la tarjeta guardada — sin volver a pasar por el checkout.
  async function agregarApp() {
    if (!window.confirm(`¿Agregar la App del socio a tu plan? El nuevo monto se cobra desde tu siguiente ciclo.`)) return
    setBusy(true); setFase('activando'); setMsg(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch('/api/culqi?action=agregar-app', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${sess?.session?.access_token || ''}`,
        },
        body: JSON.stringify({ empresa_id: empresa.id }),
      })
      const out = await res.json()
      if (!res.ok) throw new Error(out.error || 'No se pudo agregar la app')
      setMsg({ tipo: 'ok', texto: '📱 ¡App agregada a tu plan! El nuevo monto se cobra desde el siguiente ciclo.' })
      qc.invalidateQueries({ queryKey: ['mi-suscripcion'] })
    } catch (e) {
      setMsg({ tipo: 'error', texto: e.message })
    } finally {
      setBusy(false); setFase(null)
    }
  }

  // Pago de una factura del plan 'miembros': cargo único por lo consumido el
  // mes cerrado. Al confirmarse, la sede sale de solo lectura sola.
  async function pagarFactura(factura) {
    setMsg(null)
    if (!CULQI_PK) {
      setMsg({ tipo: 'error', texto: 'Los pagos con tarjeta se habilitan muy pronto. Escríbenos por WhatsApp para regularizar.' })
      return
    }
    setBusy(true)
    setFase('abriendo')
    try {
      await cargarCulqi()
      window.Culqi.publicKey = CULQI_PK
      window.culqi = async function () {
        if (window.Culqi.token) {
          try { window.Culqi.close() } catch { /* el modal no siempre existe */ }
          setFase('activando')
          try {
            const { data: sess } = await supabase.auth.getSession()
            const res = await fetch('/api/culqi?action=pagar-factura', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${sess?.session?.access_token || ''}`,
              },
              body: JSON.stringify({
                factura_id: factura.id,
                token_id: window.Culqi.token.id,
                email: usuario?.email,
              }),
            })
            const out = await res.json()
            if (!res.ok) throw new Error(out.error || 'No se pudo procesar el pago')
            setMsg({ tipo: 'ok', texto: '✓ ¡Pago recibido! Tu sede vuelve a operar con normalidad.' })
            qc.invalidateQueries({ queryKey: ['mis-facturas-pendientes'] })
            qc.invalidateQueries({ queryKey: ['pagos-plataforma'] })
            qc.invalidateQueries({ queryKey: ['suscripciones-sedes'] })
          } catch (e) {
            setMsg({ tipo: 'error', texto: e.message })
          } finally {
            setBusy(false)
            setFase(null)
          }
        } else if (window.Culqi.error) {
          setMsg({ tipo: 'error', texto: window.Culqi.error.user_message || 'Tarjeta rechazada' })
          setBusy(false)
          setFase(null)
        }
      }
      window.Culqi.settings({
        title: 'FitCore',
        currency: 'PEN',
        amount: Math.round(Number(factura.monto) * 100),
      })
      window.Culqi.options({
        lang: 'auto',
        installments: false,
        paymentMethods: { tarjeta: true, yape: false, bancaMovil: false, agente: false, billetera: false, cuotealo: false },
        style: { buttonBackground: '#FF6B35' },
      })
      window.Culqi.open()
    } catch (e) {
      setBusy(false)
      setFase(null)
      setMsg({ tipo: 'error', texto: e.message || 'No se pudo abrir el pago' })
    }
  }

  async function activarPago() {
    setMsg(null)
    if (!CULQI_PK) {
      setMsg({ tipo: 'error', texto: 'Los pagos con tarjeta se habilitan muy pronto. Mientras tanto puedes pagar por Yape/Plin — escríbenos por WhatsApp.' })
      return
    }
    setBusy(true)
    setFase('abriendo')
    try {
      await cargarCulqi()
      window.Culqi.publicKey = CULQI_PK
      // Callback global ANTES de configurar (Culqi lo invoca con el token o error)
      window.culqi = async function () {
        if (window.Culqi.token) {
          try { window.Culqi.close() } catch { /* el modal no siempre existe */ }
          setFase('activando')
          try {
            const { data: sess } = await supabase.auth.getSession()
            const res = await fetch('/api/culqi?action=suscribir', {
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
            setFase(null)
          }
        } else if (window.Culqi.error) {
          setMsg({ tipo: 'error', texto: window.Culqi.error.user_message || 'Tarjeta rechazada' })
          setBusy(false)
          setFase(null)
        }
      }
      // Solo tarjeta: Yape/billeteras del checkout requieren config extra y
      // hacen que el modal no abra si no están habilitadas en la cuenta.
      window.Culqi.settings({
        title: 'FitCore',
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
      // Cuando el modal de Culqi aparece, apagamos nuestro overlay de carga.
      // Si en 6s no apareció, liberamos el botón con un mensaje de ayuda.
      const inicio = Date.now()
      const vigilar = setInterval(() => {
        const abierto = document.querySelector('iframe[src*="culqi"], #culqi-checkout, .culqi-checkout')
        if (abierto) {
          setFase(null)
          clearInterval(vigilar)
        } else if (Date.now() - inicio > 6000) {
          clearInterval(vigilar)
          setBusy(false)
          setFase(null)
          setMsg({
            tipo: 'error',
            texto: 'El formulario de pago no se abrió. Desactiva bloqueadores de anuncios para este sitio e inténtalo de nuevo.',
          })
        }
      }, 300)
    } catch (e) {
      setMsg({ tipo: 'error', texto: e.message })
      setBusy(false)
      setFase(null)
    }
  }

  if (sus.isLoading) return <p className="text-[13px] font-semibold text-faint">Cargando tu plan…</p>
  if (sus.isError) return <p className="text-[13px] font-bold text-red">No se pudo cargar la suscripción: {sus.error.message}</p>

  const est = ESTADOS[s?.estado] || ESTADOS.prueba
  // El plan por miembro no tiene cuota fija: ni trial que correr, ni suscripción
  // recurrente que activar. Se paga factura por factura.
  const esMiembros = s?.plan_slug === 'miembros'

  return (
    <div className="max-w-[720px]">
      {fase === 'abriendo' && <LoadingOverlay texto="Abriendo pago seguro…" sub="Conectando con Culqi" />}
      {fase === 'activando' && <LoadingOverlay texto="Activando tu suscripción…" sub="Confirmando con tu tarjeta, no cierres la ventana" />}

      {/* Deuda del plan por miembro: primero que nada, tiene fecha límite */}
      {(facturas.data || []).map((f) => (
        <FacturaPendiente key={f.id} factura={f} onPagar={() => pagarFactura(f)} busy={busy} />
      ))}

      {/* Lo que va del mes en curso: el gym debe saber cuánto pagará ANTES del
          corte, no enterarse cuando le llega la factura. */}
      {esMiembros && (consumo.data || []).length > 0 && <ConsumoDelMes sedes={consumo.data} />}

      <Card className="p-[19px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-extrabold">Tu suscripción a FitCore</div>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">
              Plan <b className="text-ink capitalize">{s.plan_slug}</b>
              {esMiembros
                ? ` · S/ ${PLAN_MIEMBROS.porSocio} por socio activo, a fin de mes`
                : `${s.con_app ? ' + App del socio' : ''} · ${money(Number(s.monto))} al mes`}
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-[11.5px] font-extrabold ${est.cls}`}>{est.label}</span>
        </div>

        {!esMiembros && s.estado === 'prueba' && (
          <div className="mt-4 rounded-[10px] border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800">
            Te quedan <b>{diasTrial} {diasTrial === 1 ? 'día' : 'días'} de prueba gratis</b> (hasta el {fechaLocal(s.trial_hasta).toLocaleDateString('es-PE')}).
            {diasTrial > 5
              ? ' Disfrútala — la activación del pago se habilita en los últimos 5 días.'
              : ' Ya puedes activar tu tarjeta: el primer cobro sale recién 1 mes después.'}
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
        {s.estado === 'cancelada' && (
          <div className="mt-4 rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] font-bold text-gray-600">
            Tu suscripción está cancelada. Para reactivar tu plan escríbenos por WhatsApp y lo dejamos listo.
          </div>
        )}

        {/* El pago se habilita recién al final del trial (últimos 5 días) o vencido.
            Cancelada no muestra el CTA de activar (se reactiva por WhatsApp).
            Miembros nunca lo muestra: no hay cuota fija que suscribir — sin este
            guard pintaría "Activar pago automático · S/ 0/mes" y abriría Culqi
            con monto 0. */}
        {!esMiembros && !activa && s.estado !== 'cancelada' && (s.estado !== 'prueba' || diasTrial <= 5) && (
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

      {/* Cambiar de plan: gimnasios eligen entre 3 tamaños; segmentos tienen plan único */}
      {(() => {
        const esGym = [PLAN_MIEMBROS, ...PLANES_GYM].some((p) => p.slug === s.plan_slug)
        const planFicha = planPorSlug(s.plan_slug)
        const opciones = [PLAN_MIEMBROS, ...PLANES_GYM]
        return (
          <Card className="mt-4 p-[19px]">
            <div className="text-[13.5px] font-extrabold">{esGym ? 'Cambiar de plan' : 'Tu plan'}</div>
            {esGym ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {opciones.map((p) => {
                  const seleccionado = s.plan_slug === p.slug
                  const esMiembrosCard = p.slug === 'miembros'
                  return (
                    <button key={p.slug} onClick={() => cambiarPlan(p.slug, appIncluida(p.slug))}
                      className={`rounded-[10px] border p-3 text-center transition-colors ${seleccionado ? 'border-orange bg-orange-50' : 'border-line bg-white hover:border-orange'}`}>
                      <div className="text-[13px] font-extrabold">{p.nombre}</div>
                      {esMiembrosCard ? (
                        <div className="text-[15px] font-extrabold text-green-600">
                          S/ {p.porSocio}<span className="text-[10px] font-bold text-muted">/socio</span>
                          <span className="block text-[9.5px] font-bold text-muted">sin cuota fija</span>
                        </div>
                      ) : (
                        <div className="text-[15px] font-extrabold text-orange">S/ {precioPlan(p)}<span className="text-[10px] text-muted">/mes</span></div>
                      )}
                      <div className="mt-0.5 text-[10px] font-semibold leading-tight text-muted">{p.para}</div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-[10px] border border-orange bg-orange-50 p-3.5">
                <div className="text-[13.5px] font-extrabold">{planFicha?.nombre}</div>
                <div className="text-[16px] font-extrabold text-orange">S/ {precioPlan(planFicha, s.con_app)}<span className="text-[10.5px] text-muted">/mes</span></div>
                <div className="mt-0.5 text-[11px] font-semibold text-muted">{planFicha?.para}</div>
              </div>
            )}
            {s.plan_slug === 'miembros' ? (
              <div className="mt-3 rounded-[10px] border border-line bg-surface px-3.5 py-2.5">
                <div className="text-[12.5px] font-bold">{PLAN_MIEMBROS.detalle}</div>
                <div className="mt-1.5 text-[11px] font-semibold text-faint">📱 {PLAN_MIEMBROS.letraChica} Están en Estudio, Crecimiento y Pro.</div>
              </div>
            ) : appIncluida(s.plan_slug) ? (
              <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-green-200 bg-green-50 px-3.5 py-2.5">
                <span className="text-[13px]">📱</span>
                <span className="text-[12.5px] font-bold text-green-800">
                  App para tus socios INCLUIDA
                  <span className="block font-semibold text-green-800/80">Sin costo extra — ya viene con tu plan.</span>
                </span>
              </div>
            ) : (
              <>
                <label className="mt-3 flex items-start gap-2">
                  <input type="checkbox" checked={!!s.con_app} disabled={activa && s.con_app}
                    onChange={(e) => (activa ? agregarApp() : cambiarPlan(s.plan_slug, e.target.checked))}
                    className="mt-0.5 h-4 w-4 accent-orange-600" />
                  <span className="text-[12.5px] font-bold">
                    📱 App incluida{' '}
                    <b className="text-orange">
                      +S/ {(planFicha?.conApp ?? 0) - (planFicha?.base ?? 0)}/mes
                    </b>{' '}
                    <span className="font-semibold text-muted">— cubre a todos (muy pronto; se cobra recién cuando la actives)</span>
                  </span>
                </label>
                {activa && !s.con_app && <p className="mt-2 text-[11.5px] font-semibold text-faint">Puedes agregar la app cuando quieras: usa tu misma tarjeta y el nuevo monto se cobra desde el siguiente ciclo.</p>}
              </>
            )}
            {activa && <p className="mt-2 text-[11.5px] font-semibold text-faint">Para cambiar de plan escríbenos por WhatsApp y lo ajustamos al toque.</p>}
          </Card>
        )
      })()}

      {/* Historial de pagos */}
      <Card className="mt-4 p-[19px]">
        <div className="text-[13.5px] font-extrabold">Historial de pagos</div>
        {(pagos.data || []).length === 0 ? (
          <p className="mt-2 text-[12px] font-semibold text-faint">Aún no hay cobros — estás en tu período de prueba.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {pagos.data.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-[9px] border border-line px-3.5 py-2">
                <span className="text-[12.5px] font-bold">{p.pagado_at ? new Date(p.pagado_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</span>
                <span className="text-[12.5px] font-extrabold">{money(Number(p.monto))}</span>
                <span className={`text-[11px] font-extrabold ${p.estado === 'exitoso' ? 'text-green-600' : 'text-red'}`}>
                  {p.estado === 'exitoso' ? '✓ Pagado' : p.estado === 'fallido' ? '✕ Falló' : 'Reembolsado'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Cobro por sede: cada sede paga su propia membresía (aparece solo si el
          gym tiene más de una sede). La suscripción de arriba es el fallback. */}
      <SuscripcionPorSede />

      {/* Zona de peligro: eliminar el negocio (creado por error, cierre, etc.) */}
      <ZonaPeligro empresa={empresa} suscripcion={s} />
    </div>
  )
}

const ESTADO_SEDE = {
  activa: { bg: '#E7F6F0', color: '#1D9E75', label: 'Activa' },
  prueba: { bg: '#FFF4EC', color: '#C2410C', label: 'En prueba' },
  vencida: { bg: '#FDECEC', color: '#E24B4A', label: 'Vencida' },
  cancelada: { bg: '#F1F2F4', color: '#5B6472', label: 'Cancelada' },
}

// Lo que va del mes en curso en el plan por miembro. Sin esto el gym vería
// "S/ 0 al mes" todo el mes y la factura le caería de sorpresa el día 1.
function ConsumoDelMes({ sedes }) {
  const total = sedes.reduce((n, x) => n + Number(x.monto || 0), 0)
  const socios = sedes.reduce((n, x) => n + Number(x.socios || 0), 0)
  const cobro = sedes[0]?.se_cobra_el

  return (
    <Card className="mb-4 p-[19px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[14.5px] font-extrabold">Lo que llevas este mes</div>
          <p className="mt-0.5 text-[12.5px] font-semibold text-muted">
            <b className="text-ink">{socios} socios activos</b> hoy × S/ {PLAN_MIEMBROS.porSocio}
            {cobro && <> · se cobra el {fechaLocal(cobro).toLocaleDateString('es-PE')}</>}
          </p>
          <p className="mt-1 text-[11.5px] font-semibold text-faint">
            Sube y baja con tus socios: el monto final es el de tus socios activos el último día del mes.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-extrabold leading-none">{money(total)}</div>
          <div className="text-[10.5px] font-bold text-faint">estimado del mes</div>
        </div>
      </div>
      {sedes.length > 1 && (
        <div className="mt-3 space-y-1 border-t border-line pt-2.5">
          {sedes.map((x) => (
            <div key={x.sede_id} className="flex items-center justify-between text-[12px] font-semibold">
              <span className="text-muted">{x.sede_nombre} · {x.socios} socios</span>
              <span className="tabular-nums">{money(Number(x.monto))}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// Factura del plan por miembro: lo que se debe por el mes cerrado, con su plazo
// y el botón de pago. Si un plan fijo le saldría más barato, se lo decimos — es
// preferible que migre a que sienta que le cobramos de más.
function FacturaPendiente({ factura, onPagar, busy }) {
  const vencida = factura.estado === 'vencida'
  const dias = Number(factura.dias_restantes ?? 0)
  const mes = fechaLocal(factura.periodo).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })
  const conviene = planQueConviene(Number(factura.socios || 0))

  return (
    <Card className={`mb-4 border-2 p-[19px] ${vencida ? 'border-red-300 bg-red-50/40' : 'border-amber-300 bg-amber-50/40'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[14.5px] font-extrabold">
            {vencida ? '🔒 Tu sede está en modo solo lectura' : `Tu cuenta de ${mes}`}
          </div>
          <p className="mt-0.5 text-[12.5px] font-semibold text-muted">
            <b className="text-ink">{factura.socios} socios activos</b> × S/ {PLAN_MIEMBROS.porSocio} ·{' '}
            {factura.sede_nombre}
          </p>
          <p className={`mt-1.5 text-[12.5px] font-bold ${vencida ? 'text-red' : 'text-amber-800'}`}>
            {vencida
              ? 'Puedes ver tus datos, pero no cobrar, inscribir socios ni marcar asistencia hasta que pagues.'
              : dias <= 0
                ? 'Hoy es el último día para pagar.'
                : `Te ${dias === 1 ? 'queda 1 día' : `quedan ${dias} días`} para pagar (vence el ${fechaLocal(factura.vence_el).toLocaleDateString('es-PE')}).`}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[26px] font-extrabold leading-none text-orange">{money(Number(factura.monto))}</div>
          <PrimaryButton onClick={onPagar} disabled={busy} className="mt-2">
            {busy ? 'Abriendo…' : '💳 Pagar ahora'}
          </PrimaryButton>
        </div>
      </div>

      {conviene && (
        <div className="mt-3 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[12px] font-semibold">
          💡 Con el plan <b>{conviene.plan.nombre}</b> pagarías <b>S/ {conviene.plan.precio}</b> al mes en vez de{' '}
          <b>{money(Number(factura.monto))}</b> — ahorrarías <b className="text-green-700">S/ {conviene.ahorro}</b>, y
          además tus socios tendrían la app.
        </div>
      )}
    </Card>
  )
}

// Estado de cobro POR SEDE. Cada sede paga su membresía; el override de precio
// (acuerdos con cadenas) lo fija la plataforma. El gym lo ve como resumen.
function SuscripcionPorSede() {
  const sedes = useQuery({
    queryKey: ['suscripciones-mis-sedes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('suscripciones_mis_sedes')
      if (error) throw error
      return data
    },
  })
  const lista = sedes.data || []
  if (sedes.isLoading || lista.length <= 1) return null // 1 sede: basta el bloque de arriba

  const total = lista.filter((x) => ['activa', 'prueba'].includes(x.estado)).reduce((n, x) => n + Number(x.monto || 0), 0)
  return (
    <Card className="mt-4 p-[19px]">
      <div className="text-[14.5px] font-extrabold">🏢 Cobro por sede</div>
      <p className="mt-0.5 text-[12px] font-semibold text-muted">
        Cada sede paga su propia membresía. {money(total)} al mes en total por las sedes activas.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {lista.map((x) => {
          const est = ESTADO_SEDE[x.estado] || ESTADO_SEDE.prueba
          return (
            <div key={x.sede_id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold">{x.sede_nombre}</div>
                <div className="text-[11.5px] font-semibold text-muted capitalize">
                  {x.plan_slug}{x.con_app ? ' + App del socio' : ''}
                  {x.monto_override && <span className="ml-1 text-orange">· precio pactado</span>}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[13px] font-extrabold tabular-nums">{money(Number(x.monto || 0))}<span className="text-[11px] font-semibold text-faint">/mes</span></span>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={{ background: est.bg, color: est.color }}>{est.label}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2.5 text-[11px] font-semibold text-faint">
        ¿Tienes varias sedes y quieres un precio especial? Escríbenos — los acuerdos para cadenas se configuran a mano.
      </p>
    </Card>
  )
}

// Eliminar el negocio: pide escribir el nombre para confirmar. Con suscripción
// de pago activa no se permite (primero se cancela, para no dejar cobros vivos).
function ZonaPeligro({ empresa, suscripcion }) {
  const { reloadBootstrap } = useAuth()
  const [abierto, setAbierto] = useState(false)
  const [confirmacion, setConfirmacion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const coincide = confirmacion.trim().toLowerCase() === (empresa?.nombre || '').trim().toLowerCase()

  async function eliminar() {
    setBusy(true); setError('')
    const { error } = await supabase.rpc('eliminar_empresa', { p_empresa_id: empresa.id })
    setBusy(false)
    if (error) { setError(error.message); return }
    await reloadBootstrap()
    window.location.href = '/dashboard'
  }

  return (
    <Card className="mt-4 border-red-200 p-[19px]">
      <div className="text-[13.5px] font-extrabold text-red">Zona de peligro</div>
      {!abierto ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] font-semibold text-muted">
            Eliminar este negocio: desaparece del panel y su página web se apaga. Sus datos se conservan por si necesitas recuperarlos (soporte).
          </p>
          <button onClick={() => setAbierto(true)}
            className="cursor-pointer rounded-[10px] border border-red-300 bg-white px-4 py-2 text-[12.5px] font-extrabold text-red hover:bg-red-50">
            Eliminar negocio…
          </button>
        </div>
      ) : (
        <div className="mt-3">
          {suscripcion?.estado === 'activa' && (
            <p className="mb-3 rounded-[10px] bg-amber-50 px-3.5 py-2.5 text-[12px] font-bold text-amber-800">
              Este negocio tiene una suscripción de pago activa — escríbenos por WhatsApp para cancelarla primero y evitar cobros.
            </p>
          )}
          <p className="text-[12.5px] font-bold">
            Escribe <b className="text-red">{empresa?.nombre}</b> para confirmar:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} placeholder={empresa?.nombre}
              className="w-[240px] rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-red" />
            <button disabled={!coincide || busy || suscripcion?.estado === 'activa'} onClick={eliminar}
              className="cursor-pointer rounded-[10px] border-none bg-red px-4 py-2.5 text-[12.5px] font-extrabold text-white disabled:opacity-40">
              {busy ? 'Eliminando…' : 'Eliminar definitivamente'}
            </button>
            <button onClick={() => { setAbierto(false); setConfirmacion('') }}
              className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[12.5px] font-extrabold text-muted">Cancelar</button>
          </div>
          {error && <p className="mt-2 text-[12.5px] font-bold text-red">{error}</p>}
        </div>
      )}
    </Card>
  )
}
