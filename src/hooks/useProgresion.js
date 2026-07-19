import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Socios cuya rutina activa vence en ≤3 días o ya venció (RPC de la Parte C).
export function useRutinasPorVencer(sedeId) {
  return useQuery({
    queryKey: ['rutinas-por-vencer', sedeId],
    enabled: !!sedeId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rutinas_por_vencer', { p_sede_id: sedeId })
      if (error) throw error
      return data || []
    },
  })
}

// Progreso del socio en el periodo de su rutina activa (peso, asistencia,
// adherencia por día y por ejercicio). RPC de la Parte D1 — alimenta el panel
// "Ver progreso y renovar" y las sugerencias de sugerenciasDeProgreso().
export function useProgresoSocio(socioId) {
  return useQuery({
    queryKey: ['progreso-socio', socioId],
    enabled: !!socioId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('progreso_socio', { p_socio_id: socioId })
      if (error) throw error
      return data || {}
    },
  })
}

// Renovar la rutina del socio: fija vigencia a la rutina indicada (ya
// creada/editada por el trainer) y enlaza la anterior vía rutina_anterior_id.
// Reusa el mismo RPC que useAsignarVigencia (asignar_rutina_con_vigencia) —
// la Parte D no inventa un flujo nuevo, solo lo dispara desde el panel de progreso.
export function useRenovarRutina(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ rutinaId, semanas }) => {
      const { data, error } = await supabase.rpc('asignar_rutina_con_vigencia', {
        p_rutina_id: rutinaId, p_duracion_semanas: semanas })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rutina', socioId] })
      qc.invalidateQueries({ queryKey: ['progreso-socio', socioId] })
      qc.invalidateQueries({ queryKey: ['rutinas-por-vencer'] })
    },
  })
}
