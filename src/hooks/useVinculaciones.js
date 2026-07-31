import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { useRealtime } from './useRealtime.js'

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
  // Realtime (useSolicitudesVinculacionRealtime) invalida esta query al instante
  // en cada cambio. El refetchInterval queda como RESPALDO por si el websocket
  // se cae (no es la vía principal de refresco, por eso está espaciado).
  return useQuery({
    queryKey: ['solicitudes-vinculacion', empresaId],
    enabled: !!empresaId,
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('solicitudes_vinculacion_pendientes')
      if (error) throw error
      return data || []
    },
  })
}

// Suscripción realtime de la bandeja de vinculación: cada INSERT/UPDATE de
// solicitud_vinculacion (socio pide vincularse, staff resuelve desde otra
// pestaña) refresca la lista al instante. Se monta en Clientes.jsx.
export function useSolicitudesVinculacionRealtime(empresaId) {
  useRealtime({
    table: 'solicitud_vinculacion',
    enabled: !!empresaId,
    invalidate: [['solicitudes-vinculacion', empresaId]],
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
