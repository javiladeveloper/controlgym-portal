import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { comprimirImagen } from '../lib/imagen.js'

// Banco de ejercicios: el CATÁLOGO global (1369 con GIF) fusionado con la
// personalización del gym. Cada ejercicio trae su GIF genérico animado; si el
// gym ya le puso su propio video/foto/descripción, se muestra esa versión.
// El socio lo ve en la app al abrir un ejercicio de su rutina.
export function useBancoEjercicios(empresaId, texto) {
  return useQuery({
    queryKey: ['banco-ejercicios', empresaId, texto || ''],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('banco_ejercicios_gym', {
        p_empresa_id: empresaId, p_texto: texto || null, p_offset: 0, p_limit: 60,
      })
      if (error) throw error
      return data || []
    },
  })
}

// Materializa un ejercicio del catálogo en la tabla `ejercicio` del gym (por
// nombre, idempotente) para poder personalizarlo. Devuelve el id resultante.
// El trigger de herencia copia el GIF/descripción del catálogo la 1ª vez.
export async function materializarDesdeCatalogo(empresaId, { nombre, grupo_muscular }) {
  const { data: existe } = await supabase.from('ejercicio')
    .select('id').eq('empresa_id', empresaId).ilike('nombre', nombre).limit(1).maybeSingle()
  if (existe) return existe.id
  const { data, error } = await supabase.from('ejercicio')
    .insert({ empresa_id: empresaId, nombre, grupo_muscular: grupo_muscular || null })
    .select('id').single()
  if (error) throw error
  return data.id
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
