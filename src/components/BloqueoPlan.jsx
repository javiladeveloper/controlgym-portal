import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

// Candado del plan: si la suscripción del negocio está vencida o cancelada,
// el panel se bloquea (no se puede operar sin pagar). Solo queda accesible
// Configuración, donde vive "Mi plan" para activarlo.
export default function BloqueoPlan({ children }) {
  const { empresa, rol } = useAuth()
  const { pathname } = useLocation()

  const sus = useQuery({
    queryKey: ['mi-suscripcion', empresa?.id],
    enabled: !!empresa?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_mi_suscripcion')
      if (error) throw error
      return data
    },
  })

  const bloqueado = ['vencida', 'cancelada'].includes(sus.data?.estado)
  if (!bloqueado || pathname.startsWith('/configuracion')) return children

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="w-full max-w-[430px] rounded-card border border-line bg-white p-8 text-center shadow-[0_10px_40px_rgba(20,27,46,0.08)]">
        <div className="text-[46px]">🔒</div>
        <h2 className="mt-3 text-[19px] font-extrabold">{empresa?.nombre} está pausado</h2>
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
