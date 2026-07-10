import TabAcceso from './TabAcceso.jsx'
import TabCamaras from './TabCamaras.jsx'

// Agrupa "Control de acceso" (métodos, lectores, clave de hardware) y "Cámaras"
// en una sola pestaña — ambas son sobre cómo controlas/vigilas tu local.
export default function TabAccesoCamaras() {
  return (
    <div className="flex flex-col gap-8">
      <TabAcceso />
      <div className="border-t border-line" />
      <TabCamaras />
    </div>
  )
}
