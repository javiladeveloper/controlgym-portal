import { useState } from 'react'
import { Card } from '../components/ui.jsx'
import { usePanel } from '../store.jsx'
import TabCampanias from './marketing/TabCampanias.jsx'

/**
 * MARKETING (2026-09-02).
 *
 * Estructura tomada del panel de LeadAI, que ya resolvió esto: UNA entrada de
 * menú con pestañas internas, en vez de tres entradas sueltas inflando el
 * sidebar. Allá la lección quedó escrita en el código — las pestañas eran
 * chips de texto y el owner las llamó "TRISTE Y POBRE" porque el nombre no
 * dice qué hace cada una. Por eso acá cada pestaña lleva su icono y su frase
 * de RESULTADO: se elige por lo que se quiere lograr, no adivinando el nombre.
 *
 * Publicar y Anuncios entran después; se declaran ya para que el orden y el
 * criterio queden fijados, y se muestran como "en camino" en vez de fingir que
 * no existen.
 */

const TABS = [
  {
    id: 'campanias',
    label: 'Campañas',
    ayuda: 'Hacer que vuelvan',
    icono: '🔁',
    listo: true,
  },
  {
    id: 'publicar',
    label: 'Publicar',
    ayuda: 'Un post, todas tus redes',
    icono: '📷',
    listo: false,
    nota: 'Sube una foto una vez y sale en Instagram, Facebook y TikTok a la vez.',
  },
  {
    id: 'anuncios',
    label: 'Anuncios',
    ayuda: 'Traer gente nueva',
    icono: '📣',
    listo: false,
    nota: 'Pagar para que te conozca gente de tu zona que todavía no te conoce.',
  },
]

export default function Marketing() {
  const { sedeId } = usePanel()
  const [tab, setTab] = useState('campanias')

  if (!sedeId) {
    return <Card className="p-6 text-[13px] font-semibold text-muted">Elige una sede para ver su marketing.</Card>
  }

  const actual = TABS.find((t) => t.id === tab) || TABS[0]

  return (
    <div>
      <div>
        <div className="text-[11px] font-extrabold uppercase tracking-wider text-faint">Tu embudo</div>
        <h1 className="mt-0.5 text-[19px] font-extrabold">Marketing</h1>
        <p className="mt-0.5 text-[13px] font-semibold text-muted">
          Haz volver a los que ya fueron socios, y trae gente nueva.
        </p>
      </div>

      {/* Tarjetas, no chips: cada una dice qué se LOGRA con ella. */}
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3" role="tablist">
        {TABS.map((t) => {
          const activa = t.id === tab
          return (
            <button key={t.id} role="tab" aria-selected={activa}
              onClick={() => setTab(t.id)}
              className={`flex cursor-pointer items-center gap-3 rounded-[12px] border p-3.5 text-left transition-colors ${
                activa ? 'border-orange bg-orange-50' : 'border-line bg-white hover:border-orange'}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[16px] ${
                activa ? 'bg-orange text-white' : 'bg-line2'}`}>{t.icono}</span>
              <span className="min-w-0">
                <span className={`block text-[13px] font-extrabold ${activa ? 'text-orange' : ''}`}>
                  {t.label}
                </span>
                <span className="block text-[11px] font-semibold text-muted">{t.ayuda}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4">
        {actual.listo
          ? <TabCampanias sedeId={sedeId} />
          : (
            <Card className="p-8 text-center">
              <div className="text-[28px]">{actual.icono}</div>
              <div className="mt-2 text-[14px] font-extrabold">{actual.label} — en camino</div>
              <p className="mx-auto mt-1 max-w-md text-[12.5px] font-semibold leading-relaxed text-muted">
                {actual.nota}
              </p>
            </Card>
          )}
      </div>
    </div>
  )
}
