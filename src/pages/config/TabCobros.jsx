import { useEffect, useState } from 'react'
import { Card, PrimaryButton, Badge } from '../../components/ui.jsx'
import { LoadingState } from '../../components/states.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { toast } from '../../lib/toast.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'
import {
  useEstadoCobros, conectarCobros, useDesconectarCobros,
  usePagosPorActivar, useActivarPago,
} from '../../hooks/useCobros.js'

// Comisión de FitCore por cobro procesado en la app (debe coincidir con COMISION
// en api/mp/crear-pago.js). Solo informativa aquí.
const COMISION_PCT = 5

export default function TabCobros() {
  const { empresa } = useAuth()
  const estado = useEstadoCobros(empresa?.id)
  const desconectar = useDesconectarCobros(empresa?.id)
  const porActivar = usePagosPorActivar(empresa?.id)
  const activar = useActivarPago(empresa?.id)
  const [conectando, setConectando] = useState(false)

  // Al volver del OAuth de MercadoPago (?mp=conectado|error) mostramos el
  // resultado y limpiamos la URL para que no reaparezca al recargar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mp = params.get('mp')
    if (!mp) return
    if (mp === 'conectado') { toast.ok('¡Cobros conectados! Ya puedes recibir pagos desde la app.'); estado.refetch() }
    else if (mp === 'error') toast.error('No se pudo conectar con MercadoPago. Inténtalo de nuevo.')
    params.delete('mp')
    const q = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onConectar() {
    setConectando(true)
    try {
      await conectarCobros() // redirige a MercadoPago
    } catch (e) {
      toast.error(e.message)
      setConectando(false)
    }
  }

  function onDesconectar() {
    if (!window.confirm('¿Desconectar los cobros por app? Tus socios ya no podrán pagar membresías desde la app hasta que vuelvas a conectar.')) return
    desconectar.mutate(undefined, {
      onSuccess: () => toast.ok('Cobros desconectados.'),
      onError: (e) => toast.error(e.message),
    })
  }

  function onActivar(pago) {
    if (!window.confirm(`¿Activar a ${pago.nuevo_nombre || 'este socio'}? Se creará como socio con su membresía ${pago.plan_nombre || ''} ya pagada.`)) return
    activar.mutate({ pagoId: pago.id }, {
      onSuccess: (r) => toast.ok(`Socio activado (N.º ${r.codigo}). Membresía vigente hasta ${new Date(r.vence).toLocaleDateString('es-PE')}.`),
      onError: (e) => toast.error(e.message),
    })
  }

  const conectado = estado.data?.conectado === true
  const soloAdmin = estado.data?.motivo === 'solo_admin'
  const pagos = porActivar.data || []

  return (
    <div className="max-w-[720px] flex flex-col gap-5">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[14.5px] font-extrabold">Cobros por la app 💰</div>
            <p className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
              Conecta tu cuenta de <b>MercadoPago</b> para que tus socios paguen membresías
              y productos <b>desde su app</b>. El dinero llega directo a tu cuenta; FitCore solo
              retiene una comisión de <b>{COMISION_PCT}%</b> por cobro procesado.
            </p>
          </div>
          {!estado.isLoading && (
            <Badge bg={conectado ? T.successBg : T.line2} color={conectado ? T.success : T.muted}>
              {conectado ? 'Conectado' : 'No conectado'}
            </Badge>
          )}
        </div>

        {estado.isLoading ? (
          <div className="mt-4"><LoadingState variant="table" rows={2} /></div>
        ) : soloAdmin ? (
          <p className="mt-4 rounded-[10px] bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-800">
            Solo el administrador del gimnasio puede conectar o gestionar los cobros.
          </p>
        ) : conectado ? (
          <div className="mt-4">
            <div className="rounded-[12px] border border-line bg-[#FAFBFC] p-4">
              <div className="flex items-center gap-2 text-[13px] font-extrabold text-success">
                <span>✓</span> Cuenta de MercadoPago conectada
              </div>
              <div className="mt-1.5 grid gap-1 text-[12px] font-semibold text-muted">
                {estado.data.mp_user_id && <div>ID de comerciante: <span className="font-mono">{estado.data.mp_user_id}</span></div>}
                {estado.data.conectado_at && (
                  <div>Conectado el {new Date(estado.data.conectado_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                )}
              </div>
            </div>
            <button
              onClick={onDesconectar}
              disabled={desconectar.isPending}
              className="mt-3 cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2 text-[13px] font-extrabold text-muted hover:border-red hover:text-red disabled:opacity-60">
              Desconectar cobros
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <PrimaryButton onClick={onConectar} disabled={conectando}>
              {conectando ? 'Redirigiendo a MercadoPago…' : 'Conectar con MercadoPago'}
            </PrimaryButton>
            <p className="mt-2.5 text-[11.5px] font-semibold text-faint">
              Te llevaremos a MercadoPago para autorizar la conexión. Necesitas ser el titular
              de la cuenta del gimnasio. Es gratis y puedes desconectarlo cuando quieras.
            </p>
            <p className="mt-1.5 text-[11.5px] font-semibold text-faint">
              Sugerencia: si tienes otra cuenta de MercadoPago abierta en el navegador, hazlo en
              una ventana de incógnito para asegurarte de vincular la cuenta correcta del gimnasio.
            </p>
          </div>
        )}
      </Card>

      {/* Pagos por activar: socios nuevos que pagaron por app y falta registrarlos */}
      {pagos.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <div className="text-[14.5px] font-extrabold">Pagos por activar</div>
            <Badge bg={T.warningBg} color={T.warningStrong}>{pagos.length}</Badge>
          </div>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">
            Socios nuevos que pagaron su membresía desde la app. Actívalos para registrarlos en tu gimnasio.
          </p>
          <div className="mt-4 flex flex-col gap-2.5">
            {pagos.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-white px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-extrabold">{p.nuevo_nombre || 'Socio sin nombre'}</div>
                  <div className="text-[11.5px] font-semibold text-muted">
                    {p.plan_nombre || p.concepto} · {p.moneda === 'PEN' ? 'S/' : ''}{Number(p.monto).toFixed(2)}
                    {p.nuevo_documento ? ` · Doc ${p.nuevo_documento}` : ''}
                    {p.pagado_at ? ` · ${new Date(p.pagado_at).toLocaleDateString('es-PE')}` : ''}
                  </div>
                </div>
                <PrimaryButton onClick={() => onActivar(p)} disabled={activar.isPending}>
                  Activar socio
                </PrimaryButton>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Cómo funciona */}
      <Card className="p-5">
        <div className="text-[14px] font-extrabold">Cómo funciona</div>
        <ol className="mt-2.5 flex flex-col gap-2.5 text-[12.5px] font-semibold leading-[1.5] text-muted">
          <li><b className="text-ink">1.</b> Conectas tu cuenta de MercadoPago (una sola vez).</li>
          <li><b className="text-ink">2.</b> Tus socios ven el botón <b>Renovar / Pagar</b> en su app.</li>
          <li><b className="text-ink">3.</b> Pagan con tarjeta, Yape o el saldo de MercadoPago.</li>
          <li><b className="text-ink">4.</b> El pago llega a <b>tu</b> cuenta al instante; la membresía se renueva sola.</li>
          <li><b className="text-ink">5.</b> Si es un socio nuevo, el pago aparece en <b>Pagos por activar</b> para que lo registres.</li>
        </ol>
      </Card>
    </div>
  )
}
