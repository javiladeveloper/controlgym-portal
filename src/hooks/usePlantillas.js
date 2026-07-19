import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
        .select(`id, empresa_id, objetivo_id, nombre, notas, duracion_semanas, objetivo:objetivo_entrenamiento(codigo, nombre),
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

// Plantillas de DIETA por objetivo (global + las personalizadas del gym), con
// sus comidas: la pestaña "Plantillas" permite editarlas (PlantillaDietaEditor).
export function usePlantillasDieta(empresaId) {
  return useQuery({
    queryKey: ['plantillas-dieta', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plantilla_dieta')
        .select(`id, empresa_id, objetivo_id, nombre, suplementos, duracion_semanas,
          objetivo:objetivo_entrenamiento(codigo, nombre),
          comidas:plantilla_comida(id, nombre, hora, descripcion, kcal, orden, dia_semana)`)
        .order('nombre')
      if (error) throw error
      data?.forEach((d) => {
        d.comidas?.sort((a, b) =>
          (a.dia_semana ?? 0) - (b.dia_semana ?? 0) || (a.orden ?? 0) - (b.orden ?? 0))
      })
      return data
    },
  })
}

// Invalida ambas listas de plantillas tras una escritura.
function invalidarPlantillas(qc, empresaId) {
  qc.invalidateQueries({ queryKey: ['plantillas-rutina', empresaId] })
  qc.invalidateQueries({ queryKey: ['plantillas-dieta', empresaId] })
}

// Copy-on-write: devuelve el id de la plantilla DEL GYM. Si la que se pasa es
// global, la copia (días+ejercicios / comidas); si ya era del gym, devuelve la
// misma. Idempotente: pulsar dos veces no duplica.
export function usePersonalizarPlantilla(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plantillaId, tipo }) => {
      const { data, error } = await supabase.rpc('plantilla_personalizar', {
        p_plantilla_id: plantillaId, p_tipo: tipo })
      if (error) throw error
      return data // uuid de la plantilla del gym
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

// Duración sugerida de la plantilla (4/8/12/16 o null). Solo sobre plantilla del gym.
export function useSetDuracionPlantilla(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plantillaId, tipo, semanas }) => {
      const { error } = await supabase.rpc('plantilla_set_duracion', {
        p_plantilla_id: plantillaId, p_tipo: tipo, p_semanas: semanas })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

export function useComidaAgregar(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ plantillaDietaId, nombre, hora, descripcion, kcal, diaSemana }) => {
      const { error } = await supabase.rpc('plantilla_comida_agregar', {
        p_plantilla_dieta_id: plantillaDietaId, p_nombre: nombre, p_hora: hora || null,
        p_descripcion: descripcion || null, p_kcal: kcal ?? null, p_dia_semana: diaSemana ?? null })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

export function useComidaEditar(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, nombre, hora, descripcion, kcal }) => {
      const { error } = await supabase.rpc('plantilla_comida_editar', {
        p_comida_id: id, p_nombre: nombre, p_hora: hora || null,
        p_descripcion: descripcion || null, p_kcal: kcal ?? null })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}

export function useComidaQuitar(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.rpc('plantilla_comida_quitar', { p_comida_id: id })
      if (error) throw error
    },
    onSuccess: () => invalidarPlantillas(qc, empresaId),
  })
}
