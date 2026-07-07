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
      const [{ data, error }, { data: membresias }] = await Promise.all([
        supabase
          .from('usuario_sede')
          .select('usuario:usuario(id, nombre, avatar_iniciales, telefono)')
          .eq('sede_id', sedeId),
        supabase.from('usuario_empresa').select('usuario_id, activo, sueldo_mensual, tipo_pago, tarifa_clase, banco, cuenta_banco, cci, turno_inicio, turno_fin, rol:rol(codigo, nombre)'),
      ])
      if (error) throw error
      const memDe = new Map((membresias || []).map((m) => [m.usuario_id, m]))
      return (data || [])
        .map((r) => r.usuario)
        .filter(Boolean)
        .map((u) => {
          const ue = memDe.get(u.id) || {}
          return {
            ...u,
            activo: ue.activo ?? true,
            sueldo_mensual: ue.sueldo_mensual ?? null,
            tipo_pago: ue.tipo_pago ?? 'mensual',
            tarifa_clase: ue.tarifa_clase ?? null,
            banco: ue.banco ?? '', cuenta_banco: ue.cuenta_banco ?? '', cci: ue.cci ?? '',
            turno_inicio: ue.turno_inicio ?? null, turno_fin: ue.turno_fin ?? null,
            rol_codigo: ue.rol?.codigo ?? null, rol_nombre: ue.rol?.nombre ?? null,
          }
        })
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
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      const { data, error } = await supabase
        .from('movimiento_inventario')
        .select('id, tipo, cantidad, monto, fecha, producto:producto(nombre)')
        .eq('sede_id', sedeId)
        .gte('fecha', inicioMes)
        .order('fecha', { ascending: false })
        .limit(200)
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
        .select('id, tipo, detalle, fecha_programada, estado, maquina_id, maquina:maquina(nombre)')
        .eq('sede_id', sedeId)
        .in('estado', ['programado', 'en_proceso'])
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
      // Traemos TODOS los movimientos del mes en curso (no un limit arbitrario):
      // los KPIs de la página —ingresos/gastos/utilidad y el efectivo del día—
      // se calculan sobre este conjunto, así que truncarlo daría totales falsos.
      const hoy = new Date()
      const desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
      const y = desde.getFullYear(), mth = String(desde.getMonth() + 1).padStart(2, '0')
      const desdeStr = `${y}-${mth}-01`
      const { data, error } = await supabase
        .from('movimiento_financiero')
        .select('id, tipo, categoria, descripcion, monto, fecha, metodo_pago')
        .eq('sede_id', sedeId)
        .gte('fecha', desdeStr)
        .order('fecha', { ascending: false })
        .limit(2000)
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
