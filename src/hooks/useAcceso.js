import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Lectores físicos de la empresa (huella, facial, tarjeta, QR…)
export function useDispositivos(empresaId) {
  return useQuery({
    queryKey: ['dispositivos', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('dispositivo_acceso')
        .select('id, nombre, tipo, direccion, identificador, activo, ultimo_latido, sede_id')
        .eq('empresa_id', empresaId)
        .order('created_at')
      if (error) throw error
      return data
    },
  })
}

export function useGuardarDispositivo(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d) => {
      const fila = {
        empresa_id: empresaId, sede_id: d.sede_id, nombre: d.nombre.trim(),
        tipo: d.tipo, direccion: d.direccion, identificador: d.identificador?.trim() || null,
        activo: d.activo ?? true,
      }
      if (d.id) {
        const { error } = await supabase.from('dispositivo_acceso').update(fila).eq('id', d.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('dispositivo_acceso').insert(fila)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispositivos', empresaId] }),
  })
}

// Credenciales enroladas (de socios y de personal)
export function useCredenciales(empresaId) {
  return useQuery({
    queryKey: ['credenciales', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credencial_acceso')
        .select('id, tipo, valor, activo, socio:socio(nombre, codigo), usuario:usuario(nombre)')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useEnrolarCredencial(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tipo, valor, socioId, usuarioId }) => {
      const { data, error } = await supabase.rpc('enrolar_credencial', {
        p_tipo: tipo, p_valor: valor,
        p_socio_id: socioId || null, p_usuario_id: usuarioId || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credenciales', empresaId] }),
  })
}

export function useQuitarCredencial(empresaId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('credencial_acceso').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credenciales', empresaId] }),
  })
}
