import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

// Aviso de suscripción en el panel: días de prueba restantes (últimos 10),
// prueba vencida o pago pendiente. Lleva a Configuración → Mi plan.
export default function TrialBanner() {
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

  const s = sus.data
  if (!s || pathname === '/configuracion') return null

  const dias = s.trial_hasta ? Math.max(0, Math.ceil((new Date(s.trial_hasta) - Date.now()) / 86400000)) : 0
  const esAdmin = rol === 'admin'

  let texto = null
  let cls = ''
  if (s.estado === 'prueba' && dias <= 10) {
    texto = dias === 0
      ? 'Tu prueba gratis termina hoy.'
      : `Te quedan ${dias} ${dias === 1 ? 'día' : 'días'} de prueba gratis.`
    cls = 'bg-amber-50 border-amber-200 text-amber-800'
  } else if (s.estado === 'vencida') {
    texto = 'Tu prueba gratis terminó — activa tu plan para seguir sin interrupciones.'
    cls = 'bg-red-50 border-red-200 text-red'
  } else if (s.estado === 'pendiente_pago') {
    texto = 'Tu último pago no se procesó — revisa tu tarjeta.'
    cls = 'bg-amber-50 border-amber-200 text-amber-800'
  }
  if (!texto) return null

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-7 py-2.5 ${cls}`}>
      <span className="text-[12.5px] font-bold">{texto}</span>
      {esAdmin && (
        <Link to="/configuracion" className="rounded-full bg-orange px-4 py-1.5 text-[12px] font-extrabold text-white hover:bg-orange-600">
          Activar mi plan →
        </Link>
      )}
    </div>
  )
}
