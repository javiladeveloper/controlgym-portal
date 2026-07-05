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

// Rutina semanal activa de un socio (con sus días/focos).
export function useRutinaSocio(socioId) {
  return useQuery({
    queryKey: ['rutina', socioId],
    enabled: !!socioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rutina')
        .select('id, nombre, enviado_at, dias:rutina_dia(id, dia_semana, foco)')
        .eq('socio_id', socioId)
        .eq('activa', true)
        .maybeSingle()
      if (error) throw error
      if (data?.dias) data.dias.sort((a, b) => a.dia_semana - b.dia_semana)
      return data
    },
  })
}

const FOCOS_DEFAULT = ['Pierna y glúteo', 'Pecho y tríceps', 'Espalda y bíceps', 'Hombro y core', 'Full body y cardio']

// Crear rutina semanal con 5 días por defecto.
export function useCrearRutina(socioId, empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data: rutina, error } = await supabase
        .from('rutina')
        .insert({ empresa_id: empresaId, socio_id: socioId, nombre: 'Rutina semanal', activa: true })
        .select('id').single()
      if (error) throw error
      const dias = FOCOS_DEFAULT.map((foco, i) => ({
        empresa_id: empresaId, rutina_id: rutina.id, dia_semana: i + 1, foco,
      }))
      const { error: e2 } = await supabase.from('rutina_dia').insert(dias)
      if (e2) throw e2
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutina', socioId] }),
  })
}

// Cambiar el foco de un día.
export function useSetFoco(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ diaId, foco }) => {
      const { error } = await supabase.from('rutina_dia').update({ foco }).eq('id', diaId)
      if (error) throw error
    },
    onMutate: async ({ diaId, foco }) => {
      await qc.cancelQueries({ queryKey: ['rutina', socioId] })
      const prev = qc.getQueryData(['rutina', socioId])
      qc.setQueryData(['rutina', socioId], (old) => old ? { ...old, dias: old.dias.map((d) => d.id === diaId ? { ...d, foco } : d) } : old)
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['rutina', socioId], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['rutina', socioId] }),
  })
}

// Ejercicios de todos los días de la rutina (la app y el panel comparten filas)
export function useEjerciciosRutina(rutinaId, diasIds) {
  return useQuery({
    queryKey: ['rutina-ejercicios', rutinaId],
    enabled: !!rutinaId && (diasIds?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rutina_ejercicio')
        .select('id, rutina_dia_id, nombre, series, reps, carga, descanso, notas, orden')
        .in('rutina_dia_id', diasIds)
        .order('orden')
      if (error) throw error
      return data
    },
  })
}

// Crear/actualizar un ejercicio del día
export function useGuardarEjercicio(rutinaId, empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ej) => {
      const campos = {
        nombre: (ej.nombre || '').trim(), series: Number(ej.series) || null,
        reps: ej.reps || null, carga: ej.carga || null,
        descanso: ej.descanso || null, notas: ej.notas || null,
      }
      if (!campos.nombre) throw new Error('El ejercicio necesita nombre')
      if (ej.id) {
        const { error } = await supabase.from('rutina_ejercicio').update(campos).eq('id', ej.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('rutina_ejercicio')
          .insert({ ...campos, empresa_id: empresaId, rutina_dia_id: ej.rutina_dia_id, orden: ej.orden ?? 99 })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutina-ejercicios', rutinaId] }),
  })
}

export function useEliminarEjercicio(rutinaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('rutina_ejercicio').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutina-ejercicios', rutinaId] }),
  })
}

const COMIDAS_DEFAULT = [
  { nombre: 'Desayuno', hora: '07:00', descripcion: 'Avena con plátano y claras', kcal: 420, orden: 1 },
  { nombre: 'Media mañana', hora: '10:00', descripcion: 'Yogur griego y almendras', kcal: 180, orden: 2 },
  { nombre: 'Almuerzo', hora: '13:00', descripcion: 'Pollo, arroz integral y ensalada', kcal: 650, orden: 3 },
  { nombre: 'Merienda', hora: '16:30', descripcion: 'Batido de proteína y fruta', kcal: 250, orden: 4 },
  { nombre: 'Cena', hora: '19:30', descripcion: 'Pescado con verduras al vapor', kcal: 600, orden: 5 },
]

// Crear plan de dieta con 5 comidas base editables.
export function useCrearDieta(socioId, empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data: dieta, error } = await supabase
        .from('dieta')
        .insert({ empresa_id: empresaId, socio_id: socioId, nombre: 'Plan de alimentación', activa: true })
        .select('id').single()
      if (error) throw error
      const comidas = COMIDAS_DEFAULT.map((c) => ({ ...c, empresa_id: empresaId, dieta_id: dieta.id }))
      const { error: e2 } = await supabase.from('comida').insert(comidas)
      if (e2) throw e2
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dieta', socioId] }),
  })
}

// Guardar comidas y marcar el plan como enviado a la app del socio.
export function useEnviarPlan(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dietaId, comidas }) => {
      if (!dietaId) return
      for (const c of comidas || []) {
        if (!c.id) continue
        const { error } = await supabase.from('comida')
          .update({ descripcion: c.descripcion, kcal: c.kcal })
          .eq('id', c.id)
        if (error) throw error
      }
      const { error: e2 } = await supabase.from('dieta').update({ enviado_at: new Date().toISOString() }).eq('id', dietaId)
      if (e2) throw e2
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dieta', socioId] }),
  })
}
