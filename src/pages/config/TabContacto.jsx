import { Card, Field, SaveBar, useEmpresaForm } from './empresaForm.jsx'
import DireccionAutocomplete from '../../components/forms/DireccionAutocomplete.jsx'
import HorarioEditor, { resumenHorario } from '../../components/forms/HorarioEditor.jsx'

export default function TabContacto() {
  const { form, set, dirty, ok, saving, onGuardar } = useEmpresaForm([
    'email_contacto', 'telefono_contacto', 'direccion', 'razon_social', 'ruc', 'horario_atencion', 'horario',
  ])
  if (!form) return <div className="text-[13px] text-muted">Cargando…</div>

  // El editor guarda la estructura Y el texto derivado (lo que ve la página pública)
  const onHorario = (estructura) => {
    set('horario', estructura)
    set('horario_atencion', resumenHorario(estructura))
  }

  return (
    <div className="max-w-[720px]">
      <Card className="p-[19px]">
        <div className="text-[14.5px] font-extrabold">Datos de contacto</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Se usan como remitente de emails y se muestran a los socios.</p>
        <div className="mt-4 grid grid-cols-2 gap-3.5">
          <Field label="Correo de contacto" type="email" value={form.email_contacto} onChange={(v) => set('email_contacto', v)} placeholder="empresa@correo.com" />
          <Field label="Teléfono" value={form.telefono_contacto} onChange={(v) => set('telefono_contacto', v)} />
          <div className="col-span-2 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Dirección</span>
            <DireccionAutocomplete value={form.direccion || ''} onChange={(v) => set('direccion', v)} />
          </div>
          <Field label="Razón social" value={form.razon_social} onChange={(v) => set('razon_social', v)} />
          <Field label="RUC" value={form.ruc} onChange={(v) => set('ruc', v)} />
          <div className="col-span-2 flex flex-col gap-1.5">
            <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Horario de atención</span>
            <HorarioEditor value={form.horario} onChange={onHorario} />
          </div>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} ok={ok} onGuardar={onGuardar} />
    </div>
  )
}
