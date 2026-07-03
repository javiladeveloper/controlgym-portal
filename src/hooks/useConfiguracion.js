import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { comprimirImagen, PRESETS } from '../lib/imagen.js'

// Guardar datos de la empresa (contacto, redes, regional, textos).
export function useGuardarEmpresa(empresaId) {
  return useMutation({
    mutationFn: async (payload) => {
      const { error } = await supabase.from('empresa').update(payload).eq('id', empresaId)
      if (error) throw error
    },
  })
}

// Guardar tema (marca: colores, logo, favicon, tipografía).
export function useGuardarTema(empresaId) {
  return useMutation({
    mutationFn: async (payload) => {
      const { error } = await supabase.from('empresa_tema').update(payload).eq('empresa_id', empresaId)
      if (error) throw error
    },
  })
}

// Subir un archivo (logo/favicon) al bucket 'branding' bajo la carpeta de la empresa.
// Comprime/redimensiona antes de subir. `slot` = 'logo' | 'favicon'.
export async function subirBranding(empresaId, slot, file) {
  const f = await comprimirImagen(file, PRESETS[slot] || PRESETS.logo)
  const ext = f.name.split('.').pop().toLowerCase()
  const path = `${empresaId}/${slot}.${ext}`
  const { error } = await supabase.storage
    .from('branding')
    .upload(path, f, { upsert: true, cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('branding').getPublicUrl(path)
  // Cache-buster para que se refresque el preview tras re-subir
  return `${data.publicUrl}?t=${Date.now()}`
}

// Subir imagen con nombre único (galería, portada, foto de sede) → URL pública.
// Comprime según el destino. `folder` = 'hero' | 'galeria' | 'sede'.
export async function subirImagen(empresaId, folder, file) {
  const f = await comprimirImagen(file, PRESETS[folder] || PRESETS.galeria)
  const ext = f.name.split('.').pop().toLowerCase()
  const rand = Math.abs(file.name.length + file.size).toString(36) + '-' + (file.lastModified || 0).toString(36)
  const path = `${empresaId}/${folder}/${rand}.${ext}`
  const { error } = await supabase.storage
    .from('branding')
    .upload(path, f, { upsert: true, cacheControl: '3600' })
  if (error) throw error
  const { data } = supabase.storage.from('branding').getPublicUrl(path)
  return data.publicUrl
}

// ── Sedes CRUD ──────────────────────────────────────────────────────────────
export function useSedes(empresaId) {
  return useQuery({
    queryKey: ['sedes-admin', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sede')
        .select('id, nombre, direccion, telefono, aforo_max, activa, foto_url')
        .eq('empresa_id', empresaId)
        .is('deleted_at', null)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

export function useGuardarSede(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (sede) => {
      if (sede.id) {
        const { error } = await supabase.from('sede').update({
          nombre: sede.nombre, direccion: sede.direccion, telefono: sede.telefono,
          aforo_max: sede.aforo_max, activa: sede.activa, foto_url: sede.foto_url,
        }).eq('id', sede.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('sede').insert({
          empresa_id: empresaId, nombre: sede.nombre, direccion: sede.direccion,
          telefono: sede.telefono, aforo_max: sede.aforo_max, activa: sede.activa ?? true,
          foto_url: sede.foto_url,
        })
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sedes-admin', empresaId] }),
  })
}
