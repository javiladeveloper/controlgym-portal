import { useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import Modal, { Campo, inputCls } from '../Modal.jsx'
import { useBancoEjercicios, useGuardarMediaEjercicio, subirFotoEjercicio, materializarDesdeCatalogo } from '../../hooks/useEjercicios.js'
import { parseVideo } from '../../lib/video.js'
import { toast } from '../../lib/toast.js'
import { LoadingState } from '../states.jsx'

// Banco de ejercicios: muestra el CATÁLOGO global (1369 ejercicios con GIF
// animado, español) y deja que el gym personalice cualquiera con su propio
// video/foto/indicaciones. Lo personalizado se guarda solo para ese gym (tabla
// `ejercicio`); el catálogo global nunca se toca. El socio ve el resultado en su
// app al abrir un ejercicio de su rutina.
export default function BancoEjerciciosModal({ onClose }) {
  const { empresa } = useAuth()
  const [q, setQ] = useState('')
  const banco = useBancoEjercicios(empresa?.id, q)
  const guardar = useGuardarMediaEjercicio(empresa?.id)
  const [edit, setEdit] = useState(null) // ejercicio del banco en edición (item de la RPC)
  const [ejercicioId, setEjercicioId] = useState(null) // id materializado en `ejercicio`
  const [f, setF] = useState({ descripcion: '', video_url: '', foto_url: '', grupo_muscular: '' })
  const [subiendo, setSubiendo] = useState(false)
  const [preparando, setPreparando] = useState(false)

  const lista = banco.data || []

  // Abrir un ejercicio para personalizarlo: materializa su fila en `ejercicio`
  // (si no existe) para tener un id sobre el que guardar el override.
  async function abrir(ej) {
    setPreparando(true)
    try {
      const id = await materializarDesdeCatalogo(empresa.id, { nombre: ej.nombre, grupo_muscular: ej.grupo_muscular })
      setEjercicioId(id)
      setEdit(ej)
      setF({
        descripcion: ej.personalizado ? (ej.descripcion || '') : '',
        video_url: ej.video_gym || '',
        foto_url: ej.foto_gym || '',
        grupo_muscular: ej.grupo_muscular || '',
      })
    } catch (e) {
      toast.error('No se pudo abrir el ejercicio: ' + e.message)
    } finally { setPreparando(false) }
  }

  function cerrarEdit() { setEdit(null); setEjercicioId(null) }

  const vid = parseVideo(f.video_url)
  const videoInvalido = f.video_url.trim() && !vid
  const esTikTokCorto = /vm\.tiktok\.com/i.test(f.video_url)

  async function subirFoto(file) {
    setSubiendo(true)
    try {
      const url = await subirFotoEjercicio(empresa.id, ejercicioId, file)
      setF((s) => ({ ...s, foto_url: url }))
    } catch (e) { toast.error('No se pudo subir la foto: ' + e.message) } finally { setSubiendo(false) }
  }

  function onGuardar() {
    if (videoInvalido) { toast.error('El link de video debe ser de TikTok, YouTube o Vimeo'); return }
    guardar.mutate({ id: ejercicioId, ...f }, {
      onSuccess: () => {
        toast.ok(`Personalización de "${edit.nombre}" guardada`)
        banco.refetch()
        cerrarEdit()
      },
      onError: (e) => toast.error(e.message),
    })
  }

  // ── Vista de edición de un ejercicio ──────────────────────────────────────
  if (edit) {
    return (
      <Modal title={edit.nombre} subtitle="Personalízalo para tu gimnasio — lo verá el socio en su app" onClose={cerrarEdit} width={480}>
        <div className="flex flex-col gap-3.5">
          {/* GIF genérico del catálogo, como referencia de la técnica */}
          {edit.gif_catalogo && (
            <div className="mx-auto overflow-hidden rounded-[12px] border border-line bg-[#0B0E14]">
              <img src={edit.gif_catalogo} alt="" className="h-[190px] w-full object-contain" />
            </div>
          )}
          <p className="rounded-[9px] bg-orange-50 px-3 py-2 text-[11.5px] font-semibold leading-[1.45] text-orange-800">
            💡 Arriba ves la <b>guía animada genérica</b>. Añade abajo <b>tu propio video o fotos</b> y tus indicaciones — quedará solo para tu gimnasio.
          </p>
          <Campo label="Descripción / instrucciones">
            <textarea rows={3} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })}
              className={inputCls + ' resize-none'} placeholder="Espalda recta, baja controlado, codos pegados…" />
          </Campo>
          <Campo label="Video de técnica (TikTok, YouTube o Vimeo)" hint="Opcional. Recomendamos TikTok: reproduce siempre embebido.">
            <input value={f.video_url} onChange={(e) => setF({ ...f, video_url: e.target.value })}
              className={inputCls} placeholder="https://tiktok.com/@…/video/…  ·  https://youtu.be/…" />
          </Campo>
          {videoInvalido && (
            <p className="-mt-1.5 rounded-[8px] bg-red-50 px-3 py-1.5 text-[11.5px] font-extrabold text-red">
              {esTikTokCorto
                ? 'Ese es un enlace corto de TikTok (vm.tiktok.com). Abre el video en TikTok y copia el enlace completo (tiktok.com/@usuario/video/…).'
                : 'No reconozco ese link — debe ser de TikTok, YouTube o Vimeo (pega el enlace completo del video).'}
            </p>
          )}
          {vid?.proveedor === 'youtube' && vid.id && (
            <p className="-mt-1.5 rounded-[8px] bg-amber-50 px-3 py-1.5 text-[11.5px] font-semibold text-amber-800">
              ⚠️ Algunos videos de YouTube no permiten reproducirse dentro de apps. Revisa la vista previa.
            </p>
          )}
          {vid && (
            <div className={`mx-auto overflow-hidden rounded-[12px] border border-line bg-black ${vid.proveedor === 'tiktok' ? 'max-w-[280px]' : ''}`}>
              <div className="relative w-full" style={{ paddingTop: vid.proveedor === 'tiktok' ? '160%' : '56.25%' }}>
                <iframe src={vid.embed} title="Vista previa" allowFullScreen
                  className="absolute inset-0 h-full w-full" style={{ border: 0 }}
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
              </div>
            </div>
          )}
          <Campo label="Foto de ejecución" hint="Opcional; se muestra si no hay video (o como miniatura).">
            <div className="flex items-center gap-3">
              {f.foto_url && <img src={f.foto_url} alt="" className="h-16 w-24 rounded-[8px] border border-line object-cover" />}
              <label className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-muted hover:border-orange hover:text-orange">
                {subiendo ? 'Subiendo…' : f.foto_url ? 'Cambiar foto' : 'Subir foto'}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && subirFoto(e.target.files[0])} />
              </label>
              {f.foto_url && (
                <button onClick={() => setF({ ...f, foto_url: '' })} className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-bold text-faint hover:text-red">Quitar</button>
              )}
            </div>
          </Campo>
          <div className="mt-1 flex gap-2">
            <button onClick={onGuardar} disabled={guardar.isPending || subiendo}
              className="flex-1 cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
              Guardar
            </button>
            <button onClick={cerrarEdit} className="cursor-pointer rounded-[10px] border border-line bg-white px-5 py-2.5 text-[13px] font-extrabold text-muted">Volver</button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── Lista del banco (catálogo con GIF) ────────────────────────────────────
  return (
    <Modal title="Banco de ejercicios" subtitle="1.300+ ejercicios con guía animada — la que ve el socio en su app" onClose={onClose} width={560}>
      <div className="mb-3 rounded-[10px] border border-line bg-[#FAFBFC] px-3.5 py-2.5 text-[12px] font-semibold leading-[1.5] text-muted">
        Cada ejercicio trae una <b>guía animada (GIF)</b> lista para usar. <b>Toca cualquiera</b> para
        personalizarlo con <b>tu propio video, tus fotos o tus indicaciones</b> — eso queda solo de tu gimnasio.
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="🔍 Buscar ejercicio…" />
      {(banco.isLoading || preparando) && <div className="mt-3"><LoadingState variant="table" rows={4} /></div>}
      <div className="mt-3 grid max-h-[56vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
        {lista.map((e) => (
          <button key={e.catalogo_id} onClick={() => abrir(e)} disabled={preparando}
            className="flex flex-col overflow-hidden rounded-[11px] border border-line bg-white text-left transition-colors hover:border-orange disabled:opacity-60">
            {e.gif_catalogo
              ? <img src={e.gif_catalogo} alt="" loading="lazy" className="h-[120px] w-full bg-[#0B0E14] object-contain" />
              : <div className="flex h-[120px] items-center justify-center bg-surface text-[11px] font-bold text-faint">Sin guía</div>}
            <div className="p-2.5">
              <div className="line-clamp-2 text-[12.5px] font-extrabold leading-tight">{e.nombre}</div>
              <div className="mt-0.5 flex items-center gap-1 text-[10.5px] font-bold text-muted">
                <span className="truncate">{e.target || e.body_part}</span>
                {e.personalizado && <span className="flex-shrink-0 rounded-full bg-orange-50 px-1.5 py-0.5 text-[9px] font-extrabold text-orange">✏️ tuyo</span>}
              </div>
            </div>
          </button>
        ))}
        {!banco.isLoading && !preparando && lista.length === 0 && (
          <div className="col-span-full rounded-[10px] bg-surface px-4 py-5 text-center text-[12.5px] font-semibold text-muted">
            {q ? 'Ningún ejercicio coincide.' : 'No se pudo cargar el banco.'}
          </div>
        )}
      </div>
    </Modal>
  )
}
