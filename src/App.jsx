import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Sidebar from './components/Sidebar.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Clientes from './pages/Clientes.jsx'
import CRM from './pages/CRM.jsx'
import Membresias from './pages/Membresias.jsx'
import Rutinas from './pages/Rutinas.jsx'
import Clases from './pages/Clases.jsx'
import Promociones from './pages/Promociones.jsx'
import Personal from './pages/Personal.jsx'
import Kardex from './pages/Kardex.jsx'
import Maquinas from './pages/Maquinas.jsx'
import Finanzas from './pages/Finanzas.jsx'
import Sponsors from './pages/Sponsors.jsx'
import Reportes from './pages/Reportes.jsx'
import Configuracion from './pages/Configuracion.jsx'
import SinEmpresa from './pages/SinEmpresa.jsx'
import RegistroGym from './pages/RegistroGym.jsx'

// slug -> componente. El guard por módulo vive en ProtectedRoute (moduleSlug).
const PAGES = [
  ['dashboard', Dashboard],
  ['clientes', Clientes],
  ['crm', CRM],
  ['membresias', Membresias],
  ['rutinas', Rutinas],
  ['clases', Clases],
  ['promociones', Promociones],
  ['personal', Personal],
  ['kardex', Kardex],
  ['maquinas', Maquinas],
  ['finanzas', Finanzas],
  ['sponsors', Sponsors],
  ['configuracion', Configuracion],
  ['reportes', Reportes],
]

// Layout de la app privada: sidebar + contenido.
function PanelLayout({ children }) {
  return (
    <div className="flex h-screen bg-canvas text-ink">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Público */}
      <Route path="/login" element={<Login />} />
      <Route path="/sin-empresa" element={<SinEmpresa />} />

      {/* Registro de gimnasio: requiere sesión pero NO empresa */}
      <Route
        path="/registro"
        element={
          <ProtectedRoute allowNoEmpresa>
            <RegistroGym />
          </ProtectedRoute>
        }
      />

      {/* Privado */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {PAGES.map(([slug, Page]) => (
        <Route
          key={slug}
          path={`/${slug}`}
          element={
            <ProtectedRoute moduleSlug={slug}>
              <PanelLayout>
                <Page />
              </PanelLayout>
            </ProtectedRoute>
          }
        />
      ))}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
