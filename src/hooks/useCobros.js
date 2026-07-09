import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Estado de conexión de cobros MercadoPago del gym (sin exponer tokens).
export function useEstadoCobros(empresaId) {
  return useQuery({
    queryKey: ['cobros-mp', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_cobros_mp')
      if (error) throw error
      return data // { conectado, mp_user_id?, conectado_at?, motivo? }
    },
  })
}

// Inicia el OAuth de MercadoPago: pide la URL de autorización al backend
// (con el JWT del admin) y redirige el navegador a MercadoPago.
export async function conectarCobros() {
  const { data: sess } = await supabase.auth.getSession()
  const res = await fetch('/api/mp/oauth-start', {
    headers: { authorization: `Bearer ${sess?.session?.access_token || ''}` },
  })
  const out = await res.json()
  if (!res.ok) throw new Error(out.error || 'No se pudo iniciar la conexión')
  window.location.href = out.url // → MercadoPago; vuelve por oauth-callback
}

// Desconecta los cobros (borra la conexión del gym).
export function useDesconectarCobros(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('desconectar_cobros_mp')
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cobros-mp', empresaId] }),
  })
}

// Pagos hechos por app que esperan activación (socios nuevos que pagaron pero
// aún no existen como socio del gym). Devuelve la lista para que recepción los
// active. Solo lectura; la activación es otra RPC.
export function usePagosPorActivar(empresaId) {
  return useQuery({
    queryKey: ['pagos-por-activar', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pagos_por_activar')
      if (error) throw error
      return data || []
    },
  })
}

// Activa un pago (crea el socio + su membresía). Refresca la lista al terminar.
export function useActivarPago(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pagoId, sedeId, planId }) => {
      const { data, error } = await supabase.rpc('activar_pago_app', {
        p_pago_id: pagoId,
        p_sede_id: sedeId ?? null,
        p_plan_id: planId ?? null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pagos-por-activar', empresaId] })
      qc.invalidateQueries({ queryKey: ['clientes'] })
    },
  })
}
