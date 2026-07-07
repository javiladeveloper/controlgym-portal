import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'
import { fechaLocal } from '../lib/uiHelpers.js'

// Clave de día local (YYYY-M-D) para agrupar sin desfase de zona horaria.
function claveDiaLocal(f) {
  const d = fechaLocal(f)
  if (!d) return null
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// KPIs del dashboard para una sede (usa la vista v_dashboard_sede).
export function useDashboardKpis(sedeId) {
  return useQuery({
    queryKey: ['dashboard-kpis', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_dashboard_sede')
        .select('*')
        .eq('sede_id', sedeId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// Asistencia por hora (RPC).
export function useAsistenciaPorHora(sedeId) {
  return useQuery({
    queryKey: ['asistencia-hora', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rpc_asistencia_por_hora', { p_sede_id: sedeId })
      if (error) throw error
      return data // [{hora, total}]
    },
  })
}

// Ingresos por día de los últimos 14 días (para el gráfico de plata).
export function useIngresosPorDia(sedeId) {
  return useQuery({
    queryKey: ['ingresos-dia', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const desde = new Date()
      desde.setDate(desde.getDate() - 13)
      desde.setHours(0, 0, 0, 0)
      const { data, error } = await supabase
        .from('movimiento_financiero')
        .select('fecha, monto, tipo')
        .eq('sede_id', sedeId)
        .eq('tipo', 'ingreso')
        .gte('fecha', desde.toISOString())
      if (error) throw error
      // Serie completa de 14 días (con ceros donde no hubo ingresos).
      // Se agrupa por día LOCAL (mismo criterio que las fechas mostradas en el
      // gráfico); antes usaba toDateString() sobre UTC y un pago nocturno caía
      // en el día equivocado, descuadrando la barra frente a lo cobrado.
      const porDia = new Map()
      for (let i = 0; i < 14; i++) {
        const d = new Date(desde)
        d.setDate(desde.getDate() + i)
        porDia.set(claveDiaLocal(d), { fecha: new Date(d), total: 0 })
      }
      for (const m of data || []) {
        const k = claveDiaLocal(m.fecha)
        if (k && porDia.has(k)) porDia.get(k).total += Number(m.monto || 0)
      }
      return [...porDia.values()]
    },
  })
}

// Últimos check-ins de la sede (para el panel "en vivo").
export function useCheckins(sedeId) {
  return useQuery({
    queryKey: ['checkins', sedeId],
    enabled: !!sedeId,
    refetchInterval: 15_000, // refresco periódico (sustituye al setInterval simulado)
    queryFn: async () => {
      const { data, error } = await supabase
        .from('checkin')
        .select('id, ocurrido_en, direccion, resultado, motivo, metodo, socio:socio(nombre)')
        .eq('sede_id', sedeId)
        .order('ocurrido_en', { ascending: false })
        .limit(7)
      if (error) throw error
      return data
    },
  })
}
