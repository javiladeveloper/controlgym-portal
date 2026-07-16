import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Pisos de una sede (con su plano).
export function usePisos(sedeId) {
  return useQuery({
    queryKey: ['pisos', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pisos_de_sede', { p_sede_id: sedeId })
      if (error) throw error
      return data || []
    },
  })
}

// Crea/edita un piso (upsert por id). plano_url ya subido con subirImagen.
export function useGuardarPiso(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, empresa_id, nombre, orden, plano_url }) => {
      const row = { sede_id: sedeId, empresa_id, nombre, orden: orden ?? 0, plano_url: plano_url ?? null }
      const q = id
        ? supabase.from('sede_piso').update(row).eq('id', id)
        : supabase.from('sede_piso').insert(row)
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pisos', sedeId] }),
  })
}

export function useBorrarPiso(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('sede_piso').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pisos', sedeId] }),
  })
}

// Máquinas de la sede (todas — con piso_id/pos_x/pos_y para saber cuáles ubicar).
export function useMaquinasSede(sedeId) {
  return useQuery({
    queryKey: ['maquinas-croquis', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.from('maquina')
        .select('id, nombre, zona, estado, piso_id, pos_x, pos_y')
        .eq('sede_id', sedeId).is('deleted_at', null).order('nombre')
      if (error) throw error
      return data || []
    },
  })
}

// Ubicar/mover una máquina (x/y en %).
export function useUbicarMaquina(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ maquinaId, pisoId, x, y }) => {
      const { error } = await supabase.rpc('ubicar_maquina', {
        p_maquina_id: maquinaId, p_piso_id: pisoId, p_pos_x: x, p_pos_y: y })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maquinas-croquis', sedeId] }),
  })
}
