import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

export function useEstadoFacturacion() {
  return useQuery({
    queryKey: ['estado-facturacion'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_facturacion')
      if (error) throw error
      return data
    },
  })
}

export function useGuardarFacturacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cfg) => {
      const { error } = await supabase.rpc('guardar_facturacion', {
        p_activo: cfg.activo,
        p_ruc: cfg.ruc || null,
        p_razon_social: cfg.razon_social || null,
        p_serie_boleta: cfg.serie_boleta || null,
        p_serie_factura: cfg.serie_factura || null,
        p_correlativo_inicial: cfg.correlativo_inicial ?? null,
        p_proveedor_url: cfg.proveedor_url || null,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['estado-facturacion'] }),
  })
}

export function useGuardarFacturacionKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (key) => {
      const { error } = await supabase.rpc('guardar_facturacion_key', { p_key: key })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['estado-facturacion'] }),
  })
}

// Prueba la conexión a NORAC con la key guardada (el backend descifra y llama /health).
export function useProbarNorac() {
  return useMutation({
    mutationFn: async () => {
      const jwt = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch('/api/facturacion/probar', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}` },
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'No se pudo conectar con NORAC')
      return out
    },
  })
}
