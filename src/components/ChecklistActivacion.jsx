import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'

// Checklist de activación: guía los primeros pasos del negocio en FitControl.
// Se muestra en el Dashboard hasta completarse (o hasta que lo oculten).
// Cada ítem detecta solo si ya está hecho y lleva al lugar exacto.
export default function ChecklistActivacion() {
  const { empresa, tema, rol } = useAuth()
  const [oculto, setOculto] = useState(() => localStorage.getItem(`fc.checklist.${empresa?.id}`) === '1')

  const estado = useQuery({
    queryKey: ['activacion', empresa?.id],
    enabled: !!empresa?.id && rol === 'admin' && !oculto,
    staleTime: 60_000,
    queryFn: async () => {
      const [socios, visitas, sus] = await Promise.all([
        supabase.from('socio').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('landing_visita').select('id', { count: 'exact', head: true }),
        supabase.rpc('get_mi_suscripcion'),
      ])
      return {
        socios: socios.count || 0,
        visitas: visitas.count || 0,
        pagoActivo: sus.data?.estado === 'activa',
      }
    },
  })

  if (rol !== 'admin' || oculto || !estado.data) return null

  const L = empresa?.landing || {}
  const items = [
    { ok: !!tema?.logo_url, icon: '🎨', label: 'Sube tu logo y elige tus colores', to: '/configuracion?tab=marca' },
    { ok: !!L.hero_url, icon: '🖼️', label: 'Ponle portada a tu página web', to: '/configuracion?tab=pagina' },
    { ok: estado.data.socios > 0, icon: '💪', label: `Registra tu primer ${empresa?.plan_slug === 'trainer' ? 'cliente' : 'socio'}`, to: '/clientes' },
    { ok: estado.data.visitas > 0, icon: '📣', label: 'Comparte tu página en tus redes', to: '/configuracion?tab=sitio' },
    { ok: estado.data.pagoActivo, icon: '💳', label: 'Activa tu plan (sigue gratis tu primer mes)', to: '/configuracion?tab=plan' },
  ]
  const hechos = items.filter((i) => i.ok).length
  if (hechos === items.length) return null // todo listo: no molestar más

  return (
    <div className="mb-5 rounded-card border border-orange-200 bg-orange-50/60 p-[18px]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[14.5px] font-extrabold">🚀 Pon tu negocio en marcha</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">
            {hechos} de {items.length} completados — los negocios que terminan esta lista captan socios desde la primera semana.
          </div>
        </div>
        <button onClick={() => { localStorage.setItem(`fc.checklist.${empresa.id}`, '1'); setOculto(true) }}
          className="cursor-pointer rounded-lg border-none bg-transparent px-2 text-[11.5px] font-extrabold text-faint hover:text-muted" title="Ocultar la lista">
          Ocultar
        </button>
      </div>

      {/* Barra de progreso */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-orange transition-all" style={{ width: `${(hechos / items.length) * 100}%` }} />
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <Link key={it.label} to={it.to}
            className={`flex items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-[12.5px] font-bold transition-colors ${it.ok ? 'border-green-200 bg-green-50 text-green-700' : 'border-line bg-white text-ink hover:border-orange'}`}>
            <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${it.ok ? 'bg-green-500 text-white' : 'bg-surface text-faint'}`}>
              {it.ok ? '✓' : ''}
            </span>
            <span className={it.ok ? 'line-through opacity-70' : ''}>{it.icon} {it.label}</span>
            {!it.ok && <span className="ml-auto text-orange">→</span>}
          </Link>
        ))}
      </div>
    </div>
  )
}
