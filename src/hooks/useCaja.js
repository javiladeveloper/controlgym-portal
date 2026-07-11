import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Gasto de caja chica (agua, taxi, compras menores). La RPC valida monto,
// motivo y que la caja del día esté abierta.
export function useRegistrarGastoCaja(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ monto, motivo, metodoPago }) => {
      const { data, error } = await supabase.rpc('registrar_gasto_caja', {
        p_sede_id: sedeId,
        p_monto: monto,
        p_motivo: motivo,
        p_metodo_pago: metodoPago || 'efectivo',
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    },
  })
}

// Cierres de caja pasados, más recientes primero, con quién abrió/cerró.
// Lectura directa (RLS de caja ya permite leer al panel, igual que CajaDelDia).
export function useHistorialCaja(sedeId, limite = 30) {
  return useQuery({
    queryKey: ['historial-caja', sedeId, limite],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('caja')
        .select('id, fecha, saldo_inicial, efectivo_esperado, saldo_final, arqueo_detalle, abierta:usuario!caja_abierta_por_fkey(nombre), cerrada:usuario!caja_cerrada_por_fkey(nombre)')
        .eq('sede_id', sedeId)
        .eq('estado', 'cerrada')
        .order('fecha', { ascending: false })
        .limit(limite)
      if (error) throw error
      return data
    },
  })
}
