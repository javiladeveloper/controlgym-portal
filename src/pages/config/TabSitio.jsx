import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useGuardarEmpresa } from '../../hooks/useConfiguracion.js'
import { supabase } from '../../lib/supabaseClient.js'
import { ROOT_DOMAIN, urlPublica } from '../../lib/tenant.js'

function normalizaSlug(s) {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export default function TabSitio() {
  const { empresa, reloadBootstrap } = useAuth()
  const guardar = useGuardarEmpresa(empresa?.id)
  const [slug, setSlug] = useState('')
  const [activa, setActiva] = useState(true)
  const [check, setCheck] = useState(null) // null | 'ok' | 'taken' | 'checking'
  const [ok, setOk] = useState(false)
  const checkSeq = useRef(0) // secuencia para descartar respuestas fuera de orden

  useEffect(() => {
    if (empresa) {
      setSlug(empresa.slug || '')
      setActiva(empresa.landing_activa !== false)
    }
  }, [empresa])

  async function onSlugChange(v) {
    const s = normalizaSlug(v)
    setSlug(s); setOk(false); setCheck('checking')
    if (!s) { setCheck(null); return }
    // Cada tecleo dispara una consulta; solo aplicamos la respuesta si sigue
    // siendo la última pedida (evita que una respuesta lenta de un slug
    // intermedio marque 'ok' un valor que ya no corresponde al slug actual).
    const seq = ++checkSeq.current
    const { data } = await supabase.rpc('slug_disponible', { p_slug: s, p_empresa_id: empresa.id })
    if (seq !== checkSeq.current) return
    setCheck(data ? 'ok' : 'taken')
  }

  const dirty = slug !== (empresa?.slug || '') || activa !== (empresa?.landing_activa !== false)
  // Solo se habilita Guardar cuando el slug NO cambió (nada que verificar) o
  // cuando la última verificación confirmó que está libre ('ok'). Con 'checking'
  // o 'taken' se bloquea, cerrando la ventana de una respuesta obsoleta.
  const slugSinCambio = slug === (empresa?.slug || '')
  const puedeGuardar = dirty && slug && (slugSinCambio || check === 'ok') && !guardar.isPending

  function onGuardar() {
    guardar.mutate({ slug, landing_activa: activa }, {
      onSuccess: async () => { setOk(true); await reloadBootstrap() },
      onError: (e) => alert('No se pudo guardar: ' + e.message),
    })
  }

  const url = slug ? `${slug}.${ROOT_DOMAIN}` : `tu-gym.${ROOT_DOMAIN}`
  const devUrl = slug ? urlPublica(slug) : ''

  return (
    <div className="max-w-[720px]">
      <Card className="p-[19px]">
        <div className="text-[14.5px] font-extrabold">Sitio web del gimnasio</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">
          Tu gimnasio tiene una página web automática con tu marca, planes y sedes. Los socios entran por tu dirección.
        </p>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Dirección (subdominio)</span>
          <div className="flex items-center overflow-hidden rounded-[10px] border border-line focus-within:border-orange">
            <input value={slug} onChange={(e) => onSlugChange(e.target.value)} placeholder="tu-gym"
              className="flex-1 bg-white px-3.5 py-2.5 text-[14px] outline-none" />
            <span className="bg-surface px-3 py-2.5 text-[13px] font-bold text-muted">.{ROOT_DOMAIN}</span>
          </div>
          {check === 'checking' && <span className="text-[11.5px] font-semibold text-faint">Verificando…</span>}
          {check === 'ok' && <span className="text-[11.5px] font-extrabold text-green-600">✓ Disponible — {url}</span>}
          {check === 'taken' && <span className="text-[11.5px] font-extrabold text-red">Ya está en uso, prueba otro</span>}
        </label>

        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={activa} onChange={(e) => { setActiva(e.target.checked); setOk(false) }} className="h-4 w-4 accent-orange-600" />
          <span className="text-[13px] font-bold">Página web pública activa</span>
        </label>

        <div className="mt-5 flex items-center gap-3">
          <PrimaryButton onClick={onGuardar} disabled={!puedeGuardar}>{guardar.isPending ? 'Guardando…' : 'Guardar'}</PrimaryButton>
          {ok && <span className="text-[13px] font-extrabold text-green-600">Guardado ✓</span>}
        </div>
      </Card>

      {slug && (
        <Card className="mt-4 p-[19px]">
          <div className="text-[13px] font-extrabold">Vista previa de tu página</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a href={devUrl} target="_blank" rel="noreferrer"
              className="rounded-[10px] border border-orange bg-orange-50 px-4 py-2 text-[13px] font-extrabold text-orange hover:bg-orange-100">
              Ver mi página →
            </a>
            <span className="text-[12px] font-semibold text-faint">
              En producción será <b className="text-ink">https://{url}</b>
            </span>
          </div>
        </Card>
      )}

      {slug && <VisitasCard empresaId={empresa?.id} />}

      {slug && <CompartirLinks slug={slug} />}
    </div>
  )
}

// Cuánta gente llega a la página este mes y desde dónde (y cuántos dejaron sus datos)
function VisitasCard({ empresaId }) {
  const stats = useQuery({
    queryKey: ['visitas-landing', empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const desde = new Date()
      desde.setDate(1); desde.setHours(0, 0, 0, 0)
      const iso = desde.toISOString()
      const [visitas, leads] = await Promise.all([
        supabase.from('landing_visita').select('fuente', { count: 'exact' }).gte('created_at', iso).limit(1000),
        supabase.from('lead').select('id', { count: 'exact', head: true }).gte('created_at', iso).eq('fuente', 'Página web'),
      ])
      const porFuente = {}
      for (const v of visitas.data || []) {
        const f = v.fuente || 'directo'
        porFuente[f] = (porFuente[f] || 0) + 1
      }
      return {
        visitas: visitas.count || 0,
        leads: leads.count || 0,
        fuentes: Object.entries(porFuente).sort((a, b) => b[1] - a[1]).slice(0, 5),
      }
    },
  })
  const s = stats.data
  return (
    <Card className="mt-4 p-[19px]">
      <div className="text-[14.5px] font-extrabold">Tu página este mes 📊</div>
      {!s ? (
        <p className="mt-2 text-[12px] font-semibold text-faint">Cargando…</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-[10px] border border-line p-3 text-center">
              <div className="text-[22px] font-extrabold">{s.visitas}</div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Visitas</div>
            </div>
            <div className="rounded-[10px] border border-line p-3 text-center">
              <div className="text-[22px] font-extrabold text-orange">{s.leads}</div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted">Interesados captados</div>
            </div>
          </div>
          {s.fuentes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {s.fuentes.map(([f, n]) => (
                <span key={f} className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-muted">
                  {f}: <b className="text-ink">{n}</b>
                </span>
              ))}
            </div>
          )}
          {s.visitas === 0 && (
            <p className="mt-2.5 text-[11.5px] font-semibold text-faint">
              Aún no hay visitas este mes. Comparte tus links de abajo para empezar a atraer gente 👇
            </p>
          )}
        </>
      )}
    </Card>
  )
}

// Links listos para compartir en cada red, con atribución de origen:
// los leads que lleguen desde cada link quedan marcados con su red en el CRM.
const REDES_SHARE = [
  ['instagram', 'Instagram', 'Pégalo en tu bio o stories'],
  ['facebook', 'Facebook', 'Compártelo en tu página'],
  ['tiktok', 'TikTok', 'Ponlo en tu perfil'],
  ['whatsapp', 'WhatsApp', 'Envíalo a tus contactos y grupos'],
]

function CompartirLinks({ slug }) {
  const [copiado, setCopiado] = useState('')
  const base = `https://${slug}.${ROOT_DOMAIN}`

  async function copiar(red, link) {
    try {
      await navigator.clipboard.writeText(link)
      setCopiado(red)
      setTimeout(() => setCopiado(''), 1800)
    } catch {
      prompt('Copia el link:', link)
    }
  }

  return (
    <Card className="mt-4 p-[19px]">
      <div className="text-[14.5px] font-extrabold">Comparte tu página 📣</div>
      <p className="mt-0.5 text-[12px] font-semibold text-muted">
        Usa un link distinto por red: cada persona que se inscriba quedará marcada en tu CRM con la red desde la que llegó. Así sabrás qué red te trae más clientes.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {REDES_SHARE.map(([red, nombre, ayuda]) => {
          const link = `${base}/?utm_source=${red}`
          return (
            <div key={red} className="flex items-center gap-2.5">
              <div className="w-[90px] flex-shrink-0">
                <div className="text-[12.5px] font-extrabold">{nombre}</div>
                <div className="text-[10px] font-semibold leading-tight text-faint">{ayuda}</div>
              </div>
              <input readOnly value={link}
                className="min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-3 py-2 text-[12px] font-bold text-muted outline-none" />
              <button onClick={() => copiar(red, link)}
                className={`w-[86px] flex-shrink-0 cursor-pointer rounded-[9px] border px-3 py-2 text-[12px] font-extrabold transition-colors ${copiado === red ? 'border-green bg-green-50 text-green' : 'border-orange bg-white text-orange hover:bg-orange-50'}`}>
                {copiado === red ? '✓ Copiado' : 'Copiar'}
              </button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
