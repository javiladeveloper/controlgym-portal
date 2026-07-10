import TabSitio from './TabSitio.jsx'
import TabPaginaWeb from './TabPaginaWeb.jsx'

// "Página web": une en una sola pestaña las dos caras de la web pública del gym.
//  1) Dirección y difusión (subdominio, activación, estadísticas, compartir) → TabSitio
//  2) Diseño de la página (portada, textos, secciones, estilo) → TabPaginaWeb
// Cada parte conserva su propio botón de guardar porque guardan cosas distintas
// (el subdominio necesita su verificación de disponibilidad antes de guardar).
export default function TabWeb() {
  return (
    <div className="flex flex-col">
      <section>
        <div className="mb-3 text-[12px] font-extrabold uppercase tracking-[0.6px] text-faint">Dirección y difusión</div>
        <TabSitio />
      </section>

      <div className="my-7 border-t border-line" />

      <section>
        <div className="mb-3 text-[12px] font-extrabold uppercase tracking-[0.6px] text-faint">Diseño de la página</div>
        <TabPaginaWeb />
      </section>
    </div>
  )
}
