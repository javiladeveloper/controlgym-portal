import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Clases del horario semanal de una sede.
export function useClases(sedeId) {
  return useQuery({
    queryKey: ['clases', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clase')
        .select('id, nombre, dia_semana, hora, cupo_max, activa, duracion_min, tipo_clase_id, sala_id, instructor_id, instructor_nombre, instructor:usuario(nombre), tipo:tipo_clase(nombre, color)')
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('dia_semana').order('hora')
      if (error) throw error
      return data
    },
  })
}

// Pausar / activar una clase (optimista).
export function useToggleClase(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, activa }) => {
      const { error } = await supabase.from('clase').update({ activa }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, activa }) => {
      await qc.cancelQueries({ queryKey: ['clases', sedeId] })
      const prev = qc.getQueryData(['clases', sedeId])
      qc.setQueryData(['clases', sedeId], (old) => (old || []).map((c) => (c.id === id ? { ...c, activa } : c)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['clases', sedeId], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['clases', sedeId] }),
  })
}

// Matriz de acceso a clases por plan (plan × tipo_clase).
export function usePlanAcceso() {
  return useQuery({
    queryKey: ['plan-acceso'],
    queryFn: async () => {
      const [{ data: planes }, { data: tipos }, { data: acceso }] = await Promise.all([
        supabase.from('plan').select('id, nombre').is('deleted_at', null).order('orden'),
        supabase.from('tipo_clase').select('id, nombre, color, acceso_libre').order('nombre'),
        supabase.from('plan_acceso_clase').select('plan_id, tipo_clase_id, incluido'),
      ])
      return { planes: planes || [], tipos: tipos || [], acceso: acceso || [] }
    },
  })
}

export function useToggleAcceso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ empresaId, planId, tipoId, incluido }) => {
      const { error } = await supabase
        .from('plan_acceso_clase')
        .upsert({ empresa_id: empresaId, plan_id: planId, tipo_clase_id: tipoId, incluido }, { onConflict: 'plan_id,tipo_clase_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plan-acceso'] }),
  })
}

// Salas con su grilla de posiciones (para reservas con lugar asignado).
export function useSalas(sedeId) {
  return useQuery({
    queryKey: ['salas', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sala')
        .select('id, nombre, filas, columnas, sede_id, posiciones:sala_posicion(id, fila, columna, etiqueta, activa)')
        .eq('sede_id', sedeId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}
