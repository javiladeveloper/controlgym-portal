import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

// Aviso de suscripción en el panel: deuda del plan por miembro, días de prueba
// restantes (últimos 10), prueba vencida o pago pendiente. Lleva a Mi plan.
//
// La deuda manda sobre el resto: es lo único con fecha límite y bloqueo detrás.
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

  // Facturas del plan 'miembros' sin pagar. Vacío para todos los demás planes.
  const facturas = useQuery({
    queryKey: ['mis-facturas-pendientes', empresa?.id],
    enabled: !!empresa?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('mis_facturas_pendientes')
      if (error) throw error
      return data || []
    },
  })

  const s = sus.data
  if (pathname === '/configuracion') return null

  const esAdmin = rol === 'admin'
  const deuda = facturas.data || []

  // ── Deuda del plan por miembro: lo más urgente, va primero ────────────────
  if (deuda.length > 0) {
    const total = deuda.reduce((n, f) => n + Number(f.monto || 0), 0)
    const socios = deuda.reduce((n, f) => n + Number(f.socios || 0), 0)
    const vencida = deuda.some((f) => f.estado === 'vencida')
    const dias = Math.min(...deuda.map((f) => Number(f.dias_restantes ?? 0)))

    // Al staff no-admin no se le muestra el monto: no puede pagarlo y no es su
    // información. Se le dice qué pasa y a quién avisar.
    const texto = !esAdmin
      ? vencida
        ? 'Los cobros están pausados por un tema de facturación — avísale al administrador del negocio.'
        : 'Hay una cuenta por pagar del negocio — avísale al administrador.'
      : vencida
        ? `Tu sede está en modo solo lectura: debes S/ ${total} por ${socios} socios activos.`
        : dias <= 0
          ? `Debes S/ ${total} por ${socios} socios activos — hoy es el último día para pagar.`
          : `Debes S/ ${total} por ${socios} socios activos — te ${dias === 1 ? 'queda 1 día' : `quedan ${dias} días`} para pagar.`

    return (
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-7 py-2.5 ${
        vencida ? 'bg-red-50 border-red-200 text-red' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
        <span className="text-[12.5px] font-bold">{texto}</span>
        {esAdmin && (
          <Link to="/configuracion?tab=plan" className="rounded-full bg-orange px-4 py-1.5 text-[12px] font-extrabold text-white hover:bg-orange-600">
            Pagar ahora →
          </Link>
        )}
      </div>
    )
  }

  if (!s) return null
  const dias = s.trial_hasta ? Math.max(0, Math.ceil((new Date(s.trial_hasta) - Date.now()) / 86400000)) : 0

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
