import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Serie diaria de ventas (con desglose por método de pago). Por defecto trae
// los últimos 30 días si no se pasa desde/hasta.
export function useVentasSerie(sedeId, desde, hasta) {
  return useQuery({
    queryKey: ['rep-ventas', sedeId, desde, hasta],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reporte_ventas_serie', {
        p_sede_id: sedeId, p_desde: desde, p_hasta: hasta,
      })
      if (error) throw error
      return (data || []).map((r) => ({
        ...r,
        total: Number(r.total),
        por_metodo: Object.fromEntries(Object.entries(r.por_metodo || {}).map(([k, v]) => [k, Number(v)])),
      }))
    },
    retry: false,
  })
}

// KPIs de socios: nuevos últimos 30 días, churn 6 meses, proyección del mes,
// congeladas y total de activos.
export function useSociosKpis(sedeId) {
  return useQuery({
    queryKey: ['rep-socios', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reporte_socios_kpis', { p_sede_id: sedeId })
      if (error) throw error
      return data || null
    },
    retry: false,
  })
}

// Socios ausentes (sin marcar entrada) hace `dias` días o más. Los que nunca
// vinieron traen ultima_visita/dias_ausente = null y van primero.
export function useAusentes(sedeId, dias = 15) {
  return useQuery({
    queryKey: ['rep-ausentes', sedeId, dias],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reporte_ausentes', { p_sede_id: sedeId, p_dias: dias })
      if (error) throw error
      return data || []
    },
    retry: false,
  })
}
