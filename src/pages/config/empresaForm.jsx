import { useEffect, useState } from 'react'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useGuardarEmpresa } from '../../hooks/useConfiguracion.js'

// Hook común para las pestañas que editan campos de `empresa`.
// `fields` = lista de claves de empresa que esta pestaña toca.
export function useEmpresaForm(fields) {
  const { empresa, reloadBootstrap } = useAuth()
  const guardar = useGuardarEmpresa(empresa?.id)
  const [form, setForm] = useState(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    if (empresa) {
      const init = {}
      for (const f of fields) init[f] = empresa[f] ?? ''
      setForm(init)
    }
  }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setForm((s) => ({ ...s, [k]: v })); setOk(false) }
  const setRed = (k, v) => { setForm((s) => ({ ...s, redes: { ...(s.redes || {}), [k]: v } })); setOk(false) }

  const dirty = form && fields.some((f) => JSON.stringify(form[f] ?? '') !== JSON.stringify(empresa?.[f] ?? ''))

  function onGuardar() {
    const payload = {}
    for (const f of fields) payload[f] = form[f]
    guardar.mutate(payload, {
      onSuccess: async () => { setOk(true); await reloadBootstrap() },
      onError: (e) => alert('No se pudo guardar: ' + e.message),
    })
  }

  return { form, set, setRed, dirty, ok, saving: guardar.isPending, onGuardar }
}

export function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</span>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
    </label>
  )
}

export function SaveBar({ dirty, saving, ok, onGuardar, label = 'Guardar cambios' }) {
  return (
    <div className="mt-5 flex items-center gap-3">
      <PrimaryButton onClick={onGuardar} disabled={saving || !dirty}>{saving ? 'Guardando…' : label}</PrimaryButton>
      {ok && <span className="text-[13px] font-extrabold text-green-600">Guardado ✓</span>}
    </div>
  )
}

export { Card }
