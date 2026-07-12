import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BellIcon } from './icons.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar } from './ui.jsx'
import { iniciales } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const NIVEL_DOT = { danger: '#E24B4A', warning: '#FF6B35', success: '#1D9E75', info: '#141B2E' }

// Búsqueda global de socios (nombre, N.º o DNI, en TODA la empresa — no solo la
// sede activa) desde cualquier página. Clic → ficha del socio (/clientes?socio=id).
// Antes era un input decorativo del prototipo: no buscaba nada.
function BuscadorGlobalSocios({ placeholder }) {
  const navigate = useNavigate()
  const { empresa } = useAuth()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [abierto, setAbierto] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  // Cerrar el dropdown al hacer clic fuera
  useEffect(() => {
    function fuera(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  const resultados = useQuery({
    queryKey: ['buscador-global', empresa?.id, debounced],
    enabled: !!empresa?.id && debounced.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('socio')
        .select('id, nombre, codigo, documento, estado, foto_url, foto_estado')
        .eq('empresa_id', empresa.id)
        .is('deleted_at', null)
        .or(`nombre.ilike.%${debounced}%,codigo.ilike.%${debounced}%,documento.ilike.%${debounced}%`)
        .order('nombre')
        .limit(8)
      if (error) throw error
      return data
    },
  })

  function abrirFicha(s) {
    setQ(''); setAbierto(false)
    navigate(`/clientes?socio=${s.id}`)
  }

  const lista = resultados.data || []

  return (
    <div ref={boxRef} className="relative hidden sm:block">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setAbierto(true) }}
        onFocus={() => q.trim().length >= 2 && setAbierto(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && lista.length > 0) abrirFicha(lista[0]); if (e.key === 'Escape') setAbierto(false) }}
        placeholder={placeholder}
        className="w-[250px] rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-orange"
      />
      {abierto && debounced.length >= 2 && (
        <div className="absolute right-0 top-12 z-[80] w-[320px] animate-fadeSlide overflow-hidden rounded-[14px] border border-line bg-white shadow-[0_18px_44px_rgba(20,27,46,0.16)]">
          {resultados.isLoading && (
            <div className="px-4 py-4 text-center text-[12.5px] font-semibold text-muted">Buscando…</div>
          )}
          {!resultados.isLoading && lista.length === 0 && (
            <div className="px-4 py-4 text-center text-[12.5px] font-semibold text-muted">Sin resultados para "{debounced}".</div>
          )}
          {lista.map((s) => (
            <button key={s.id} onClick={() => abrirFicha(s)}
              className="flex w-full cursor-pointer items-center gap-2.5 border-b border-line2 bg-white px-4 py-2.5 text-left hover:bg-[#FAFBFC]">
              {s.foto_url && s.foto_estado === 'aprobada'
                ? <img src={s.foto_url} alt="" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
                : <Avatar ini={iniciales(s.nombre)} bg={T.chipNavy} color={T.navy} size={32} fontSize={11} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-extrabold">{s.nombre}</div>
                <div className="text-[11px] font-semibold text-muted">
                  N.º {s.codigo}{s.documento ? ` · DNI ${s.documento}` : ''}
                </div>
              </div>
              {s.estado !== 'activo' && <span className="flex-shrink-0 text-[10.5px] font-bold text-faint">{s.estado}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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

      <BuscadorGlobalSocios placeholder={searchPlaceholder} />

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
