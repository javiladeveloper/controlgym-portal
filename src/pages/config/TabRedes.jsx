import { Card, SaveBar, useEmpresaForm } from './empresaForm.jsx'

const REDES = [
  ['facebook', 'Facebook', 'https://facebook.com/tu-gym'],
  ['instagram', 'Instagram', 'https://instagram.com/tu-gym'],
  ['tiktok', 'TikTok', 'https://tiktok.com/@tu-gym'],
  ['whatsapp', 'WhatsApp', '+51 9XX XXX XXX'],
  ['youtube', 'YouTube', 'https://youtube.com/@tu-gym'],
  ['web', 'Sitio web', 'https://tu-gym.com'],
]

export default function TabRedes() {
  const { form, setRed, dirty, ok, saving, onGuardar } = useEmpresaForm(['redes'])
  if (!form) return <div className="text-[13px] text-muted">Cargando…</div>
  const redes = form.redes || {}

  return (
    <div className="max-w-[720px]">
      <Card className="p-[19px]">
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
