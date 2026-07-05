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
        .select('id, nombre, enviado_at, suplementos, comida:comida(id, nombre, hora, descripcion, kcal, orden, dia_semana)')
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
        .select('id, nombre, enviado_at, notas, dias:rutina_dia(id, dia_semana, foco)')
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

// Agregar un día a la rutina (martes, jueves… los que falten)
export function useAgregarDia(socioId, empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ rutinaId, diaSemana }) => {
      const { data, error } = await supabase.from('rutina_dia')
        .insert({ empresa_id: empresaId, rutina_id: rutinaId, dia_semana: diaSemana, foco: 'Full body y cardio' })
        .select('id').single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutina', socioId] }),
  })
}

// Quitar un día (con sus ejercicios)
export function useEliminarDia(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (diaId) => {
      await supabase.from('rutina_ejercicio').delete().eq('rutina_dia_id', diaId)
      const { error } = await supabase.from('rutina_dia').delete().eq('id', diaId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rutina', socioId] })
      qc.invalidateQueries({ queryKey: ['rutina-ejercicios'] })
    },
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

// Banco de ejercicios del gym (catálogo compartido con la app) para autocompletar
export function useBancoEjercicios(empresaId) {
  return useQuery({
    queryKey: ['banco-ejercicios', empresaId],
    enabled: !!empresaId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ejercicio')
        .select('id, nombre, grupo_muscular')
        .eq('empresa_id', empresaId)
        .order('nombre')
      if (error) throw error
      return data
    },
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
      // El banco crece solo: si el ejercicio no existe en el catálogo, se agrega
      const { data: existe } = await supabase.from('ejercicio')
        .select('id').eq('empresa_id', empresaId).ilike('nombre', campos.nombre).limit(1)
      if (!existe?.length) {
        await supabase.from('ejercicio').insert({ empresa_id: empresaId, nombre: campos.nombre })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rutina-ejercicios', rutinaId] })
      qc.invalidateQueries({ queryKey: ['banco-ejercicios'] })
    },
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

// Guardar una comida completa (nombre, hora, día, descripción, kcal)
export function useGuardarComida(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (c) => {
      const { error } = await supabase.from('comida').update({
        nombre: c.nombre, hora: c.hora || null, descripcion: c.descripcion,
        kcal: Number(c.kcal) || 0, dia_semana: c.dia_semana ?? null,
      }).eq('id', c.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dieta', socioId] }),
  })
}

export function useAgregarComida(socioId, empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dietaId, orden }) => {
      const { error } = await supabase.from('comida').insert({
        empresa_id: empresaId, dieta_id: dietaId, nombre: 'Nueva comida',
        hora: '12:00', descripcion: '', kcal: 0, orden: orden ?? 99,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dieta', socioId] }),
  })
}

export function useEliminarComida(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('comida').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dieta', socioId] }),
  })
}

// Indicaciones generales de la rutina (visibles para el socio en su app)
export function useGuardarNotasRutina(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ rutinaId, notas }) => {
      const { error } = await supabase.from('rutina').update({ notas: notas || null }).eq('id', rutinaId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutina', socioId] }),
  })
}

// Suplementos recomendados del plan (texto del nutricionista/trainer)
export function useGuardarSuplementos(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dietaId, suplementos }) => {
      const { error } = await supabase.from('dieta').update({ suplementos: suplementos || null }).eq('id', dietaId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dieta', socioId] }),
  })
}

// Guardar comidas y marcar el plan como enviado a la app del socio.
export function useEnviarPlan(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ dietaId, rutinaId, comidas }) => {
      for (const c of comidas || []) {
        if (!c.id) continue
        const { error } = await supabase.from('comida')
          .update({ descripcion: c.descripcion, kcal: c.kcal })
          .eq('id', c.id)
        if (error) throw error
      }
      const ahora = new Date().toISOString()
      if (dietaId) {
        const { error } = await supabase.from('dieta').update({ enviado_at: ahora }).eq('id', dietaId)
        if (error) throw error
      }
      // La rutina también: sin enviado_at el socio NO la ve en su app
      if (rutinaId) {
        const { error } = await supabase.from('rutina').update({ enviado_at: ahora }).eq('id', rutinaId)
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dieta', socioId] })
      qc.invalidateQueries({ queryKey: ['rutina', socioId] })
    },
  })
}

// ── Solicitudes de subir carga (desde la app del socio) ─────────────────────
// Quedan EN HOLD (estado 'pendiente') hasta que ALGUIEN del staff decida:
// no pertenecen a un trainer — si el que firmó la rutina está enfermo o ya
// no trabaja, cualquier entrenador/admin activo las resuelve al volver.
export function useSolicitudesCarga(empresaId) {
  return useQuery({
    queryKey: ['solicitudes-carga', empresaId],
    enabled: !!empresaId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitud_carga')
        .select('id, socio_id, rutina_ejercicio_id, ejercicio_nombre, carga_actual, carga_deseada, mensaje_socio, creado_at, asignado_a, socio:socio(nombre, codigo), asignado:usuario!solicitud_carga_asignado_a_fkey(nombre)')
        .eq('empresa_id', empresaId)
        .eq('estado', 'pendiente')
        .order('creado_at')
      if (error) throw error
      return data
    },
  })
}

export function useResponderSolicitud(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ solicitud, aprobar, nota }) => {
      const { error } = await supabase.from('solicitud_carga')
        .update({ estado: aprobar ? 'aprobada' : 'rechazada', nota_trainer: nota || null })
        .eq('id', solicitud.id)
      if (error) throw error
      // Aprobar desde el panel también sube la carga en la rutina (paridad
      // con la app, que hace lo mismo al aprobar desde el celular)
      if (aprobar && solicitud.rutina_ejercicio_id && solicitud.carga_deseada) {
        await supabase.from('rutina_ejercicio')
          .update({ carga: solicitud.carga_deseada })
          .eq('id', solicitud.rutina_ejercicio_id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['solicitudes-carga', empresaId] })
      qc.invalidateQueries({ queryKey: ['rutina-ejercicios'] })
    },
  })
}
