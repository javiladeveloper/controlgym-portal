import { useState, useEffect } from 'react'
import { Card, PrimaryButton, Badge } from '../../components/ui.jsx'
import { LoadingState, ErrorState } from '../../components/states.jsx'
import { useRef } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useSedes, useGuardarSede, useGuardarEmpresa, subirImagen } from '../../hooks/useConfiguracion.js'
import { supabase } from '../../lib/supabaseClient.js'
import { toast } from '../../lib/toast.js'
import DireccionAutocomplete from '../../components/forms/DireccionAutocomplete.jsx'
import { BASE_TOKENS as T } from '../../theme/tokens.js'

const EMPTY = { nombre: '', direccion: '', telefono: '', aforo_max: '', activa: true, foto_url: '' }

export default function TabSedes() {
  const { empresa } = useAuth()
  const sedes = useSedes(empresa?.id)
  const guardar = useGuardarSede(empresa?.id)
  const guardarEmpresa = useGuardarEmpresa(empresa?.id)
  const [edit, setEdit] = useState(null) // objeto sede en edición (o EMPTY para nueva)
  const [subiendo, setSubiendo] = useState(false)
  const fotoRef = useRef(null)

  // Flag "membresía por sede": el socio solo entra a la sede donde se registra.
  const [restringe, setRestringe] = useState(null) // null = cargando
  useEffect(() => {
    if (!empresa?.id) return
    supabase.from('empresa').select('restringe_sede').eq('id', empresa.id).single()
      .then(({ data }) => setRestringe(data?.restringe_sede ?? false))
  }, [empresa?.id])
  function toggleRestringe(nuevo) {
    setRestringe(nuevo)
    guardarEmpresa.mutate({ restringe_sede: nuevo }, {
      onSuccess: () => toast.ok(nuevo ? 'Membresía atada a la sede' : 'Acceso libre a todas las sedes'),
      onError: (e) => { setRestringe(!nuevo); toast.error(e.message) },
    })
  }
  const nSedes = sedes.data?.length || 0

  async function subirFoto(file) {
    setSubiendo(true)
    try {
      const url = await subirImagen(empresa.id, 'sede', file)
      setEdit((s) => ({ ...s, foto_url: url }))
    } catch (e) { alert('No se pudo subir: ' + e.message) } finally { setSubiendo(false) }
  }

  function onGuardar() {
    const payload = { ...edit, aforo_max: edit.aforo_max === '' ? null : Number(edit.aforo_max) }
    guardar.mutate(payload, {
      onSuccess: () => setEdit(null),
      onError: (e) => alert('No se pudo guardar: ' + e.message),
    })
  }

  return (
    <div className="max-w-[900px]">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-muted">Gestiona las sedes de tu empresa: ubicación, aforo y estado.</p>
        {!edit && <PrimaryButton onClick={() => setEdit({ ...EMPTY })}>Nueva sede</PrimaryButton>}
      </div>

      {/* Membresía por sede: solo tiene sentido con 2+ sedes */}
      {nSedes >= 2 && restringe !== null && (
        <Card className="mt-4 p-[19px]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[14px] font-extrabold">Membresía atada a la sede</div>
              <div className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
                Si lo activas, cada socio <b>solo entra a la sede donde se registró</b>. Para acceder a
                todas, necesita un <b>plan multisede</b> (lo marcas en Membresías). Cambiar a un socio de
                sede es gratis desde su ficha. Déjalo apagado si tus socios entran a cualquier sede.
              </div>
            </div>
            <button
              onClick={() => toggleRestringe(!restringe)}
              disabled={guardarEmpresa.isPending}
              className={`relative mt-1 h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-none transition-colors ${restringe ? 'bg-orange' : 'bg-line2'} disabled:opacity-60`}
              aria-label="Membresía por sede">
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${restringe ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
        </Card>
      )}

      {/* Formulario de alta/edición */}
      {edit && (
        <Card className="mt-4 p-[19px]">
          <div className="text-[14.5px] font-extrabold">{edit.id ? 'Editar sede' : 'Nueva sede'}</div>
          <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Nombre" value={edit.nombre} onChange={(v) => setEdit({ ...edit, nombre: v })} />
            <Field label="Teléfono" value={edit.telefono} onChange={(v) => setEdit({ ...edit, telefono: v })} />
            <div className="sm:col-span-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Dirección / ubicación</span>
                <DireccionAutocomplete value={edit.direccion || ''} onChange={(v) => setEdit({ ...edit, direccion: v })}
                  className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
              </div>
            </div>
            <Field label="Aforo máximo" type="number" value={edit.aforo_max ?? ''} onChange={(v) => setEdit({ ...edit, aforo_max: v })} />
            <label className="flex items-end gap-2 pb-1">
              <input type="checkbox" checked={!!edit.activa} onChange={(e) => setEdit({ ...edit, activa: e.target.checked })} className="h-4 w-4 accent-orange-600" />
              <span className="text-[13px] font-bold">Sede activa</span>
            </label>
            <div className="sm:col-span-2">
              <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Foto de la sede</span>
              <div className="mt-2 flex items-center gap-3">
                <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
                  {edit.foto_url ? <img src={edit.foto_url} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] font-bold text-faint">sin foto</span>}
                </div>
                <button onClick={() => fotoRef.current?.click()} disabled={subiendo}
                  className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-ink hover:border-orange disabled:opacity-50">
                  {subiendo ? 'Subiendo…' : 'Subir foto'}
                </button>
                {edit.foto_url && <button onClick={() => setEdit({ ...edit, foto_url: '' })} className="text-[12px] font-extrabold text-red">Quitar</button>}
                <input ref={fotoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirFoto(f); e.target.value = '' }} />
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <PrimaryButton onClick={onGuardar} disabled={guardar.isPending || !edit.nombre}>
              {guardar.isPending ? 'Guardando…' : 'Guardar sede'}
            </PrimaryButton>
            <button onClick={() => setEdit(null)} className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted hover:border-orange">Cancelar</button>
          </div>
        </Card>
      )}

      {/* Lista de sedes */}
      {sedes.isLoading && <LoadingState variant="table" rows={3} />}
      {sedes.error && <ErrorState error={sedes.error} onRetry={sedes.refetch} />}
      {sedes.data && (
        <Card className="mt-4 overflow-hidden">
          <div className="grid grid-cols-[1.4fr_2fr_0.8fr_0.9fr_90px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Sede</div><div>Dirección</div><div>Aforo</div><div>Estado</div><div />
          </div>
          {sedes.data.map((s) => (
            <div key={s.id} className="grid grid-cols-[1.4fr_2fr_0.8fr_0.9fr_90px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className="text-[13.5px] font-extrabold">{s.nombre}</div>
              <div className="text-[12.5px] font-semibold text-muted">{s.direccion || '—'}</div>
              <div className="text-[13px] font-bold">{s.aforo_max ?? '—'}</div>
              <div><Badge bg={s.activa ? T.successBg : T.line2} color={s.activa ? T.success : T.muted}>{s.activa ? 'Activa' : 'Inactiva'}</Badge></div>
              <button onClick={() => setEdit({ ...s, aforo_max: s.aforo_max ?? '' })}
                className="cursor-pointer rounded-[9px] border border-line bg-white py-2 text-[12px] font-extrabold text-ink hover:border-orange">Editar</button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</span>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
    </label>
  )
}
