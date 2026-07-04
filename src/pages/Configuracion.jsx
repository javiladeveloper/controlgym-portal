import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import TabMarca from './config/TabMarca.jsx'
import TabSitio from './config/TabSitio.jsx'
import TabPaginaWeb from './config/TabPaginaWeb.jsx'
import TabSedes from './config/TabSedes.jsx'
import TabContacto from './config/TabContacto.jsx'
import TabRedes from './config/TabRedes.jsx'
import TabRegional from './config/TabRegional.jsx'
import TabTextos from './config/TabTextos.jsx'
import TabPlan from './config/TabPlan.jsx'

const TABS = [
  { key: 'plan', label: 'Mi plan 💳', Comp: TabPlan },
  { key: 'marca', label: 'Marca', Comp: TabMarca },
  { key: 'sitio', label: 'Sitio web', Comp: TabSitio },
  { key: 'pagina', label: 'Página web', Comp: TabPaginaWeb },
  { key: 'sedes', label: 'Sedes', Comp: TabSedes },
  { key: 'contacto', label: 'Contacto', Comp: TabContacto },
  { key: 'redes', label: 'Redes sociales', Comp: TabRedes },
  { key: 'regional', label: 'Regional', Comp: TabRegional },
  { key: 'textos', label: 'Textos', Comp: TabTextos },
]

export default function Configuracion() {
  const { empresa } = useAuth()
  // Deep-link: /configuracion?tab=marca abre esa pestaña directo
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((x) => x.key === t) ? t : 'plan'
  })
  const Active = TABS.find((t) => t.key === tab)?.Comp

  return (
    <div className="px-7 pb-9 pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Configuración</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">
        Ajustes de {empresa?.nombre}. La marca y algunos datos se comparten con la app del socio.
      </p>

      {/* Pestañas */}
      <div className="mt-5 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-4 py-2.5 text-[13.5px] font-extrabold transition-colors ${
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
