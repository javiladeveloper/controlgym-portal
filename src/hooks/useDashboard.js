import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { fechaLocal } from '../lib/uiHelpers.js'

// Clave de día local (YYYY-M-D) para agrupar sin desfase de zona horaria.
function claveDiaLocal(f) {
  const d = fechaLocal(f)
  if (!d) return null
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// KPIs del dashboard para una sede (usa la vista v_dashboard_sede).
export function useDashboardKpis(sedeId) {
  return useQuery({
    queryKey: ['dashboard-kpis', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_dashboard_sede')
        .select('*')
        .eq('sede_id', sedeId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Aforo en vivo (RPC aforo_actual): { dentro, aforo_max, pct }. Si la sede no
// configuró aforo, aforo_max viene null — el consumidor decide no renderizar.
// retry:false porque si la sede no existe la RPC lanza y no queremos reintentar
// en loop; refetchInterval de 30s para que la tarjeta se sienta "en vivo".
export function useAforo(sedeId) {
  return useQuery({
    queryKey: ['aforo-actual', sedeId],
    enabled: !!sedeId,
    retry: false,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('aforo_actual', { p_sede_id: sedeId })
      if (error) throw error
      return data // { dentro, aforo_max, pct }
    },
  })
}

// Últimos check-ins de la sede (para el panel "en vivo").
export function useCheckins(sedeId) {
  return useQuery({
    queryKey: ['checkins', sedeId],
    enabled: !!sedeId,
    refetchInterval: 15_000, // refresco periódico (sustituye al setInterval simulado)
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checkin')
        .select('id, ocurrido_en, direccion, resultado, motivo, metodo, socio:socio(nombre, foto_url, foto_estado)')
        .eq('sede_id', sedeId)
        .order('ocurrido_en', { ascending: false })
        .limit(7)
      if (error) throw error
      return data
    },
  })
}
