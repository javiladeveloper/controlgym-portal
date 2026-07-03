import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { canAccessModule } from '../config/modules.js'
import { LogoMark } from './icons.jsx'

function Splash() {
  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 animate-pulseDot items-center justify-center rounded-xl bg-orange">
          <LogoMark size={24} />
        </div>
        <div className="text-[13px] font-bold text-muted">Cargando…</div>
      </div>
    </div>
  )
}

// Guard de rutas privadas: exige sesión, espera al bootstrap, y (opcional)
// valida que el módulo esté habilitado para la empresa/rol.
// `allowNoEmpresa`: rutas accesibles sin empresa (ej. /registro).
export default function ProtectedRoute({ children, moduleSlug, allowNoEmpresa = false }) {
  const { session, loading, enabledModules, rol, empresa } = useAuth()
  const location = useLocation()

  if (loading) return <Splash />
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />
  // Sesión válida pero sin bootstrap (usuario sin empresa asignada)
  if (!empresa && !allowNoEmpresa) return <Navigate to="/sin-empresa" replace />

  if (moduleSlug && !canAccessModule(moduleSlug, enabledModules, rol)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
