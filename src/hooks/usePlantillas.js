import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Catálogo de objetivos con plan automático (rutina+dieta por objetivo, modulado
// por IMC). Lectura global (RLS: select true para authenticated).
export function useObjetivos() {
  return useQuery({
    queryKey: ['objetivos'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('objetivo_entrenamiento')
        .select('id, codigo, nombre, tiene_plan')
        .order('orden')
      if (error) throw error
      return data
    },
  })
}

// Plantillas de RUTINA por objetivo (global + las personalizadas del gym),
// con sus días y ejercicios: la pestaña "Plantillas" las lista Y permite
// editar los ejercicios de la plantilla PROPIA del gym (agregar/editar/quitar
// vía RPCs plantilla_*_ejercicio — la global es de solo lectura).
export function usePlantillasRutina(empresaId) {
  return useQuery({
    queryKey: ['plantillas-rutina', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plantilla_rutina')
        .select(`id, empresa_id, objetivo_id, nombre, notas, objetivo:objetivo_entrenamiento(codigo, nombre),
          dias:plantilla_rutina_dia(id, dia_semana, foco,
            ejercicios:plantilla_rutina_ejercicio(id, nombre, series, reps, descanso, carga, orden, notas))`)
        .order('nombre')
      if (error) throw error
      data?.forEach((r) => {
        r.dias?.sort((a, b) => a.dia_semana - b.dia_semana)
        r.dias?.forEach((d) => d.ejercicios?.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)))
      })
      return data
    },
  })
}

// Plantillas de DIETA por objetivo (global + las personalizadas del gym).
export function usePlantillasDieta(empresaId) {
  return useQuery({
    queryKey: ['plantillas-dieta', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plantilla_dieta')
        .select('id, empresa_id, objetivo_id, nombre, suplementos, objetivo:objetivo_entrenamiento(codigo, nombre)')
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}
