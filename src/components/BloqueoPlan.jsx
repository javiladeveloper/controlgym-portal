import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { usePanel } from '../store.jsx'
import { supabase } from '../lib/supabaseClient.js'

// Candado del plan: si la suscripción del negocio está vencida o cancelada,
// el panel se bloquea (no se puede operar sin pagar). Solo queda accesible
// Configuración, donde vive "Mi plan" para activarlo.
export default function BloqueoPlan({ children }) {
  const { empresa, rol } = useAuth()
  const { sedeId } = usePanel()
  const { pathname } = useLocation()

  // Estado de la SEDE activa (billing por sede): si tiene suscripción propia,
  // manda; si no, hereda la de la empresa. Una sede vencida bloquea aunque
  // otra del mismo gym esté al día.
  const sus = useQuery({
    queryKey: ['suscripcion-sede', sedeId],
    enabled: !!sedeId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_suscripcion_sede', { p_sede_id: sedeId })
      if (error) throw error
      return data
    },
  })

  const bloqueado = ['vencida', 'cancelada'].includes(sus.data?.estado)

  // Solo lectura por factura impaga: NO se bloquea el panel (el gym ve sus
  // datos), pero sí se avisa en todas las pantallas. Sin esto el recepcionista
  // aprieta "Cobrar" y le explota el error crudo del trigger sin saber por qué.
  if (!bloqueado && sus.data?.solo_lectura) {
    return (
      <>
        <div className="border-b border-red-200 bg-red-50 px-7 py-2.5">
          <span className="text-[12.5px] font-bold text-red">
            🔒 Modo solo lectura: no se puede cobrar, inscribir socios ni marcar asistencia.{' '}
            {rol === 'admin'
              ? <>Regulariza el pago en <Link to="/configuracion?tab=plan" className="underline">Configuración → Mi plan</Link>.</>
              : 'Avísale al administrador del negocio para regularizar el pago.'}
          </span>
        </div>
        {children}
      </>
    )
  }

  // El Dashboard global (/plataforma) NO se bloquea nunca: es la pantalla del
  // dueño de FitCore, no del gimnasio. Bloquearla por una sede vencida dejaba
  // al owner sin poder moderar las rutinas de la comunidad solo porque su gym
  // de pruebas tenía el plan caducado — dos cosas que no tienen relación.
  if (!bloqueado || pathname.startsWith('/configuracion') || pathname.startsWith('/plataforma')) {
    return children
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-[430px] rounded-card border border-line bg-white p-8 text-center shadow-[0_10px_40px_rgba(20,27,46,0.08)]">
        <div className="text-[46px]">🔒</div>
        <h2 className="mt-3 text-[19px] font-extrabold">Esta sede está pausada</h2>
        <p className="mx-auto mt-2 max-w-[340px] text-[13px] font-semibold leading-relaxed text-muted">
          {sus.data?.estado === 'cancelada'
            ? 'La suscripción de este negocio fue cancelada.'
            : 'El período de prueba terminó y el plan aún no está activo.'}{' '}
          Tus datos están guardados y seguros — se reactivan al instante cuando actives el plan.
        </p>
        {rol === 'admin' ? (
          <Link to="/configuracion?tab=plan"
            className="mt-6 inline-block rounded-[11px] bg-orange px-7 py-3 text-[14px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] hover:bg-orange-600">
            Activar mi plan →
          </Link>
        ) : (
          <p className="mt-5 rounded-[10px] bg-surface px-4 py-3 text-[12.5px] font-bold text-muted">
            Avísale al administrador del negocio para que active el plan.
          </p>
        )}
      </div>
    </div>
  )
}
