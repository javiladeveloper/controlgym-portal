import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// ── Bandeja de moderación de rutinas de la comunidad (Task B2) ─────────────
// Un usuario publica su rutina propia (publicar_mi_rutina) y queda 'pendiente'
// hasta que el dueño de la plataforma la aprueba o rechaza. resolver_rutina
// exige ser superadmin (lanza excepción si no lo eres): esta bandeja solo
// tiene sentido montada para él.

/** Rutinas que los usuarios enviaron y esperan aprobación. */
export function useRutinasPendientes() {
  return useQuery({
    queryKey: ['rutinas-pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rutinas_pendientes')
      if (error) throw error
      return data ?? []
    },
  })
}

/** Aprueba o rechaza una rutina. Al rechazar, el motivo es obligatorio: sin él
 *  el autor no sabe qué corregir. */
export function useResolverRutina() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, aprobar, motivo }) => {
      const { error } = await supabase.rpc('resolver_rutina', {
        p_rutina: id,
        p_aprobar: aprobar,
        p_motivo: motivo ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rutinas-pendientes'] }),
  })
}
