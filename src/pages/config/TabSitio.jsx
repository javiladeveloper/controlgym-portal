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
    </div>
  )
}
