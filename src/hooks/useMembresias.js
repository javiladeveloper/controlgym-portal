import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Planes de la empresa (nivel empresa, sin sede).
export function usePlanes() {
  return useQuery({
    queryKey: ['planes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan')
        .select('*')
        .is('deleted_at', null)
        .order('orden')
      if (error) throw error
      return data
    },
  })
}

// Membresías de una sede con socio y plan.
export function useMembresias(sedeId) {
  return useQuery({
    queryKey: ['membresias', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('membresia')
        .select('id, estado, fecha_fin, socio:socio!membresia_socio_id_fkey(id, nombre, codigo, telefono), plan:plan(nombre, precio, unidad, dias_congelamiento_anio)')
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('fecha_fin')
      if (error) throw error
      return data
    },
  })
}

// Congelar / reactivar (RPC valida el tope del plan). Optimista.
export function useToggleFreeze(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ membresiaId, dias }) => {
      const { data, error } = await supabase.rpc('freeze_membership', {
        p_membresia_id: membresiaId,
        p_dias: dias ?? null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
      qc.invalidateQueries({ queryKey: ['clientes', sedeId] })
    },
  })
}

// Anular membresía (RPC: estado cancelada; opcional devolución a caja).
export function useAnularMembresia(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ membresiaId, devolver }) => {
      const { data, error } = await supabase.rpc('anular_membresia', {
        p_membresia_id: membresiaId,
        p_devolver: !!devolver,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
      qc.invalidateQueries({ queryKey: ['clientes', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas'] })
    },
  })
}

// Renovar (RPC crea el ingreso en caja).
export function useRenovar(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ membresiaId, metodo = 'efectivo' }) => {
      const { data, error } = await supabase.rpc('renew_membership', { p_membresia_id: membresiaId, p_metodo_pago: metodo })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
      qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    },
  })
}
