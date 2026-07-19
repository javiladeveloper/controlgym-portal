import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Socios cuya rutina activa vence en ≤3 días o ya venció (RPC de la Parte C).
export function useRutinasPorVencer(sedeId) {
  return useQuery({
    queryKey: ['rutinas-por-vencer', sedeId],
    enabled: !!sedeId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rutinas_por_vencer', { p_sede_id: sedeId })
      if (error) throw error
      return data || []
    },
  })
}
