import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Sidebar from './components/Sidebar.jsx'
import TrialBanner from './components/TrialBanner.jsx'
import Toasts from './components/Toasts.jsx'
import BuscadorGlobal from './components/BuscadorGlobal.jsx'
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
import Plataforma from './pages/Plataforma.jsx'
import SinEmpresa from './pages/SinEmpresa.jsx'
import RegistroGym from './pages/RegistroGym.jsx'
import Bienvenida from './pages/Bienvenida.jsx'

// slug -> componente. El guard por módulo vive en ProtectedRoute (moduleSlug).
const PAGES = [
  ['plataforma', Plataforma],
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
// En móvil el sidebar es un drawer que se abre con la hamburguesa.
function PanelLayout({ children }) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { pathname } = useLocation()

  // Al navegar, cerrar el drawer (el clic en un módulo ya "eligió")
  useEffect(() => { setMenuAbierto(false) }, [pathname])

  return (
    <div className="flex h-screen bg-canvas text-ink">
      {/* Sidebar: fijo en escritorio, drawer en móvil */}
      <div className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:translate-x-0 ${menuAbierto ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar />
      </div>
      {menuAbierto && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuAbierto(false)} />
      )}

      <main className="min-w-0 flex-1 overflow-auto">
        {/* Barra móvil con hamburguesa */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white px-4 py-3 md:hidden">
          <button onClick={() => setMenuAbierto(true)} aria-label="Abrir menú"
            className="cursor-pointer rounded-lg border border-line bg-white px-3 py-1.5 text-[17px]">☰</button>
          <span className="text-[15px] font-extrabold">FitControl</span>
        </div>
        <TrialBanner />
        {children}
      </main>

      {/* Utilidades globales del panel */}
      <Toasts />
      <BuscadorGlobal />
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

      {/* Asistente de bienvenida (post-registro): pantalla completa, sin sidebar.
          allowNoEmpresa: en el flujo nuevo la empresa se crea AL FINAL del wizard. */}
      <Route
        path="/bienvenida"
        element={
          <ProtectedRoute allowNoEmpresa>
            <Bienvenida />
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
