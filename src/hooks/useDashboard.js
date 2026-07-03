import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

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

// Asistencia por hora (RPC).
export function useAsistenciaPorHora(sedeId) {
  return useQuery({
    queryKey: ['asistencia-hora', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_asistencia_por_hora', { p_sede_id: sedeId })
      if (error) throw error
      return data // [{hora, total}]
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
        .select('id, ocurrido_en, direccion, resultado, motivo, socio:socio(nombre)')
        .eq('sede_id', sedeId)
        .order('ocurrido_en', { ascending: false })
        .limit(7)
      if (error) throw error
      return data
    },
  })
}
