import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import QueryProvider from './providers/QueryProvider.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { SedeProvider } from './store.jsx'
import App from './App.jsx'
import Landing from './pages/Landing.jsx'
import { getTenantSlug } from './lib/tenant.js'
import './index.css'

// Enrutado de nivel raíz por host:
//  · Hay slug de gym en la URL (subdominio o ?g=) y NO se pide el portal (#login)
//    → landing PÚBLICA del gym (sin auth, ligera).
//  · En cualquier otro caso → el portal/app (con providers de auth).
const slug = getTenantSlug()
const wantsPortal = window.location.hash === '#login' || window.location.pathname.startsWith('/portal')

const root = ReactDOM.createRoot(document.getElementById('root'))

if (slug && !wantsPortal) {
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
