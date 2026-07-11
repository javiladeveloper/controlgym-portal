import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import QueryProvider from './providers/QueryProvider.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { SedeProvider } from './store.jsx'
import { getTenantSlug, isPlataformaHome, isPlataformaHost } from './lib/tenant.js'
import './index.css'

// Code-splitting por host: cada visitante descarga SOLO su mundo
// (landing plataforma / página del gym / panel) — carga inicial más rápida.
const App = lazy(() => import('./App.jsx'))
const Landing = lazy(() => import('./pages/Landing.jsx'))
const PlataformaLanding = lazy(() => import('./pages/PlataformaLanding.jsx'))
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'))
const Reclamaciones = lazy(() => import('./pages/Reclamaciones.jsx'))
const DemoVenta = lazy(() => import('./pages/DemoVenta.jsx'))
const PlanesPublico = lazy(() => import('./pages/PlanesPublico.jsx'))

const Cargando = () => (
  <div className="flex min-h-screen items-center justify-center bg-canvas">
    <div className="h-9 w-9 animate-spin rounded-full border-4 border-orange-100 border-t-orange" />
  </div>
)

// Enrutado de nivel raíz por host:
//  · Dominio raíz (fitcorecenter.com) → landing de la PLATAFORMA FitCore.
//  · Subdominio de gym (o ?g=) sin pedir portal → landing PÚBLICA del gym.
//  · En cualquier otro caso → el portal/app (con providers de auth).
const slug = getTenantSlug()
const wantsPortal = window.location.hash === '#login' || window.location.pathname.startsWith('/portal')

const root = ReactDOM.createRoot(document.getElementById('root'))

const legalDoc = { '/terminos': 'terminos', '/privacidad': 'privacidad', '/devoluciones': 'devoluciones', '/eliminar-cuenta': 'eliminar' }[window.location.pathname]
const esReclamaciones = window.location.pathname === '/reclamaciones'
const esDemo = window.location.pathname === '/demo'
const esPlanes = window.location.pathname === '/planes'

if (isPlataformaHome()) {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
      <PlataformaLanding />
    </Suspense>
    </React.StrictMode>,
  )
} else if (esDemo) {
  // La demo de venta se ve en /demo de cualquier host de la plataforma
  // (fitcorecenter.com/demo, app.…/demo y localhost/demo en dev)
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
      <DemoVenta />
    </Suspense>
    </React.StrictMode>,
  )
} else if (esPlanes) {
  // Checkout público de planes (fitcorecenter.com/planes) — pago con Culqi
  // sin registro previo. Requisito de Culqi para aprobar el comercio.
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
      <PlanesPublico />
    </Suspense>
    </React.StrictMode>,
  )
} else if (isPlataformaHost() && esReclamaciones) {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
      <Reclamaciones />
    </Suspense>
    </React.StrictMode>,
  )
} else if (isPlataformaHost() && legalDoc) {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
      <LegalPage doc={legalDoc} />
    </Suspense>
    </React.StrictMode>,
  )
} else if (slug && !wantsPortal) {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
      <Landing slug={slug} />
    </Suspense>
    </React.StrictMode>,
  )
} else {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<Cargando />}>
      <BrowserRouter>
        <QueryProvider>
          <AuthProvider>
            <SedeProvider>
              <App />
            </SedeProvider>
          </AuthProvider>
        </QueryProvider>
      </BrowserRouter>
    </Suspense>
    </React.StrictMode>,
  )
}
