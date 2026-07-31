import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Techo defensivo para useClientes: el hook se usa como "roster completo de la
// sede" en varias pantallas (cumpleaños en Dashboard, segmentos de campaña
// WhatsApp, buscador de Ventas, enrolamiento en TabAcceso) que necesitan
// TODOS los socios para no fallar en silencio, así que no se puede paginar
// sin romperlas. 2000 cubre con margen al gym más grande visto en la
// auditoría de rendimiento (duele ~500, grave ~2000) sin acotar de más;
// evita que un dato anómalo (import masivo, bug) tumbe la pantalla.
const TECHO_CLIENTES = 2000

// Lista de socios de una sede, con su membresía vigente y última visita.
// Para la pantalla de Clientes (buscador visible al usuario), usar
// useClientesBusqueda: ese sí es seguro con techo bajo porque la búsqueda va
// al servidor.
export function useClientes(sedeId) {
  return useQuery({
    queryKey: ['clientes', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('socio')
        .select('id,codigo,nombre,documento,fecha_nacimiento,telefono,email,objetivo_id,objetivo:objetivo_entrenamiento(nombre),talla_m,peso_kg,estado,es_menor,foto_url,foto_estado,usuario_id,membresia!membresia_socio_id_fkey(id,estado,fecha_inicio,fecha_fin,precio_pagado,matricula_pagada,monto_pagado,plan(nombre,precio),promocion:promocion(id,nombre,tipo))')
        .order('fecha_fin', { referencedTable: 'membresia', ascending: false })
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
        .order('nombre')
        .limit(TECHO_CLIENTES)
      if (error) throw error
      return data
    },
  })
}

// Conteo exacto de socios de la sede (sin filtro de búsqueda) — para el
// encabezado "N socios" de Clientes.jsx, que antes mostraba clientes.length
// del roster completo SIN reaccionar al buscador. Se mantiene ese mismo
// comportamiento (cabecera = total de la sede, no del resultado filtrado).
export function useClientesCount(sedeId) {
  return useQuery({
    queryKey: ['clientes-count', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('socio')
        .select('id', { count: 'exact', head: true })
        .eq('sede_id', sedeId)
        .is('deleted_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

// Roster de la pantalla Clientes: paginado real + contador exacto + búsqueda
// server-side (nombre/código/documento/teléfono/correo) para que el
// buscador SIEMPRE encuentre a cualquier socio sin importar cuántos haya —
// nunca filtra sobre un array truncado en el cliente.
const PAGINA_CLIENTES = 50
export function useClientesBusqueda(sedeId, { q = '', pagina = 0 } = {}) {
  return useQuery({
    queryKey: ['clientes-busqueda', sedeId, q.trim(), pagina],
    enabled: !!sedeId,
    queryFn: async () => {
      let query = supabase
        .from('socio')
        .select('id,codigo,nombre,documento,fecha_nacimiento,telefono,email,objetivo_id,objetivo:objetivo_entrenamiento(nombre),talla_m,peso_kg,estado,es_menor,foto_url,foto_estado,usuario_id,membresia!membresia_socio_id_fkey(id,estado,fecha_inicio,fecha_fin,precio_pagado,matricula_pagada,monto_pagado,plan(nombre,precio),promocion:promocion(id,nombre,tipo))', { count: 'exact' })
        .eq('sede_id', sedeId)
        .is('deleted_at', null)

      // PostgREST usa "," para separar condiciones dentro de .or() y "()" para
      // agrupar — si el término de búsqueda trae esos caracteres literales
      // (p.ej. pegó "Pérez, Juan") rompería el parseo del filtro. Se limpian
      // antes de armar el patrón ilike.
      const t = q.trim().replace(/[,()]/g, ' ').trim()
      if (t) {
        // Mismo criterio "DNI-first" que el filtro anterior en cliente:
        // nombre, código, documento, teléfono o correo — ahora en el servidor.
        const soloDigitos = t.replace(/\D/g, '')
        const partes = [
          `nombre.ilike.%${t}%`,
          `codigo.ilike.%${t}%`,
          `documento.ilike.%${t}%`,
          `email.ilike.%${t}%`,
        ]
        if (soloDigitos) partes.push(`telefono.ilike.%${soloDigitos}%`)
        query = query.or(partes.join(','))
      }

      const desde = pagina * PAGINA_CLIENTES
      const { data, error, count } = await query
        .order('fecha_fin', { referencedTable: 'membresia', ascending: false })
        .order('nombre')
        .range(desde, desde + PAGINA_CLIENTES - 1)
      if (error) throw error
      return { data: data || [], count: count ?? 0 }
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
        .select('id,codigo,nombre,documento,fecha_nacimiento,telefono,email,objetivo_id,objetivo:objetivo_entrenamiento(nombre),talla_m,peso_kg,estado,es_menor,foto_url,foto_estado,usuario_id,membresia!membresia_socio_id_fkey(id,estado,fecha_inicio,fecha_fin,precio_pagado,matricula_pagada,monto_pagado,plan(nombre,precio),promocion:promocion(id,nombre,tipo))')
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
