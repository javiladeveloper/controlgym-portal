import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { comprimirImagen } from '../lib/imagen.js'

// Catálogo de ejercicios del gym CON su media de ejecución (descripción,
// video embebible, foto). El socio lo ve en la app al abrir un ejercicio de
// su rutina (rutina_ejercicio.ejercicio_id → ejercicio).
export function useCatalogoEjercicios(empresaId) {
  return useQuery({
    queryKey: ['catalogo-ejercicios', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ejercicio')
        .select('id, nombre, grupo_muscular, descripcion, video_url, foto_url')
        .eq('empresa_id', empresaId)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

export function useGuardarMediaEjercicio(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, descripcion, video_url, foto_url, grupo_muscular }) => {
      const { error } = await supabase.from('ejercicio')
        .update({
          descripcion: descripcion?.trim() || null,
          video_url: video_url?.trim() || null,
          foto_url: foto_url || null,
          grupo_muscular: grupo_muscular?.trim() || null,
        })
        .eq('id', id).eq('empresa_id', empresaId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalogo-ejercicios', empresaId] })
      qc.invalidateQueries({ queryKey: ['banco-ejercicios', empresaId] })
    },
  })
}

// Foto de ejecución al bucket branding (carpeta ejercicios/). Se comprime a
// webp — es liviana (a diferencia del video, que va como link embebido).
export async function subirFotoEjercicio(empresaId, ejercicioId, file) {
  const f = await comprimirImagen(file, { maxWidth: 1280, maxHeight: 1280, quality: 0.82 })
  const path = `${empresaId}/ejercicios/${ejercicioId}.webp`
  const { error } = await supabase.storage.from('branding').upload(path, f, { upsert: true, cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('branding').getPublicUrl(path)
  return `${data.publicUrl}?t=${Date.now()}`
}
