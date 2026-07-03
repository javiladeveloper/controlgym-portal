import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { useAuth } from './context/AuthContext.jsx'

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

  const value = {
    sedeId,
    sede,                       // objeto { id, nombre }
    sedeNombre: sede?.nombre ?? '',
    sedes: sedes ?? [],
    setSede,
  }

  return <SedeContext.Provider value={value}>{children}</SedeContext.Provider>
}

export function usePanel() {
  const ctx = useContext(SedeContext)
  if (!ctx) throw new Error('usePanel debe usarse dentro de SedeProvider')
  return ctx
}
