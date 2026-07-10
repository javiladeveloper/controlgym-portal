import { useState } from 'react'
import { Card, PrimaryButton, Badge } from '../../components/ui.jsx'
import { LoadingState } from '../../components/states.jsx'
import { inputCls } from '../../components/Modal.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useSedes } from '../../hooks/useConfiguracion.js'
import { useCamaras, useGuardarCamara, useEliminarCamara } from '../../hooks/useCamaras.js'
import { toast } from '../../lib/toast.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'

const EMPTY = { nombre: '', url_embed: '', sede_id: '', activa: true }

export default function TabCamaras() {
  const { empresa } = useAuth()
  const sedes = useSedes(empresa?.id)
  const camaras = useCamaras(empresa?.id, null)
  const guardar = useGuardarCamara(empresa?.id)
  const eliminar = useEliminarCamara(empresa?.id)
  const [edit, setEdit] = useState(null) // cámara en edición, o EMPTY para nueva

  function onGuardar() {
    if (!edit.nombre.trim()) { toast.error('Ponle un nombre a la cámara'); return }
    if (!edit.url_embed.trim()) { toast.error('Pega el enlace de la cámara'); return }
    guardar.mutate(edit, {
      onSuccess: () => { toast.ok('Cámara guardada'); setEdit(null) },
      onError: (e) => toast.error(e.message),
    })
  }

  function onEliminar(cam) {
    if (!window.confirm(`¿Quitar la cámara "${cam.nombre}"?`)) return
    eliminar.mutate(cam.id, {
      onSuccess: () => toast.ok('Cámara eliminada'),
      onError: (e) => toast.error(e.message),
    })
  }

  const sedeNombre = (id) => sedes.data?.find((s) => s.id === id)?.nombre || 'Todas las sedes'

  return (
    <div className="max-w-[760px] flex flex-col gap-5">
      {/* Explicación */}
      <Card className="p-5">
        <div className="text-[14.5px] font-extrabold">Cámaras en vivo 📹</div>
        <p className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
          Conecta las cámaras que ya tienes para verlas en vivo desde el panel (en tu Dashboard).
          FitCore no graba ni guarda video: solo muestra el <b>enlace de streaming</b> que te da la
          app de tu marca de cámaras.
        </p>
        <div className="mt-3 rounded-[10px] border border-line bg-[#FAFBFC] p-3.5 text-[12px] font-semibold leading-[1.6] text-muted">
          <b className="text-ink">¿Cómo obtengo el enlace?</b> En la app de tu marca (Hik-Connect,
          EZVIZ, Reolink, Dahua/DMSS…) busca la opción <b>Compartir</b> o <b>Insertar/Embed</b> de la
          cámara y copia el enlace web. Pégalo abajo. Si tu marca no da un enlace web, avísanos y
          vemos otra forma.
        </div>
      </Card>

      {/* Lista + editor */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[14.5px] font-extrabold">Tus cámaras</div>
          {!edit && (
            <PrimaryButton onClick={() => setEdit({ ...EMPTY, sede_id: sedes.data?.[0]?.id || '' })}>
              + Agregar cámara
            </PrimaryButton>
          )}
        </div>

        {edit && (
          <div className="mt-4 rounded-[12px] border border-orange/40 bg-orange/5 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Nombre</span>
                <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} className={inputCls} placeholder="Entrada principal" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Sede</span>
                <select value={edit.sede_id} onChange={(e) => setEdit({ ...edit, sede_id: e.target.value })} className={inputCls + ' cursor-pointer'}>
                  <option value="">Todas las sedes</option>
                  {(sedes.data || []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Enlace de la cámara (embed / compartir)</span>
                <input value={edit.url_embed} onChange={(e) => setEdit({ ...edit, url_embed: e.target.value })} className={inputCls} placeholder="https://..." />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <PrimaryButton onClick={onGuardar} disabled={guardar.isPending}>Guardar cámara</PrimaryButton>
              <button onClick={() => setEdit(null)} className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2 text-[13px] font-extrabold text-muted">Cancelar</button>
            </div>
          </div>
        )}

        {camaras.isLoading && <div className="mt-4"><LoadingState variant="table" rows={2} /></div>}
        {!camaras.isLoading && camaras.data?.length === 0 && !edit && (
          <div className="mt-4 rounded-[10px] bg-surface px-4 py-5 text-center text-[12.5px] font-semibold text-muted">
            Aún no has agregado cámaras. Agrega la primera para verla en tu Dashboard.
          </div>
        )}
        {(camaras.data || []).map((c) => (
          <div key={c.id} className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13.5px] font-extrabold">{c.nombre}</div>
              <div className="truncate text-[11.5px] font-semibold text-muted">{sedeNombre(c.sede_id)} · {c.url_embed}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge bg={c.activa ? T.successBg : T.line2} color={c.activa ? T.success : T.muted}>{c.activa ? 'Activa' : 'Inactiva'}</Badge>
              <button onClick={() => setEdit(c)} className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12px] text-muted hover:border-orange hover:text-orange">✏️</button>
              <button onClick={() => onEliminar(c)} className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12px] text-muted hover:border-red hover:text-red">🗑</button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
