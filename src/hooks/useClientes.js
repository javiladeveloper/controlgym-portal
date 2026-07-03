import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Lista de socios de una sede, con su membresía vigente y última visita.
export function useClientes(sedeId) {
  return useQuery({
    queryKey: ['clientes', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('socio')
        .select(`
          id, codigo, nombre, documento, fecha_nacimiento, telefono, email,
          objetivo, talla_m, peso_kg, estado, es_menor,
          membresia:membresia(id, estado, fecha_fin, plan:plan(nombre))
        `)
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
        .select(`
          id, codigo, nombre, documento, fecha_nacimiento, telefono, email,
          objetivo, talla_m, peso_kg, estado, es_menor,
          membresia:membresia(id, estado, fecha_fin, plan:plan(nombre))
        `)
        .eq('id', socioId)
        .single()
      if (error) throw error

      const { data: visitas } = await supabase
        .from('checkin')
        .select('id, ocurrido_en, direccion, resultado')
        .eq('socio_id', socioId)
        .order('ocurrido_en', { ascending: false })
        .limit(5)

      return { ...socio, visitas: visitas || [] }
    },
  })
}
