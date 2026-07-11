import { useEffect, useRef, useState } from 'react'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { toast } from '../../lib/toast.js'
import { useGuardarEmpresa, useGuardarTema, subirBranding } from '../../hooks/useConfiguracion.js'
import { applyEmpresaTema } from '../../theme/tokens.js'
import BrandPreview from './BrandPreview.jsx'

const COLOR_FIELDS = [
  ['color_primary', 'Primario (botones y acentos)'],
  ['color_primary_hover', 'Primario · hover'],
  ['color_navy', 'Oscuro (sidebar, hero y footer)'],
  ['color_ink', 'Texto principal'],
  ['color_muted', 'Texto secundario'],
  ['color_success', 'Éxito'],
  ['color_danger', 'Alerta'],
  ['color_surface', 'Superficie'],
  ['color_canvas', 'Fondo'],
]
const FONTS = ['Manrope', 'Inter', 'Poppins', 'Roboto', 'Montserrat', 'Nunito Sans']

// Paletas recomendadas: combos completos, armónicos y legibles, de un clic.
const PALETAS = [
  { nombre: 'Naranja',  color_primary: '#FF6B35', color_primary_hover: '#F05E28', color_navy: '#141B2E', color_ink: '#141B2E', color_muted: '#5B6472', color_success: '#1D9E75', color_danger: '#E24B4A', color_surface: '#F5F6F8', color_canvas: '#E9EBF0' },
  { nombre: 'Rojo',     color_primary: '#E11D48', color_primary_hover: '#BE123C', color_navy: '#0C0A09', color_ink: '#1C1917', color_muted: '#57534E', color_success: '#16A34A', color_danger: '#DC2626', color_surface: '#F7F5F4', color_canvas: '#EEEBE9' },
  { nombre: 'Azul',     color_primary: '#2563EB', color_primary_hover: '#1D4ED8', color_navy: '#0B1220', color_ink: '#0F172A', color_muted: '#475569', color_success: '#059669', color_danger: '#E11D48', color_surface: '#F4F6FA', color_canvas: '#E8ECF4' },
  { nombre: 'Verde',    color_primary: '#059669', color_primary_hover: '#047857', color_navy: '#06231B', color_ink: '#052E22', color_muted: '#4B635B', color_success: '#16A34A', color_danger: '#DC2626', color_surface: '#F3F7F5', color_canvas: '#E6EEEA' },
  { nombre: 'Violeta',  color_primary: '#7C3AED', color_primary_hover: '#6D28D9', color_navy: '#171130', color_ink: '#1E1B2E', color_muted: '#5B5470', color_success: '#1D9E75', color_danger: '#E24B4A', color_surface: '#F6F4FA', color_canvas: '#ECE9F4' },
  { nombre: 'Dorado',   color_primary: '#D97706', color_primary_hover: '#B45309', color_navy: '#0A0A0A', color_ink: '#1C1917', color_muted: '#57534E', color_success: '#16A34A', color_danger: '#DC2626', color_surface: '#FAF8F4', color_canvas: '#F0EDE6' },
]

function Uploader({ label, help, value, square, onFile, uploading }) {
  const ref = useRef(null)
  return (
    <div>
      <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</div>
      <div className="mt-2 flex items-center gap-3">
        <div className={`flex items-center justify-center overflow-hidden border border-line bg-surface ${square ? 'h-14 w-14 rounded-xl' : 'h-14 w-[120px] rounded-lg'}`}>
          {value ? <img src={value} alt="" className="h-full w-full object-contain" /> : <span className="text-[10px] font-bold text-faint">sin imagen</span>}
        </div>
        <div>
          <button
            onClick={() => ref.current?.click()}
            disabled={uploading}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-ink hover:border-orange disabled:opacity-50"
          >
            {uploading ? 'Subiendo…' : 'Subir imagen'}
          </button>
          {help && <div className="mt-1 text-[11px] font-semibold text-faint">{help}</div>}
        </div>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
      </div>
    </div>
  )
}

export default function TabMarca() {
  const { empresa, tema, reloadBootstrap } = useAuth()
  const [form, setForm] = useState(null)
  const [ok, setOk] = useState(false)
  const [uploading, setUploading] = useState('')
  const guardar = useGuardarTema(empresa?.id)

  useEffect(() => { if (tema) setForm({ ...tema }) }, [tema])
  if (!form) return <div className="text-[13px] text-muted">Cargando…</div>

  const update = (field, value) => { setForm((f) => ({ ...f, [field]: value })); setOk(false) }

  async function onUpload(slot, file) {
    setUploading(slot)
    try {
      const url = await subirBranding(empresa.id, slot, file)
      update(slot === 'logo' ? 'logo_url' : 'favicon_url', url)
    } catch (e) {
      alert('No se pudo subir: ' + e.message)
    } finally {
      setUploading('')
    }
  }

  const dirty = tema && (
    COLOR_FIELDS.some(([f]) => form[f] !== tema[f]) ||
    form.nombre_marca !== tema.nombre_marca || form.logo_url !== tema.logo_url ||
    form.favicon_url !== tema.favicon_url || form.font_family !== tema.font_family
  )

  async function onGuardar() {
    setOk(false)
    const payload = {
      logo_url: form.logo_url, favicon_url: form.favicon_url,
      nombre_marca: form.nombre_marca, font_family: form.font_family,
      ...Object.fromEntries(COLOR_FIELDS.map(([f]) => [f, form[f]])),
    }
    guardar.mutate(payload, {
      onSuccess: async () => {
        setOk(true)
        applyEmpresaTema(form)
        document.documentElement.style.setProperty('--font-brand', form.font_family || 'Manrope')
        await reloadBootstrap()
      },
      onError: (e) => alert('No se pudo guardar: ' + e.message),
    })
  }

  return (
    <div className="grid grid-cols-[1fr_1.1fr] gap-[15px]">
      <div className="flex flex-col gap-[15px]">
        <EventoSocial empresaId={empresa?.id} />
        <Card className="p-[19px]">
          <div className="text-[14.5px] font-extrabold">Identidad</div>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Nombre de marca</span>
            <input value={form.nombre_marca || ''} onChange={(e) => update('nombre_marca', e.target.value)}
              className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
          </label>
          <div className="mt-4"><Uploader label="Logo" help="PNG/SVG, máx 2MB" value={form.logo_url} onFile={(f) => onUpload('logo', f)} uploading={uploading === 'logo'} /></div>
          <div className="mt-4"><Uploader label="Favicon del sitio" help="Ícono cuadrado de la pestaña del navegador en tu página web. Si lo dejas vacío, se usa el logo." square value={form.favicon_url} onFile={(f) => onUpload('favicon', f)} uploading={uploading === 'favicon'} /></div>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Tipografía</span>
            <select value={form.font_family || 'Manrope'} onChange={(e) => update('font_family', e.target.value)}
              className="cursor-pointer rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange">
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </Card>

        <Card className="p-[19px]">
          <div className="text-[14.5px] font-extrabold">Colores</div>

          {/* Paletas recomendadas: llenan todos los colores de un clic */}
          <div className="mt-3">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-faint">Paletas recomendadas</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PALETAS.map((p) => {
                const activa = form.color_primary === p.color_primary && form.color_navy === p.color_navy
                return (
                  <button key={p.nombre}
                    onClick={() => { setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'nombre')) })); setOk(false) }}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition-colors ${activa ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-ink hover:border-orange'}`}>
                    <span className="h-3.5 w-3.5 rounded-full" style={{ background: p.color_primary }} />
                    <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: p.color_navy }} />
                    {p.nombre}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {COLOR_FIELDS.map(([field, label]) => (
              <div key={field} className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-bold">{label}</span>
                <div className="flex items-center gap-2">
                  <input type="color" value={form[field] || '#000000'} onChange={(e) => update(field, e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-line bg-white" />
                  <input value={form[field] || ''} onChange={(e) => update(field, e.target.value)}
                    className="w-[92px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[12px] font-bold outline-none focus:border-orange" />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <PrimaryButton onClick={onGuardar} disabled={guardar.isPending || !dirty}>
            {guardar.isPending ? 'Guardando…' : 'Guardar marca'}
          </PrimaryButton>
          {dirty && <button onClick={() => { setForm({ ...tema }); setOk(false) }} className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted hover:border-orange">Descartar</button>}
          {ok && <span className="text-[13px] font-extrabold text-green-600">Marca actualizada ✓</span>}
        </div>
      </div>

      <div className="sticky top-6 self-start">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12px] font-extrabold uppercase tracking-[0.6px] text-muted">Vista previa</span>
          <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[10px] font-extrabold text-orange">en vivo · sin guardar</span>
        </div>
        <BrandPreview t={form} />
        <p className="mt-2 text-[11.5px] font-semibold text-faint">Así se verá el panel y la app con tu marca.</p>
      </div>
    </div>
  )
}

// ── Evento social (galería festiva en la app) — PEDIDO 29 ────────────────────
// El gym activa un evento (ej. "Día del Padre") y recién ahí la app muestra el
// tab Galería para que los socios suban fotos (moderadas en el Dashboard).
function EventoSocial({ empresaId }) {
  const guardarEmpresa = useGuardarEmpresa(empresaId)
  const [estado, setEstado] = useState(null) // {activo, nombre} | null cargando
  useEffect(() => {
    if (!empresaId) return
    supabase.from('empresa').select('evento_social_activo, evento_social').eq('id', empresaId).single()
      .then(({ data }) => setEstado({ activo: data?.evento_social_activo ?? false, nombre: data?.evento_social || '' }))
  }, [empresaId])
  if (!estado) return null

  function guardar(next) {
    setEstado(next)
    guardarEmpresa.mutate({ evento_social_activo: next.activo, evento_social: next.nombre.trim() || null }, {
      onSuccess: () => toast.ok(next.activo ? `Evento "${next.nombre}" activado — los socios ya pueden subir fotos` : 'Evento desactivado'),
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <Card className="p-[19px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[14.5px] font-extrabold">🎉 Evento social (galería en la app)</div>
          <div className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
            Activa un evento (ej. "Día del Padre") y los socios podrán subir fotos desde la app.
            Tú las apruebas en el Dashboard antes de que se publiquen.
          </div>
        </div>
        <button onClick={() => guardar({ ...estado, activo: !estado.activo })}
          disabled={guardarEmpresa.isPending || (!estado.activo && !estado.nombre.trim())}
          className={`relative mt-1 h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-none transition-colors ${estado.activo ? 'bg-orange' : 'bg-line2'} disabled:opacity-60`}
          aria-label="Evento social">
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${estado.activo ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Nombre del evento</span>
        <input value={estado.nombre} onChange={(e) => setEstado({ ...estado, nombre: e.target.value })}
          onBlur={() => estado.activo && guardar(estado)}
          placeholder={'Ej: Día del Padre, Halloween Fit…'}
          className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
      </label>
    </Card>
  )
}
