import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Cámaras del gym (para una sede, o todas si sedeId es null). Solo admin/recepción
// las lee (RLS). Ordenadas para mostrar en grilla.
export function useCamaras(empresaId, sedeId) {
  return useQuery({
    queryKey: ['camaras', empresaId, sedeId],
    enabled: !!empresaId,
    queryFn: async () => {
      let q = supabase.from('camara')
        .select('id, sede_id, nombre, url_embed, orden, activa')
        .eq('empresa_id', empresaId)
        .order('orden')
        .order('nombre')
      if (sedeId) q = q.eq('sede_id', sedeId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

export function useGuardarCamara(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cam) => {
      const payload = {
        empresa_id: empresaId, sede_id: cam.sede_id || null,
        nombre: cam.nombre.trim(), url_embed: cam.url_embed.trim(),
        activa: cam.activa ?? true, orden: cam.orden ?? 0,
        updated_at: new Date().toISOString(),
      }
      if (cam.id) {
        const { error } = await supabase.from('camara').update(payload).eq('id', cam.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('camara').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['camaras', empresaId] }),
  })
}

export function useEliminarCamara(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('camara').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['camaras', empresaId] }),
  })
}
