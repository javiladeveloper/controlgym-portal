import { Card, Field, SaveBar, useEmpresaForm } from './empresaForm.jsx'

export default function TabTextos() {
  const { form, set, dirty, ok, saving, onGuardar } = useEmpresaForm(['eslogan', 'mensaje_bienvenida'])
  if (!form) return <div className="text-[13px] text-muted">Cargando…</div>

  return (
    <div className="max-w-[720px]">
      <Card className="p-[19px]">
        <div className="text-[14.5px] font-extrabold">Textos de marca</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Personalizan la experiencia del socio en la app.</p>
        <div className="mt-4 flex flex-col gap-3.5">
          <Field label="Eslogan" value={form.eslogan} onChange={(v) => set('eslogan', v)} placeholder="Tu mejor versión empieza hoy" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Mensaje de bienvenida (app)</span>
            <textarea value={form.mensaje_bienvenida ?? ''} onChange={(e) => set('mensaje_bienvenida', e.target.value)} rows={3}
              placeholder="¡Bienvenido a nuestra comunidad fitness!"
              className="resize-none rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
          </label>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} ok={ok} onGuardar={onGuardar} />
    </div>
  )
}
