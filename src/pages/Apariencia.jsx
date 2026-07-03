import { useEffect, useState } from 'react'
import { Card, PrimaryButton } from '../components/ui.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { applyEmpresaTema } from '../theme/tokens.js'

// Campos de color editables (columna en empresa_tema -> etiqueta).
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

export default function Apariencia() {
  const { empresa, tema, reloadBootstrap } = useAuth()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (tema) setForm({ ...tema })
  }, [tema])

  if (!form) return <div className="px-7 pt-6 text-[13px] text-muted">Cargando tema…</div>

  function update(field, value) {
    const next = { ...form, [field]: value }
    setForm(next)
    setOk(false)
    // Previsualización en vivo
    applyEmpresaTema(next)
    if (field === 'font_family') {
      document.documentElement.style.setProperty('--font-brand', value)
    }
  }

  async function guardar() {
    setSaving(true)
    setOk(false)
    const payload = {
      logo_url: form.logo_url,
      nombre_marca: form.nombre_marca,
      font_family: form.font_family,
      ...Object.fromEntries(COLOR_FIELDS.map(([f]) => [f, form[f]])),
    }
    const { error } = await supabase
      .from('empresa_tema')
      .update(payload)
      .eq('empresa_id', empresa.id)
    setSaving(false)
    if (!error) {
      setOk(true)
      await reloadBootstrap()
    } else {
      alert('No se pudo guardar: ' + error.message)
    }
  }

  return (
    <div className="max-w-[900px] px-7 pb-9 pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Apariencia y marca</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">
        Personaliza el logo, los colores y la tipografía de {empresa?.nombre}. Los cambios se aplican al portal y a la app del socio.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-[15px]">
        {/* Identidad */}
        <Card className="p-[19px]">
          <div className="text-[14.5px] font-extrabold">Identidad</div>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Nombre de marca</span>
            <input
              value={form.nombre_marca || ''}
              onChange={(e) => update('nombre_marca', e.target.value)}
              className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange"
            />
          </label>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">URL del logo</span>
            <input
              value={form.logo_url || ''}
              onChange={(e) => update('logo_url', e.target.value)}
              placeholder="https://…/logo.png"
              className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange"
            />
          </label>
          {form.logo_url && (
            <img src={form.logo_url} alt="logo" className="mt-3 h-12 max-w-[160px] object-contain" />
          )}
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Tipografía</span>
            <select
              value={form.font_family || 'Manrope'}
              onChange={(e) => update('font_family', e.target.value)}
              className="cursor-pointer rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange"
            >
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </Card>

        {/* Colores */}
        <Card className="p-[19px]">
          <div className="text-[14.5px] font-extrabold">Colores</div>
          <div className="mt-4 flex flex-col gap-3">
            {COLOR_FIELDS.map(([field, label]) => (
              <div key={field} className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-bold">{label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form[field] || '#000000'}
                    onChange={(e) => update(field, e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded border border-line bg-white"
                  />
                  <input
                    value={form[field] || ''}
                    onChange={(e) => update(field, e.target.value)}
                    className="w-[92px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[12px] font-bold outline-none focus:border-orange"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={guardar} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </PrimaryButton>
        {ok && <span className="text-[13px] font-extrabold text-green-600">Marca actualizada ✓</span>}
        <span className="ml-auto text-[12px] font-semibold text-faint">Vista previa en vivo · usa el botón para guardar</span>
      </div>
    </div>
  )
}
