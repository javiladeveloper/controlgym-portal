import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

export const ETAPAS = ['nuevo', 'contactado', 'clase_prueba', 'inscrito']
export const ETAPA_LABEL = { nuevo: 'Nuevo', contactado: 'Contactado', clase_prueba: 'Clase de prueba', inscrito: 'Inscrito' }

export function useLeads(sedeId) {
  return useQuery({
    queryKey: ['leads', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead')
        .select('id, nombre, fuente, etapa, nota, created_at')
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useAvanzarLead(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, etapa }) => {
      const idx = ETAPAS.indexOf(etapa)
      const next = ETAPAS[Math.min(idx + 1, ETAPAS.length - 1)]
      const { error } = await supabase.from('lead').update({ etapa: next }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, etapa }) => {
      await qc.cancelQueries({ queryKey: ['leads', sedeId] })
      const prev = qc.getQueryData(['leads', sedeId])
      const idx = ETAPAS.indexOf(etapa)
      const next = ETAPAS[Math.min(idx + 1, ETAPAS.length - 1)]
      qc.setQueryData(['leads', sedeId], (old) => (old || []).map((l) => (l.id === id ? { ...l, etapa: next } : l)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['leads', sedeId], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads', sedeId] }),
  })
}

export function useTareas(sedeId) {
  return useQuery({
    queryKey: ['lead-tareas', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead_tarea')
        .select('id, tipo, detalle, vence_at, completada, lead:lead(nombre)')
        .order('vence_at')
      if (error) throw error
      return data
    },
  })
}

export function useToggleTarea(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, completada }) => {
      const { error } = await supabase.from('lead_tarea').update({ completada }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, completada }) => {
      await qc.cancelQueries({ queryKey: ['lead-tareas', sedeId] })
      const prev = qc.getQueryData(['lead-tareas', sedeId])
      qc.setQueryData(['lead-tareas', sedeId], (old) => (old || []).map((t) => (t.id === id ? { ...t, completada } : t)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['lead-tareas', sedeId], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['lead-tareas', sedeId] }),
  })
}
