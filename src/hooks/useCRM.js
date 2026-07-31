import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

export const ETAPAS = ['nuevo', 'contactado', 'clase_prueba', 'inscrito']
export const ETAPA_LABEL = { nuevo: 'Nuevo', contactado: 'Contactado', clase_prueba: 'Clase de prueba', inscrito: 'Inscrito', perdido: 'Perdido' }

// Techo defensivo: el CRM es un tablero Kanban (drag&drop + agrupado por
// etapa en memoria), no una lista paginable — partirlo en páginas rompería
// el drag & drop entre columnas. `lead` es un embudo comercial (no un
// histórico que crece sin fin como `socio`: se pierde o se convierte), así
// que un techo generoso alcanza para cualquier sede real y solo protege de
// un caso patológico (import masivo, bug de sync con Leadia).
const TECHO_LEADS = 1000

export function useLeads(sedeId) {
  return useQuery({
    queryKey: ['leads', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lead')
        .select('id, nombre, telefono, email, documento, fuente, etapa, nota, socio_id, created_at, motivo_perdida, perdido_at, nivel_leadia')
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(TECHO_LEADS)
      if (error) throw error
      return data
    },
  })
}

// Conteo exacto de leads de la sede, para el StatCard "Leads totales" del CRM
// — separado de useLeads (que tiene techo) para que ese número nunca mienta,
// incluso si la sede algún día supera TECHO_LEADS. Consulta aparte y liviana
// (head:true, sin traer filas) para no duplicar el payload pesado.
export function useLeadsCount(sedeId) {
  return useQuery({
    queryKey: ['leads-count', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('lead')
        .select('id', { count: 'exact', head: true })
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

export function useAvanzarLead(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, etapa }) => {
      const idx = ETAPAS.indexOf(etapa)
      const next = ETAPAS[Math.min(idx + 1, ETAPAS.length - 1)]
      const { error } = await supabase.from('lead').update({ etapa: next }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, etapa }) => {
      await qc.cancelQueries({ queryKey: ['leads', sedeId] })
      const prev = qc.getQueryData(['leads', sedeId])
      const idx = ETAPAS.indexOf(etapa)
      const next = ETAPAS[Math.min(idx + 1, ETAPAS.length - 1)]
      qc.setQueryData(['leads', sedeId], (old) => (old || []).map((l) => (l.id === id ? { ...l, etapa: next } : l)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['leads', sedeId], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['leads', sedeId] }),
  })
}

export function useTareas(sedeId) {
  return useQuery({
    queryKey: ['lead-tareas', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      // "Seguimientos de hoy": solo tareas PENDIENTES, de leads de ESTA sede,
      // que vencen hasta el final de hoy (incluye atrasadas). Antes traía todas
      // las tareas de todas las sedes, completadas incluidas.
      const finDeHoy = new Date(); finDeHoy.setHours(23, 59, 59, 999)
      const { data, error } = await supabase
        .from('lead_tarea')
        .select('id, tipo, detalle, vence_at, completada, lead:lead!inner(nombre, sede_id)')
        .eq('lead.sede_id', sedeId)
        .eq('completada', false)
        .lte('vence_at', finDeHoy.toISOString())
        .order('vence_at')
      if (error) throw error
      return data
    },
  })
}

export function useToggleTarea(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, completada }) => {
      const { error } = await supabase.from('lead_tarea').update({ completada }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, completada }) => {
      await qc.cancelQueries({ queryKey: ['lead-tareas', sedeId] })
      const prev = qc.getQueryData(['lead-tareas', sedeId])
      qc.setQueryData(['lead-tareas', sedeId], (old) => (old || []).map((t) => (t.id === id ? { ...t, completada } : t)))
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['lead-tareas', sedeId], ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['lead-tareas', sedeId] })
      qc.invalidateQueries({ queryKey: ['agenda-comercial'] }) // la agenda es quien pinta las tareas
    },
  })
}

// Crea un seguimiento (tarea) para un lead. tipo ∈ TAREA_TIPOS (incluye 'llamada').
export function useCrearTarea(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadId, tipo, detalle, vence_at, empresaId }) => {
      const { error } = await supabase.from('lead_tarea').insert({
        lead_id: leadId, empresa_id: empresaId, tipo, detalle: detalle || null,
        vence_at: vence_at || null, completada: false,
      })
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['lead-tareas', sedeId] })
      qc.invalidateQueries({ queryKey: ['agenda-comercial'] })
    },
  })
}

// Debe calzar con el CHECK constraint de lead_tarea.tipo (20260703000010_crm.sql).
export const TAREA_TIPOS = ['llamada', 'whatsapp', 'visita', 'email']
export const TAREA_TIPO_LABEL = { llamada: '📞 Llamada', whatsapp: '💬 WhatsApp', visita: '🏋️ Visita', email: '📧 Email' }
export const TAREA_TIPO_ICONO = { llamada: '📞', whatsapp: '💬', visita: '🏋️', email: '📧' }

// Agenda comercial: tareas vencidas / de hoy / próximos 7 días, de TODA la
// empresa (la RPC ya filtra por auth_empresa_id()). Se monta solo cuando el
// usuario expande la card (patrón TablaHistorialCaja de Finanzas.jsx) para
// no consultar de gratis en cada carga del CRM.
export function useAgendaComercial(enabled) {
  return useQuery({
    queryKey: ['agenda-comercial'],
    enabled: !!enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('agenda_comercial')
      if (error) throw error
      return data || { vencidas: [], hoy: [], proximas: [] }
    },
  })
}

// Ex-socios (reactivación): últimos p_meses. Igual que la agenda, se monta
// solo al expandir la card.
export function useExSocios(meses, enabled) {
  return useQuery({
    queryKey: ['ex-socios', meses],
    enabled: !!enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ex_socios', { p_meses: meses })
      if (error) throw error
      return data || []
    },
  })
}


// Lead que no compró: no contesta / no le interesó / precio. Sale del embudo,
// guarda el motivo y cierra sus tareas (RPC valida empresa y que no sea socio).
export function useMarcarPerdido(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadId, motivo }) => {
      const { data, error } = await supabase.rpc('marcar_lead_perdido', { p_lead_id: leadId, p_motivo: motivo || null })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.motivo === 'ya_es_socio' ? 'Este lead ya es socio.' : 'No se pudo marcar como perdido.')
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads', sedeId] })
      qc.invalidateQueries({ queryKey: ['lead-tareas', sedeId] })
      qc.invalidateQueries({ queryKey: ['agenda-comercial'] })
    },
  })
}
