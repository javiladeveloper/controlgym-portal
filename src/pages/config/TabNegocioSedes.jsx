import TabNegocio from './TabNegocio.jsx'
import TabSedes from './TabSedes.jsx'

// Agrupa "Datos del negocio" (contacto, fiscales, horario, regional, redes) con
// "Sedes" (ubicación, aforo) — todo son datos del negocio y sus locales.
export default function TabNegocioSedes() {
  return (
    <div className="flex flex-col gap-8">
      <TabNegocio />
      <div className="border-t border-line" />
      <TabSedes />
    </div>
  )
}
