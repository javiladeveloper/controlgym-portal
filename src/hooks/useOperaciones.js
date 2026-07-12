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
      // !inner + filtro deleted_at: si un producto se elimina (soft-delete),
      // deja de aparecer. Sin esto, el "borrado" no lo sacaba de la tabla.
      const { data, error } = await supabase
        .from('inventario_sede')
        .select('stock, producto:producto!inner(id, nombre, categoria, precio, stock_minimo, deleted_at, imagen_url, descripcion, beneficio, visible_en_app, descuento_tipo, descuento_valor)')
        .eq('sede_id', sedeId)
        .is('producto.deleted_at', null)
      if (error) throw error
      return (data || [])
        .filter((r) => r.producto && !r.producto.deleted_at)
        .map((r) => {
          const minimo = Number(r.producto?.stock_minimo ?? 0)
          // 'Stock bajo' solo si hay un mínimo configurado (>0) y el stock llegó a
          // él o por debajo. Con mínimo 0 (o producto recién creado en 0) NO se
          // marca alarma: 0<=0 daba falsos rojos en el panel.
          return { ...r.producto, stock: r.stock, bajo: minimo > 0 && r.stock <= minimo }
        })
    },
  })
}

export function useMovimientosInventario(sedeId) {
  return useQuery({
    queryKey: ['kardex-movs', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
      // Traemos TODOS los movimientos del mes (no un limit chico): los KPIs
      // 'Ventas del mes' y 'Compras del mes' (Kardex.jsx) suman sobre este array,
      // así que truncarlo a 200 subcontaba el dinero en gimnasios grandes.
      const { data, error } = await supabase
        .from('movimiento_inventario')
        .select('id, tipo, cantidad, monto, fecha, producto:producto(nombre)')
        .eq('sede_id', sedeId)
        .gte('fecha', inicioMes)
        .order('fecha', { ascending: false })
        .limit(2000)
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

export function useFinanzas(sedeId, desde, hasta) {
  return useQuery({
    queryKey: ['finanzas', sedeId, desde, hasta],
    enabled: !!sedeId && !!desde && !!hasta,
    queryFn: async () => {
      // Movimientos del RANGO elegido (filtro de fechas de la página). Se trae
      // el rango completo (no un limit arbitrario): los KPIs se calculan sobre
      // este conjunto y truncarlo daría totales falsos. 'fecha' es timestamptz:
      // el tope es exclusivo (hasta + 1 día) para incluir todo el último día.
      const hastaMasUno = (() => { const d = new Date(hasta + 'T00:00:00'); d.setDate(d.getDate() + 1)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
      const { data, error } = await supabase
        .from('movimiento_financiero')
        .select('id, tipo, categoria, descripcion, monto, fecha, metodo_pago, ref_tipo, ref_id')
        .eq('sede_id', sedeId)
        .gte('fecha', desde)
        .lt('fecha', hastaMasUno)
        .order('fecha', { ascending: false })
        .limit(5000)
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
