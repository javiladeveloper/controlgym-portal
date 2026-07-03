import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import QueryProvider from './providers/QueryProvider.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { SedeProvider } from './store.jsx'
import App from './App.jsx'
import Landing from './pages/Landing.jsx'
import PlataformaLanding from './pages/PlataformaLanding.jsx'
import { getTenantSlug, isPlataformaHome } from './lib/tenant.js'
import './index.css'

// Enrutado de nivel raíz por host:
//  · Dominio raíz (fitcorecenter.com) → landing de la PLATAFORMA FitControl.
//  · Subdominio de gym (o ?g=) sin pedir portal → landing PÚBLICA del gym.
//  · En cualquier otro caso → el portal/app (con providers de auth).
const slug = getTenantSlug()
const wantsPortal = window.location.hash === '#login' || window.location.pathname.startsWith('/portal')

const root = ReactDOM.createRoot(document.getElementById('root'))

if (isPlataformaHome()) {
  root.render(
    <React.StrictMode>
      <PlataformaLanding />
    </React.StrictMode>,
  )
} else if (slug && !wantsPortal) {
  root.render(
    <React.StrictMode>
      <Landing slug={slug} />
    </React.StrictMode>,
  )
} else {
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <QueryProvider>
          <AuthProvider>
            <SedeProvider>
              <App />
            </SedeProvider>
          </AuthProvider>
        </QueryProvider>
      </BrowserRouter>
    </React.StrictMode>,
  )
}
