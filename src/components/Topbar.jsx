import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BellIcon } from './icons.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const NIVEL_DOT = { danger: '#E24B4A', warning: '#FF6B35', success: '#1D9E75', info: '#141B2E' }

function useNotificaciones(sedeId) {
  return useQuery({
    queryKey: ['notificaciones', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notificacion')
        .select('id, titulo, subtitulo, nivel, leida')
        .order('created_at', { ascending: false })
        .limit(8)
      if (error) throw error
      return data
    },
  })
}

// Header row: título a la izquierda; búsqueda + notificaciones + avatar a la derecha.
export default function Topbar({ title, subtitle, searchPlaceholder = 'Buscar socio…' }) {
  const [notifOpen, setNotifOpen] = useState(false)
  const { sedeId } = usePanel()
  const { usuario } = useAuth()
  const { data: notifs } = useNotificaciones(sedeId)
  const hayNoLeidas = (notifs || []).some((n) => !n.leida)
  const ini = usuario?.avatar_iniciales || (usuario?.nombre?.[0] ?? 'U')

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] font-semibold text-muted">{subtitle}</p>}
      </div>

      <input
        placeholder={searchPlaceholder}
        className="w-[250px] rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-orange"
      />

      <div className="relative">
        <button
          onClick={() => setNotifOpen((o) => !o)}
          className="relative flex h-10 w-10 items-center justify-center rounded-[10px] border border-line bg-white transition-colors hover:border-orange"
        >
          <BellIcon size={18} stroke="#5B6472" />
          {hayNoLeidas && <span className="absolute right-2.5 top-[9px] h-[7px] w-[7px] rounded-full border-[1.5px] border-white bg-orange" />}
        </button>

        {notifOpen && (
          <div className="absolute right-0 top-12 z-[80] w-[340px] animate-fadeSlide overflow-hidden rounded-[14px] border border-line bg-white shadow-[0_18px_44px_rgba(20,27,46,0.16)]">
            <div className="flex items-center justify-between border-b border-line2 px-4 py-3.5">
              <div className="text-[13.5px] font-extrabold">Notificaciones</div>
              <div className="cursor-pointer text-[11px] font-extrabold text-orange">Marcar leídas</div>
            </div>
            {(notifs || []).length === 0 && (
              <div className="px-4 py-6 text-center text-[12.5px] font-semibold text-muted">Sin notificaciones.</div>
            )}
            {(notifs || []).map((n) => (
              <div key={n.id} className="flex cursor-pointer gap-2.5 border-b border-line2 px-4 py-3 hover:bg-[#FAFBFC]">
                <span className="mt-[5px] h-2 w-2 flex-shrink-0 rounded-full" style={{ background: NIVEL_DOT[n.nivel] || NIVEL_DOT.info }} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-extrabold leading-[1.35]">{n.titulo}</div>
                  {n.subtitulo && <div className="mt-0.5 text-[11.5px] font-semibold text-muted">{n.subtitulo}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-[14px] font-extrabold text-white">
        {ini}
      </div>
    </div>
  )
}
