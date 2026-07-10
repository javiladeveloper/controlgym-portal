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

// Plantillas de RUTINA por objetivo (global + las personalizadas del gym).
// Solo lectura para v1: la pestaña "Plantillas" las LISTA; el editor de
// ejercicios/comidas de la plantilla queda pendiente para una task futura.
export function usePlantillasRutina(empresaId) {
  return useQuery({
    queryKey: ['plantillas-rutina', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plantilla_rutina')
        .select('id, empresa_id, objetivo_id, nombre, notas, objetivo:objetivo_entrenamiento(codigo, nombre)')
        .order('nombre')
      if (error) throw error
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
