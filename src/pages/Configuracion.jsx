import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { usePanel } from '../store.jsx'
import TabMarca from './config/TabMarca.jsx'
import TabWeb from './config/TabWeb.jsx'
import TabPlan from './config/TabPlan.jsx'
import TabCobros from './config/TabCobros.jsx'
import TabFacturacion from './config/TabFacturacion.jsx'
import TabAccesoCamaras from './config/TabAccesoCamaras.jsx'
import TabNegocioSedes from './config/TabNegocioSedes.jsx'
import TabLeadia from './config/TabLeadia.jsx'
import TabCroquis from './config/TabCroquis.jsx'
import { LEADIA_VISIBLE, FACTURACION_VISIBLE } from '../lib/features.js'

// Catálogo de pestañas. `modulo` (opcional) = slug que la sede debe tener
// habilitado para verla — se filtra por plan igual que el menú. `flag` (opcional)
// = feature todavía no lanzada, oculta a todos hasta prenderla.
//   croquis → Crecimiento+ · acceso → Pro · facturación → oculta hasta NORAC.
const TODOS_TABS = [
  { key: 'plan', label: 'Mi plan 💳', Comp: TabPlan },
  { key: 'cobros', label: 'Cobros 💰', Comp: TabCobros },
  { key: 'facturacion', label: 'Facturación 🧾', Comp: TabFacturacion, modulo: 'facturacion', flag: FACTURACION_VISIBLE },
  { key: 'leadia', label: 'Finny 🤖', Comp: TabLeadia, flag: LEADIA_VISIBLE },
  { key: 'croquis', label: 'Croquis 🗺️', Comp: TabCroquis, modulo: 'croquis' },
  { key: 'marca', label: 'Marca', Comp: TabMarca },
  { key: 'pagina', label: 'Página web', Comp: TabWeb },
  { key: 'acceso', label: 'Acceso y cámaras', Comp: TabAccesoCamaras, modulo: 'acceso_fisico' },
  { key: 'negocio', label: 'Datos del negocio', Comp: TabNegocioSedes },
]

// Pestañas visibles para esta sede: se cae la que tenga un flag apagado o un
// módulo que el plan de la sede no habilita.
function tabsVisibles(enabledModules) {
  const mods = new Set(enabledModules || [])
  return TODOS_TABS.filter((t) => {
    if (t.flag === false) return false
    if (t.modulo && !mods.has(t.modulo)) return false
    return true
  })
}

// Deep-links viejos → nueva pestaña que los contiene (no romper enlaces guardados).
const ALIAS = { sedes: 'negocio', camaras: 'acceso' }

export default function Configuracion() {
  const { empresa } = useAuth()
  const { enabledModules } = usePanel()
  const TABS = tabsVisibles(enabledModules)

  // Deep-link: /configuracion?tab=marca abre esa pestaña directo. Si el plan no
  // habilita esa pestaña, cae a 'plan' (no se puede entrar por URL a un tab Pro).
  const [tab, setTab] = useState(() => {
    let t = new URLSearchParams(window.location.search).get('tab')
    t = ALIAS[t] || t
    return TABS.some((x) => x.key === t) ? t : 'plan'
  })
  // El tab activo debe seguir siendo visible (p.ej. si cambió de sede a una de
  // menor plan mientras estaba en Croquis). Si no, cae a 'plan'.
  const tabActivo = TABS.some((x) => x.key === tab) ? tab : 'plan'
  const Active = TABS.find((t) => t.key === tabActivo)?.Comp

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
