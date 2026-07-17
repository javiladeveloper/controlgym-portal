import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Lista de socios de una sede, con su membresía vigente y última visita.
export function useClientes(sedeId) {
  return useQuery({
    queryKey: ['clientes', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('socio')
        .select('id,codigo,nombre,documento,fecha_nacimiento,telefono,email,objetivo_id,objetivo_nota,objetivo:objetivo_entrenamiento(nombre),talla_m,peso_kg,estado,es_menor,foto_url,foto_estado,usuario_id,membresia!membresia_socio_id_fkey(id,estado,fecha_inicio,fecha_fin,precio_pagado,matricula_pagada,monto_pagado,plan(nombre,precio),promocion:promocion(id,nombre,tipo))')
        .order('fecha_fin', { referencedTable: 'membresia', ascending: false })
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

// Ficha completa de un socio (con historial de asistencia).
export function useSocioFicha(socioId) {
  return useQuery({
    queryKey: ['socio', socioId],
    enabled: !!socioId,
    queryFn: async () => {
      const { data: socio, error } = await supabase
        .from('socio')
        .select('id,codigo,nombre,documento,fecha_nacimiento,telefono,email,objetivo_id,objetivo_nota,objetivo:objetivo_entrenamiento(nombre),talla_m,peso_kg,estado,es_menor,foto_url,foto_estado,usuario_id,membresia!membresia_socio_id_fkey(id,estado,fecha_inicio,fecha_fin,precio_pagado,matricula_pagada,monto_pagado,plan(nombre,precio),promocion:promocion(id,nombre,tipo))')
        .order('fecha_fin', { referencedTable: 'membresia', ascending: false })
        .eq('id', socioId)
        .single()
      if (error) throw error

      const { data: visitas } = await supabase
        .from('checkin')
        .select('id, ocurrido_en, direccion, resultado')
        .eq('socio_id', socioId)
        .order('ocurrido_en', { ascending: false })
        .limit(5)

      // Entradas de las últimas 8 semanas para el gráfico de constancia
      const hace8sem = new Date(Date.now() - 56 * 86400000).toISOString()
      const { data: entradas } = await supabase
        .from('checkin')
        .select('ocurrido_en')
        .eq('socio_id', socioId)
        .eq('direccion', 'entrada')
        .eq('resultado', 'permitido')
        .gte('ocurrido_en', hace8sem)
        .limit(500)

      // Si entró con una promo de grupo (2x1 / NxM), traer con quiénes
      let grupoPromo = []
      const mem = socio.membresia?.[0]
      if (mem?.promocion && ['2x1', 'grupal'].includes(mem.promocion.tipo)) {
        const { data: grupo } = await supabase
          .from('membresia')
          .select('socio:socio!membresia_socio_id_fkey(id, nombre)')
          .eq('promocion_id', mem.promocion.id)
          .eq('fecha_inicio', mem.fecha_inicio)
          .neq('socio_id', socioId)
          .is('deleted_at', null)
        grupoPromo = (grupo || []).map((g) => g.socio).filter(Boolean)
      }

      return { ...socio, visitas: visitas || [], entradas8sem: entradas || [], grupoPromo }
    },
  })
}

// Recepción aprueba/rechaza la foto que subió el socio (para el facial).
export function useValidarFoto(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ socioId, aprobar }) => {
      const { data, error } = await supabase.rpc('validar_foto_socio', { p_socio_id: socioId, p_aprobar: aprobar })
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clientes', sedeId] }),
  })
}

// Autorización de un menor (estado + registrar la firma del apoderado).
export function useAutorizacionMenor(socioId) {
  return useQuery({
    queryKey: ['autorizacion-menor', socioId],
    enabled: !!socioId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_autorizacion_menor', { p_socio_id: socioId })
      if (error) throw error
      return data // { estado, autorizado_por?, documento?, autorizada_at? }
    },
  })
}

// Historial de pagos y membresías del socio (recibos de caja + compras de la app).
export function useHistorialPagos(socioId) {
  return useQuery({
    queryKey: ['historial-pagos', socioId],
    enabled: !!socioId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('historial_pagos_socio', { p_socio_id: socioId })
      if (error) throw error
      return data || []
    },
  })
}

// Medidas corporales del socio (peso/talla/grasa a lo largo del tiempo), para
// el gráfico de progreso. Se registran desde la app o al inscribir/renovar.
export function useMedidasSocio(socioId) {
  return useQuery({
    queryKey: ['medidas-socio', socioId],
    enabled: !!socioId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('socio_medida')
        .select('fecha, peso_kg, talla_m, grasa_pct')
        .eq('socio_id', socioId)
        .order('fecha')
      if (error) throw error
      return data || []
    },
  })
}

export function useAutorizarMenor(socioId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ autorizadoPor, documento }) => {
      const { data, error } = await supabase.rpc('autorizar_menor', {
        p_socio_id: socioId, p_autorizado_por: autorizadoPor, p_documento: documento || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autorizacion-menor', socioId] }),
  })
}
