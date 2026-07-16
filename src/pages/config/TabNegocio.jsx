import { Card, Field, SaveBar, useEmpresaForm } from './empresaForm.jsx'
import DireccionAutocomplete from '../../components/forms/DireccionAutocomplete.jsx'
import HorarioEditor, { resumenHorario } from '../../components/forms/HorarioEditor.jsx'

// "Datos del negocio": reúne en una sola pestaña lo que antes eran tres
// (Contacto, Regional y Redes sociales). Todo son columnas de `empresa`, así que
// comparten un mismo formulario y un único botón de guardar.

const MONEDAS = [['PEN', 'Sol peruano (S/)'], ['USD', 'Dólar ($)'], ['CLP', 'Peso chileno'], ['COP', 'Peso colombiano'], ['MXN', 'Peso mexicano'], ['EUR', 'Euro (€)']]
const ZONAS = ['America/Lima', 'America/Bogota', 'America/Santiago', 'America/Mexico_City', 'America/Buenos_Aires', 'America/Guayaquil']
const LOCALES = [['es-PE', 'Español (Perú)'], ['es-CL', 'Español (Chile)'], ['es-CO', 'Español (Colombia)'], ['es-MX', 'Español (México)'], ['es-AR', 'Español (Argentina)']]
const UNIDADES_PESO = [['kg', 'Kilogramos (kg)'], ['lb', 'Libras (lb)']]
const UNIDADES_TALLA = [['m', 'Metros (m)'], ['ft', 'Pies (ft)']]

const REDES = [
  ['facebook', 'Facebook', 'https://facebook.com/tu-gym'],
  ['instagram', 'Instagram', 'https://instagram.com/tu-gym'],
  ['tiktok', 'TikTok', 'https://tiktok.com/@tu-gym'],
  ['whatsapp', 'WhatsApp', '+51 9XX XXX XXX'],
  ['youtube', 'YouTube', 'https://youtube.com/@tu-gym'],
  ['web', 'Sitio web', 'https://tu-gym.com'],
]

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange">
        {options.map((o) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

export default function TabNegocio() {
  const { form, set, setRed, dirty, ok, saving, onGuardar } = useEmpresaForm([
    'email_contacto', 'telefono_contacto', 'direccion', 'razon_social', 'ruc', 'horario_atencion', 'horario',
    'moneda', 'zona_horaria', 'locale', 'redes', 'unidad_peso', 'unidad_talla',
  ])
  if (!form) return <div className="text-[13px] text-muted">Cargando…</div>
  const redes = form.redes || {}

  // El editor guarda la estructura Y el texto derivado (lo que ve la página pública)
  const onHorario = (estructura) => {
    set('horario', estructura)
    set('horario_atencion', resumenHorario(estructura))
  }

  return (
    <div className="max-w-[720px]">
      {/* Datos de contacto y fiscales */}
      <Card className="p-[19px]">
        <div className="text-[14.5px] font-extrabold">Datos de contacto</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Se usan como remitente de emails y se muestran a los socios.</p>
        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Correo de contacto" type="email" value={form.email_contacto} onChange={(v) => set('email_contacto', v)} placeholder="empresa@correo.com" />
          <Field label="Teléfono" value={form.telefono_contacto} onChange={(v) => set('telefono_contacto', v)} />
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Dirección</span>
            <DireccionAutocomplete value={form.direccion || ''} onChange={(v) => set('direccion', v)} />
          </div>
          <Field label="Razón social" value={form.razon_social} onChange={(v) => set('razon_social', v)} />
          <Field label="RUC" value={form.ruc} onChange={(v) => set('ruc', v)} />
          <div className="sm:col-span-2 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Horario de atención</span>
            <HorarioEditor value={form.horario} onChange={onHorario} />
          </div>
        </div>
      </Card>

      {/* Preferencias regionales */}
      <Card className="mt-4 p-[19px]">
        <div className="text-[14.5px] font-extrabold">Preferencias regionales</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Moneda y formato usados en todo el sistema y la app.</p>
        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Select label="Moneda" value={form.moneda} onChange={(v) => set('moneda', v)} options={MONEDAS} />
          <Select label="Zona horaria" value={form.zona_horaria} onChange={(v) => set('zona_horaria', v)} options={ZONAS} />
          <Select label="Idioma / formato" value={form.locale} onChange={(v) => set('locale', v)} options={LOCALES} />
          <Select label="Unidad de peso" value={form.unidad_peso} onChange={(v) => set('unidad_peso', v)} options={UNIDADES_PESO} />
          <Select label="Unidad de talla" value={form.unidad_talla} onChange={(v) => set('unidad_talla', v)} options={UNIDADES_TALLA} />
        </div>
      </Card>

      {/* Redes sociales */}
      <Card className="mt-4 p-[19px]">
        <div className="text-[14.5px] font-extrabold">Redes sociales</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Se mostrarán en la app del socio y materiales de marketing.</p>
        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {REDES.map(([key, label, ph]) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</span>
              <input value={redes[key] ?? ''} onChange={(e) => setRed(key, e.target.value)} placeholder={ph}
                className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
            </label>
          ))}
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} ok={ok} onGuardar={onGuardar} />
    </div>
  )
}
