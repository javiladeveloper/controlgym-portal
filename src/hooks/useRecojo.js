import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Productos comprados por app, aprobados y pendientes de que el socio los recoja.
export function useProductosPorEntregar(sedeId) {
  return useQuery({
    queryKey: ['productos-por-entregar', sedeId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('productos_por_entregar')
      if (error) throw error
      return data || []
    },
  })
}

// Marca un producto como entregado (el stock ya se descontó al pagar).
export function useEntregarProducto(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (pagoId) => {
      const { error } = await supabase.rpc('entregar_producto', { p_pago_id: pagoId })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['productos-por-entregar', sedeId] }),
  })
}

// Cancela una compra no entregada: repone stock y marca reembolsado.
export function useCancelarCompra(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pagoId, motivo }) => {
      const { error } = await supabase.rpc('cancelar_compra_producto', { p_pago_id: pagoId, p_motivo: motivo ?? null })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productos-por-entregar', sedeId] })
      qc.invalidateQueries({ queryKey: ['kardex', sedeId] })
    },
  })
}
