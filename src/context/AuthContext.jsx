import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { applyEmpresaTema } from '../theme/tokens.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [bootstrap, setBootstrap] = useState(null) // { usuario, empresa_activa, rol, tema, empresas, modulos, sedes }
  const [loading, setLoading] = useState(true)

  // Carga el bootstrap (perfil + empresa + módulos + sedes + tema) en un round-trip.
  const loadBootstrap = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_bootstrap')
    if (error) {
      console.error('get_bootstrap error:', error.message)
      setBootstrap(null)
      return
    }
    setBootstrap(data)
    // Aplica el tema white-label de la empresa (CSS variables + fuente).
    if (data?.tema) {
      applyEmpresaTema(data.tema)
      if (data.tema.font_family) {
        document.documentElement.style.setProperty('--font-brand', data.tema.font_family)
      }
    }
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return
      setSession(session)
      if (session) await loadBootstrap()
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      if (session) {
        await loadBootstrap()
      } else {
        setBootstrap(null)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [loadBootstrap])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/dashboard' },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    // scope local: limpia la sesión del navegador aunque el token ya haya
    // vencido en el servidor (el signOut global lanza 403 y dejaba todo a medias)
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* ya no había sesión */ }
    setBootstrap(null)
    // Redirección dura al login: garantiza salir de cualquier pantalla
    window.location.href = '/login'
  }, [])

  // Cambia la empresa activa (multi-empresa) y refresca token + bootstrap.
  const setEmpresaActiva = useCallback(async (empresaId) => {
    const { error } = await supabase.rpc('set_empresa_activa', { p_empresa_id: empresaId })
    if (error) throw error
    // Forzar refresh del token para que el nuevo empresa_id entre en el JWT.
    await supabase.auth.refreshSession()
    await loadBootstrap()
  }, [loadBootstrap])

  const value = {
    session,
    loading,
    usuario: bootstrap?.usuario ?? null,
    esSuperadmin: bootstrap?.es_superadmin ?? false,
    empresa: bootstrap?.empresa_activa ?? null,
    rol: bootstrap?.rol ?? null,
    tema: bootstrap?.tema ?? null,
    empresas: bootstrap?.empresas ?? [],
    enabledModules: bootstrap?.modulos ?? [],
    sedes: bootstrap?.sedes ?? [],
    signIn,
    signInWithGoogle,
    signOut,
    setEmpresaActiva,
    reloadBootstrap: loadBootstrap,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
