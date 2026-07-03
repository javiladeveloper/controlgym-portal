import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Hooks de solo-lectura para los módulos operativos restantes.

export function usePersonal(sedeId) {
  return useQuery({
    queryKey: ['personal', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      // Staff = usuarios de la empresa con acceso a esta sede (via usuario_sede),
      // con su rol. Simplificado: traemos usuario_sede -> usuario + rol de la empresa.
      const { data, error } = await supabase
        .from('usuario_sede')
        .select('usuario:usuario(id, nombre, avatar_iniciales, activo, telefono)')
        .eq('sede_id', sedeId)
      if (error) throw error
      return (data || []).map((r) => r.usuario).filter(Boolean)
    },
  })
}

export function useProductos(sedeId) {
  return useQuery({
    queryKey: ['kardex', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventario_sede')
        .select('stock, producto:producto(id, nombre, categoria, precio, stock_minimo)')
        .eq('sede_id', sedeId)
      if (error) throw error
      return (data || []).map((r) => ({ ...r.producto, stock: r.stock, bajo: r.stock <= (r.producto?.stock_minimo ?? 0) }))
    },
  })
}

export function useMovimientosInventario(sedeId) {
  return useQuery({
    queryKey: ['kardex-movs', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimiento_inventario')
        .select('id, tipo, cantidad, monto, fecha, producto:producto(nombre)')
        .eq('sede_id', sedeId)
        .order('fecha', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
  })
}

export function useMaquinas(sedeId) {
  return useQuery({
    queryKey: ['maquinas', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('maquina')
        .select('id, nombre, detalle, zona, unidades, estado')
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

export function useMantenimientos(sedeId) {
  return useQuery({
    queryKey: ['mantenimientos', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mantenimiento')
        .select('id, tipo, detalle, fecha_programada, estado, maquina:maquina(nombre)')
        .eq('sede_id', sedeId)
        .order('fecha_programada')
        .limit(6)
      if (error) throw error
      return data
    },
  })
}

export function useFinanzas(sedeId) {
  return useQuery({
    queryKey: ['finanzas', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimiento_financiero')
        .select('id, tipo, categoria, descripcion, monto, fecha')
        .eq('sede_id', sedeId)
        .order('fecha', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
  })
}

export function useSponsors() {
  return useQuery({
    queryKey: ['sponsors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sponsor')
        .select('*')
        .is('deleted_at', null)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

export function usePromociones() {
  return useQuery({
    queryKey: ['promociones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('promocion')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}
