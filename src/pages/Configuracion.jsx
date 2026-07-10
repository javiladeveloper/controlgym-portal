import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import TabMarca from './config/TabMarca.jsx'
import TabWeb from './config/TabWeb.jsx'
import TabPlan from './config/TabPlan.jsx'
import TabCobros from './config/TabCobros.jsx'
import TabFacturacion from './config/TabFacturacion.jsx'
import TabAccesoCamaras from './config/TabAccesoCamaras.jsx'
import TabNegocioSedes from './config/TabNegocioSedes.jsx'

const TABS = [
  { key: 'plan', label: 'Mi plan 💳', Comp: TabPlan },
  { key: 'cobros', label: 'Cobros 💰', Comp: TabCobros },
  { key: 'facturacion', label: 'Facturación 🧾', Comp: TabFacturacion },
  { key: 'marca', label: 'Marca', Comp: TabMarca },
  { key: 'pagina', label: 'Página web', Comp: TabWeb },
  { key: 'acceso', label: 'Acceso y cámaras', Comp: TabAccesoCamaras },
  { key: 'negocio', label: 'Datos del negocio', Comp: TabNegocioSedes },
]

// Deep-links viejos → nueva pestaña que los contiene (no romper enlaces guardados).
const ALIAS = { sedes: 'negocio', camaras: 'acceso' }

export default function Configuracion() {
  const { empresa } = useAuth()
  // Deep-link: /configuracion?tab=marca abre esa pestaña directo
  const [tab, setTab] = useState(() => {
    let t = new URLSearchParams(window.location.search).get('tab')
    t = ALIAS[t] || t
    return TABS.some((x) => x.key === t) ? t : 'plan'
  })
  const Active = TABS.find((t) => t.key === tab)?.Comp

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Configuración</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">
        Ajustes de {empresa?.nombre}. La marca y algunos datos se comparten con la app del socio.
      </p>

      {/* Pestañas */}
      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative flex-shrink-0 whitespace-nowrap px-3 py-2.5 text-[13.5px] font-extrabold transition-colors sm:px-4 ${
              tab === t.key ? 'text-orange' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-[2.5px] rounded-full bg-orange" />}
          </button>
        ))}
      </div>

      <div className="mt-5">{Active && <Active />}</div>
    </div>
  )
}
