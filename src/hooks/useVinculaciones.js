import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// ── Bandeja de vinculación por DNI (BLOQUE A del diseño 2026-07-30) ─────────
// El socio de la app pide vincularse a su ficha poniendo su DNI; NUNCA se
// vincula solo (anti-suplantación: cualquiera podría teclear el DNI de otro).
// Queda 'pendiente' hasta que el staff del gym, que conoce a la persona,
// aprueba o rechaza desde aquí.

// Pendientes de la empresa activa del staff. El shape del jsonb (ver
// supabase/migrations/20260730160000_solicitud_vinculacion.sql):
// [{ solicitud_id, creado_at, documento_usado,
//    socio: { id, nombre, documento, email, telefono },
//    solicitante: { usuario_id, nombre, email } }]
export function useSolicitudesVinculacion(empresaId) {
  return useQuery({
    queryKey: ['solicitudes-vinculacion', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('solicitudes_vinculacion_pendientes')
      if (error) throw error
      return data || []
    },
  })
}

export function useResolverVinculacion(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ solicitudId, aprobar }) => {
      const { data, error } = await supabase.rpc('resolver_vinculacion', {
        p_solicitud_id: solicitudId, p_aprobar: aprobar })
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['solicitudes-vinculacion', empresaId] }),
  })
}
