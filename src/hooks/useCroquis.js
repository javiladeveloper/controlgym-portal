import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Pisos de una sede (con su plano).
export function usePisos(sedeId) {
  return useQuery({
    queryKey: ['pisos', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pisos_de_sede', { p_sede_id: sedeId })
      if (error) throw error
      return data || []
    },
  })
}

// Crea/edita un piso (upsert por id). Un piso nace con una grilla por defecto.
export function useGuardarPiso(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, empresa_id, nombre, orden }) => {
      const row = { sede_id: sedeId, empresa_id, nombre, orden: orden ?? 0 }
      const q = id
        ? supabase.from('sede_piso').update(row).eq('id', id)
        : supabase.from('sede_piso').insert(row)
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pisos', sedeId] }),
  })
}

// Ajusta el tamaño de la grilla del piso (filas × columnas).
export function useSetGrilla(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ pisoId, filas, columnas }) => {
      const { error } = await supabase.rpc('set_grilla_piso', {
        p_piso_id: pisoId, p_filas: filas, p_columnas: columnas })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pisos', sedeId] }),
  })
}

export function useBorrarPiso(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('sede_piso').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pisos', sedeId] }),
  })
}

// Máquinas de la sede (con su casilla grid_fila/grid_columna y piso).
export function useMaquinasSede(sedeId) {
  return useQuery({
    queryKey: ['maquinas-croquis', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.from('maquina')
        .select('id, nombre, zona, estado, unidades, piso_id, grid_fila, grid_columna')
        .eq('sede_id', sedeId).is('deleted_at', null).order('nombre')
      if (error) throw error
      return data || []
    },
  })
}

// Coloca/mueve una máquina en una casilla del piso (o la quita: fila/columna null).
export function useColocarMaquina(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ maquinaId, pisoId, fila, columna }) => {
      const { error } = await supabase.rpc('colocar_maquina_grilla', {
        p_maquina_id: maquinaId, p_piso_id: pisoId, p_fila: fila, p_columna: columna })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maquinas-croquis', sedeId] }),
  })
}

// Casillas que SON piso de un piso (para dibujar su forma: U, hueco, etc.).
export function useCasillasPiso(pisoId) {
  return useQuery({
    queryKey: ['casillas-piso', pisoId],
    enabled: !!pisoId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('casillas_de_piso', { p_piso_id: pisoId })
      if (error) throw error
      return data || []
    },
  })
}

// Editar la forma del piso: marcar/desmarcar una casilla, o llenar/vaciar todo.
export function useEditarFormaPiso(pisoId) {
  const qc = useQueryClient()
  const inval = () => {
    qc.invalidateQueries({ queryKey: ['casillas-piso', pisoId] })
    qc.invalidateQueries({ queryKey: ['maquinas-croquis'] }) // al quitar piso se despegan máquinas
  }
  const marcarCasilla = useMutation({
    mutationFn: async ({ fila, columna, esPiso }) => {
      const { error } = await supabase.rpc('set_casilla_piso', {
        p_piso_id: pisoId, p_fila: fila, p_columna: columna, p_es_piso: esPiso })
      if (error) throw error
    },
    onSuccess: inval,
  })
  const llenar = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('llenar_piso', { p_piso_id: pisoId }); if (error) throw error },
    onSuccess: inval,
  })
  const vaciar = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('vaciar_piso', { p_piso_id: pisoId }); if (error) throw error },
    onSuccess: inval,
  })
  return { marcarCasilla, llenar, vaciar }
}
