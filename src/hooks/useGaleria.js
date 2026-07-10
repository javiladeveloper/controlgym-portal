import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Fotos sociales pendientes de moderar (para el panel del gym).
export function useFotosPendientes(empresaId) {
  return useQuery({
    queryKey: ['fotos-pendientes', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('foto_social')
        .select('id, autor, evento, foto_url, creado_at')
        .eq('empresa_id', empresaId)
        .eq('estado', 'pendiente')
        .order('creado_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

export function useModerarFoto(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ fotoId, aprobar }) => {
      const { error } = await supabase.rpc('moderar_foto_social', { p_foto_id: fotoId, p_aprobar: aprobar })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fotos-pendientes', empresaId] }),
  })
}
