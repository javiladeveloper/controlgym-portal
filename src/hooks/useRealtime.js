import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Suscripción a Supabase Realtime → invalida query keys de React Query cuando
// cambia una tabla. Es el puente entre los eventos postgres_changes y los hooks
// existentes: no reescribimos los useQuery, solo los "despertamos" en vivo.
//
// Realtime respeta la RLS del cliente suscrito (JWT), así que cada gym solo
// recibe SUS filas (aislamiento por empresa vía auth_empresa_id()). Las tablas
// deben estar en la publicación supabase_realtime (migración 20260728120000).
//
// Uso:
//   useRealtime({
//     table: 'solicitud_carga',
//     enabled: !!empresaId,
//     invalidate: [['solicitudes-carga', empresaId]],
//   })
//
// - table:      nombre de la tabla en public.
// - enabled:    no se suscribe si es false (evita canal sin sesión/sede).
// - invalidate: array de query keys a invalidar en cada evento.
// - event:      'INSERT' | 'UPDATE' | 'DELETE' | '*' (default '*').
// - onEvent:    callback opcional con el payload crudo (para casos especiales).
export function useRealtime({ table, enabled = true, invalidate = [], event = '*', onEvent }) {
  const qc = useQueryClient()
  // Serializamos las keys para que el efecto no se re-suscriba en cada render
  // por identidad de array nueva (mismo contenido → misma dependencia).
  const keysDep = JSON.stringify(invalidate)

  useEffect(() => {
    if (!enabled || !table) return

    const canal = supabase
      .channel(`rt:${table}:${keysDep}`)
      .on('postgres_changes', { event, schema: 'public', table }, (payload) => {
        for (const key of invalidate) {
          qc.invalidateQueries({ queryKey: key })
        }
        if (onEvent) onEvent(payload)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
    // keysDep cubre `invalidate`; qc/table/event/enabled son estables o primitivos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, enabled, event, keysDep])
}
