import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './context/AuthContext.jsx'
import { supabase } from './lib/supabaseClient.js'

const SedeContext = createContext(null)

const LS_KEY = 'fitcore.sedeId'

// Provee la sede activa (id + objeto) a partir de las sedes permitidas del usuario.
// Persiste la elección en localStorage. Mantiene el nombre usePanel() para no
// romper los imports existentes en las páginas.
export function SedeProvider({ children }) {
  const { sedes } = useAuth()
  const [sedeId, setSedeId] = useState(() => localStorage.getItem(LS_KEY) || null)

  // Al cargar/cambiar las sedes disponibles, asegurar una sede válida seleccionada.
  useEffect(() => {
    if (!sedes || sedes.length === 0) return
    const exists = sedeId && sedes.some((s) => s.id === sedeId)
    if (!exists) {
      const first = sedes[0].id
      setSedeId(first)
      localStorage.setItem(LS_KEY, first)
    }
  }, [sedes, sedeId])

  const setSede = (id) => {
    setSedeId(id)
    localStorage.setItem(LS_KEY, id)
  }

  const sede = useMemo(() => sedes?.find((s) => s.id === sedeId) ?? null, [sedes, sedeId])

  // Módulos habilitados para la SEDE activa = categoría del gym ∩ plan de la
  // sede (cada sede paga su plan). Si la query aún no resolvió, se usan los del
  // bootstrap (empresa) como fallback para no parpadear el menú.
  const { enabledModules: modulosEmpresa } = useAuth()
  const modsSede = useQuery({
    queryKey: ['modulos-sede', sedeId],
    enabled: !!sedeId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('modulos_de_sede', { p_sede_id: sedeId })
      if (error) throw error
      return data
    },
  })
  const enabledModules = modsSede.data ?? modulosEmpresa ?? []

  // Rank del plan de la sede activa (1 estudio/miembros · 2 crecimiento · 3 pro).
  // Para las features Pro que viven DENTRO de una pantalla ya visible (aforo,
  // KPIs, agenda de leads…) el front las oculta con planRank >= 3. El módulo no
  // sirve ahí porque no son pantallas propias; el candado real está en el RPC.
  const rankSede = useQuery({
    queryKey: ['rank-sede', sedeId],
    enabled: !!sedeId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rank_de_sede', { p_sede_id: sedeId })
      if (error) throw error
      return data
    },
  })
  const planRank = rankSede.data ?? 1   // sin resolver: asume el mínimo (no filtra de más)

  const value = {
    sedeId,
    sede,                       // objeto { id, nombre }
    sedeNombre: sede?.nombre ?? '',
    sedes: sedes ?? [],
    setSede,
    enabledModules,             // módulos según el plan de la sede activa
    planRank,                   // rank del plan (para gatear piezas Pro internas)
    esPro: planRank >= 3,
  }

  return <SedeContext.Provider value={value}>{children}</SedeContext.Provider>
}

export function usePanel() {
  const ctx = useContext(SedeContext)
  if (!ctx) throw new Error('usePanel debe usarse dentro de SedeProvider')
  return ctx
}
