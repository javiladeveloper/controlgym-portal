import { useEffect, useRef, useState } from 'react'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useGuardarTema, subirBranding } from '../../hooks/useConfiguracion.js'
import { applyEmpresaTema } from '../../theme/tokens.js'
import BrandPreview from './BrandPreview.jsx'

const COLOR_FIELDS = [
  ['color_primary', 'Color primario (acción)'],
  ['color_primary_hover', 'Primario · hover'],
  ['color_navy', 'Oscuro (sidebar)'],
  ['color_success', 'Éxito'],
  ['color_danger', 'Alerta'],
  ['color_surface', 'Superficie'],
  ['color_canvas', 'Fondo'],
]
const FONTS = ['Manrope', 'Inter', 'Poppins', 'Roboto', 'Montserrat', 'Nunito Sans']

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
        <Card className="p-[19px]">
          <div className="text-[14.5px] font-extrabold">Identidad</div>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Nombre de marca</span>
            <input value={form.nombre_marca || ''} onChange={(e) => update('nombre_marca', e.target.value)}
              className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
          </label>
          <div className="mt-4"><Uploader label="Logo" help="PNG/SVG, máx 2MB" value={form.logo_url} onFile={(f) => onUpload('logo', f)} uploading={uploading === 'logo'} /></div>
          <div className="mt-4"><Uploader label="Favicon / isotipo" help="Cuadrado, para la app" square value={form.favicon_url} onFile={(f) => onUpload('favicon', f)} uploading={uploading === 'favicon'} /></div>
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
