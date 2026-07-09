import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Estado de la clave de conexión de hardware del gym (prefijo + uso, sin la clave).
export function useEstadoApiKey(empresaId) {
  return useQuery({
    queryKey: ['api-key', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_api_key')
      if (error) throw error
      return data // { existe, prefix?, creada_at?, ultima_usada?, motivo? }
    },
  })
}

// Genera (o rota) la clave. Devuelve la clave EN CLARO una única vez.
export function useGenerarApiKey(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generar_api_key')
      if (error) throw error
      return data // { api_key, prefix }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-key', empresaId] }),
  })
}

// Revoca la clave (desconecta el hardware del gym).
export function useRevocarApiKey(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('revocar_api_key')
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-key', empresaId] }),
  })
}
