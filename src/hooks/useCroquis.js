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

// Catálogo de máquinas de la sede (nombre + unidades). Cada una puede colocarse
// tantas veces como unidades tenga.
export function useMaquinasSede(sedeId) {
  return useQuery({
    queryKey: ['maquinas-croquis', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.from('maquina')
        .select('id, nombre, zona, estado, unidades')
        .eq('sede_id', sedeId).is('deleted_at', null).order('nombre')
      if (error) throw error
      return data || []
    },
  })
}

// Cuántas unidades de cada máquina ya están colocadas en el croquis (mapa
// maquina_id → nº colocadas), para mostrar "quedan N por ubicar".
export function useMaquinasColocadas(sedeId) {
  return useQuery({
    queryKey: ['maquinas-colocadas', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('maquinas_colocadas_sede', { p_sede_id: sedeId })
      if (error) throw error
      return data || {}
    },
  })
}

// Elementos colocados en un piso (máquinas por unidad + referencias).
export function useElementosPiso(pisoId) {
  return useQuery({
    queryKey: ['elementos-piso', pisoId],
    enabled: !!pisoId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('elementos_del_piso', { p_piso_id: pisoId })
      if (error) throw error
      return data || []
    },
  })
}

// Colocar/quitar un elemento (máquina o referencia) en una casilla.
export function useElementos(sedeId, pisoId) {
  const qc = useQueryClient()
  const inval = () => {
    qc.invalidateQueries({ queryKey: ['elementos-piso', pisoId] })
    qc.invalidateQueries({ queryKey: ['maquinas-colocadas', sedeId] })
  }
  const colocar = useMutation({
    mutationFn: async ({ fila, columna, tipo, maquinaId = null, etiqueta = null }) => {
      const { error } = await supabase.rpc('colocar_elemento', {
        p_piso_id: pisoId, p_fila: fila, p_columna: columna, p_tipo: tipo,
        p_maquina_id: maquinaId, p_etiqueta: etiqueta })
      if (error) throw error
    },
    onSuccess: inval,
  })
  const quitar = useMutation({
    mutationFn: async ({ fila, columna }) => {
      const { error } = await supabase.rpc('quitar_elemento', { p_piso_id: pisoId, p_fila: fila, p_columna: columna })
      if (error) throw error
    },
    onSuccess: inval,
  })
  return { colocar, quitar }
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
