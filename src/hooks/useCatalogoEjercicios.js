import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Busca en el catálogo global. filtros = { texto, body_part, equipment, target, offset, limit }
export function useBuscarEjercicios(filtros = {}) {
  const { texto, body_part, equipment, target, offset = 0, limit = 30 } = filtros
  return useQuery({
    queryKey: ['catalogo-ejercicios', texto, body_part, equipment, target, offset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('buscar_ejercicios_catalogo', {
        p_texto: texto || null, p_body_part: body_part || null,
        p_equipment: equipment || null, p_target: target || null,
        p_offset: offset, p_limit: limit,
      })
      if (error) throw error
      return data || []
    },
  })
}

// Detalle de un ejercicio (pasos en español por defecto).
export function useEjercicioDetalle(id, idioma = 'es') {
  return useQuery({
    queryKey: ['catalogo-ejercicio', id, idioma],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ejercicio_catalogo_detalle', { p_id: id, p_idioma: idioma })
      if (error) throw error
      return data
    },
  })
}
