import { useEffect, useState } from 'react'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useGuardarEmpresa } from '../../hooks/useConfiguracion.js'
import { supabase } from '../../lib/supabaseClient.js'
import { ROOT_DOMAIN } from '../../lib/tenant.js'

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
    const { data } = await supabase.rpc('slug_disponible', { p_slug: s, p_empresa_id: empresa.id })
    setCheck(data ? 'ok' : 'taken')
  }

  const dirty = slug !== (empresa?.slug || '') || activa !== (empresa?.landing_activa !== false)
  const puedeGuardar = dirty && slug && check !== 'taken' && !guardar.isPending

  function onGuardar() {
    guardar.mutate({ slug, landing_activa: activa }, {
      onSuccess: async () => { setOk(true); await reloadBootstrap() },
      onError: (e) => alert('No se pudo guardar: ' + e.message),
    })
  }

  const url = slug ? `${slug}.${ROOT_DOMAIN}` : `tu-gym.${ROOT_DOMAIN}`
  const devUrl = slug ? `${window.location.origin}/?g=${slug}` : ''

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

      {slug && <CompartirLinks slug={slug} />}
    </div>
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
      <p className="mt-3 text-[11px] font-semibold text-faint">
        Estos links funcionarán cuando publiquemos el sitio. Para probar hoy: {window.location.origin}/?g={slug}&utm_source=instagram
      </p>
    </Card>
  )
}
