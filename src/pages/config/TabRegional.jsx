import { Card, SaveBar, useEmpresaForm } from './empresaForm.jsx'

const MONEDAS = [['PEN', 'Sol peruano (S/)'], ['USD', 'Dólar ($)'], ['CLP', 'Peso chileno'], ['COP', 'Peso colombiano'], ['MXN', 'Peso mexicano'], ['EUR', 'Euro (€)']]
const ZONAS = ['America/Lima', 'America/Bogota', 'America/Santiago', 'America/Mexico_City', 'America/Buenos_Aires', 'America/Guayaquil']
const LOCALES = [['es-PE', 'Español (Perú)'], ['es-CL', 'Español (Chile)'], ['es-CO', 'Español (Colombia)'], ['es-MX', 'Español (México)'], ['es-AR', 'Español (Argentina)']]

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

export default function TabRegional() {
  const { form, set, dirty, ok, saving, onGuardar } = useEmpresaForm(['moneda', 'zona_horaria', 'locale'])
  if (!form) return <div className="text-[13px] text-muted">Cargando…</div>

  return (
    <div className="max-w-[720px]">
      <Card className="p-[19px]">
        <div className="text-[14.5px] font-extrabold">Preferencias regionales</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Moneda y formato usados en todo el sistema y la app.</p>
        <div className="mt-4 grid grid-cols-3 gap-3.5">
          <Select label="Moneda" value={form.moneda} onChange={(v) => set('moneda', v)} options={MONEDAS} />
          <Select label="Zona horaria" value={form.zona_horaria} onChange={(v) => set('zona_horaria', v)} options={ZONAS} />
          <Select label="Idioma / formato" value={form.locale} onChange={(v) => set('locale', v)} options={LOCALES} />
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} ok={ok} onGuardar={onGuardar} />
    </div>
  )
}
