import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

// Reporte comercial: ranking de vendedores (ventas del período, cobros,
// leads asignados/convertidos) y avance de hoy vs meta diaria. Por defecto
// trae el mes actual si no se pasa desde/hasta. Es por EMPRESA, no por sede.
export function useReporteComercial(desde, hasta) {
  return useQuery({
    queryKey: ['rep-comercial', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reporte_comercial', { p_desde: desde, p_hasta: hasta })
      if (error) throw error
      return data || { vendedores: [], por_dia_hoy: [] }
    },
    retry: false,
  })
}

// Meta diaria de venta de UN vendedor (para pintar/editar su ficha en
// Personal). Lectura directa por RLS (meta_vendedor_select); si no tiene fila
// aún, monto_diario queda en 0 (sin meta).
export function useMetaVendedor(usuarioId) {
  return useQuery({
    queryKey: ['meta-vendedor', usuarioId],
    enabled: !!usuarioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('meta_vendedor')
        .select('monto_diario, leads_diarios')
        .eq('usuario_id', usuarioId)
        .maybeSingle()
      if (error) throw error
      return { monto: Number(data?.monto_diario || 0), leads: Number(data?.leads_diarios || 0) }
    },
    retry: false,
  })
}

// Fija (o quita, con 0) la meta diaria de venta de un vendedor. Solo admin
// (lo valida la RPC). Invalida su meta + el reporte comercial (por_dia_hoy).
export function useGuardarMetaVendedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ usuarioId, montoDiario, leadsDiarios }) => {
      const { error } = await supabase.rpc('guardar_meta_vendedor', {
        p_usuario_id: usuarioId,
        p_monto_diario: montoDiario,
        p_leads_diarios: leadsDiarios ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_data, { usuarioId }) => {
      qc.invalidateQueries({ queryKey: ['meta-vendedor', usuarioId] })
      qc.invalidateQueries({ queryKey: ['rep-comercial'] })
    },
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
