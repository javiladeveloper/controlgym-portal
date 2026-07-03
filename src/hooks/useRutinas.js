import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Socios de la sede para el selector.
export function useSociosSelect(sedeId) {
  return useQuery({
    queryKey: ['socios-select', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('socio')
        .select('id, nombre, codigo, talla_m, peso_kg, objetivo')
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

// Dieta (con comidas) activa de un socio; crea una vacía si no existe al guardar.
export function useDietaSocio(socioId) {
  return useQuery({
    queryKey: ['dieta', socioId],
    enabled: !!socioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dieta')
        .select('id, nombre, enviado_at, comida:comida(id, nombre, hora, descripcion, kcal, orden)')
        .eq('socio_id', socioId)
        .eq('activa', true)
        .order('orden', { foreignTable: 'comida' })
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Guardar comidas (upsert) y marcar enviado.
export function useEnviarPlan(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dietaId, comidas }) => {
      if (dietaId && comidas?.length) {
        const rows = comidas.map((c) => ({ id: c.id, empresa_id: c.empresa_id, dieta_id: dietaId, nombre: c.nombre, hora: c.hora, descripcion: c.descripcion, kcal: c.kcal, orden: c.orden }))
        const { error } = await supabase.from('comida').upsert(rows)
        if (error) throw error
        const { error: e2 } = await supabase.from('dieta').update({ enviado_at: new Date().toISOString() }).eq('id', dietaId)
        if (e2) throw e2
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dieta', socioId] }),
  })
}
