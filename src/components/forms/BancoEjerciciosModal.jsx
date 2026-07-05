import { useState } from 'react'
import Modal, { Campo, inputCls } from '../Modal.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useCatalogoEjercicios, useGuardarMediaEjercicio, subirFotoEjercicio } from '../../hooks/useEjercicios.js'
import { parseVideo } from '../../lib/video.js'
import { toast } from '../../lib/toast.js'
import { LoadingState } from '../states.jsx'

// Gestión del banco de ejercicios: por cada uno, el gym llena cómo se ejecuta
// bien (descripción + video embebible de YouTube/Vimeo + foto). El socio lo ve
// en la app al abrir el ejercicio de su rutina — un instructivo por ejercicio,
// reutilizado en toda rutina que lo use.
export default function BancoEjerciciosModal({ onClose }) {
  const { empresa } = useAuth()
  const catalogo = useCatalogoEjercicios(empresa?.id)
  const guardar = useGuardarMediaEjercicio(empresa?.id)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null) // ejercicio en edición
  const [f, setF] = useState({ descripcion: '', video_url: '', foto_url: '', grupo_muscular: '' })
  const [subiendo, setSubiendo] = useState(false)

  const lista = (catalogo.data || []).filter(
    (e) => !q || e.nombre.toLowerCase().includes(q.toLowerCase()))

  function abrir(ej) {
    setEdit(ej)
    setF({
      descripcion: ej.descripcion || '', video_url: ej.video_url || '',
      foto_url: ej.foto_url || '', grupo_muscular: ej.grupo_muscular || '',
    })
  }

  const vid = parseVideo(f.video_url)
  const videoInvalido = f.video_url.trim() && !vid
  // El link CORTO de TikTok (vm.tiktok.com/XXXX) no trae el ID del video, así
  // que no se puede embeber: pedir el enlace completo del video.
  const esTikTokCorto = /vm\.tiktok\.com/i.test(f.video_url)

  async function subirFoto(file) {
    setSubiendo(true)
    try {
      const url = await subirFotoEjercicio(empresa.id, edit.id, file)
      setF((s) => ({ ...s, foto_url: url }))
    } catch (e) { toast.error('No se pudo subir la foto: ' + e.message) } finally { setSubiendo(false) }
  }

  function onGuardar() {
    if (videoInvalido) { toast.error('El link de video debe ser de TikTok, YouTube o Vimeo'); return }
    guardar.mutate({ id: edit.id, ...f }, {
      onSuccess: () => { toast.ok(`Media de "${edit.nombre}" guardada`); setEdit(null) },
      onError: (e) => toast.error(e.message),
    })
  }

  // Vista de edición de un ejercicio
  if (edit) {
    return (
      <Modal title={edit.nombre} subtitle="Personalízalo para tu gimnasio — lo verá el socio en su app" onClose={() => setEdit(null)} width={480}>
        <div className="flex flex-col gap-3.5">
          <p className="rounded-[9px] bg-orange-50 px-3 py-2 text-[11.5px] font-semibold leading-[1.45] text-orange-800">
            💡 Viene con una guía genérica. Cámbiala por <b>tu propio video o fotos</b> y tus indicaciones — quedará solo para tu gimnasio.
          </p>
          <Campo label="Grupo muscular">
            <input value={f.grupo_muscular} onChange={(e) => setF({ ...f, grupo_muscular: e.target.value })} className={inputCls} placeholder="Pecho, Espalda, Pierna…" />
          </Campo>
          <Campo label="Descripción / instrucciones">
            <textarea rows={3} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })}
              className={inputCls + ' resize-none'} placeholder="Espalda recta, baja controlado, codos pegados…" />
          </Campo>
          <Campo label="Video de técnica (TikTok, YouTube o Vimeo)" hint="Recomendamos TikTok: reproduce siempre embebido. YouTube funciona, pero algunos videos no se dejan incrustar.">
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
              ⚠️ Algunos videos de YouTube no permiten reproducirse dentro de apps. Revisa la vista previa: si sale "video no disponible", usa un TikTok o busca otro video.
            </p>
          )}
          {/* Vista previa EMBEBIDA: el gym confirma que se ve bien.
              TikTok es vertical (9:16); YouTube/Vimeo horizontal (16:9). */}
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
            <button onClick={() => setEdit(null)} className="cursor-pointer rounded-[10px] border border-line bg-white px-5 py-2.5 text-[13px] font-extrabold text-muted">Volver</button>
          </div>
        </div>
      </Modal>
    )
  }

  // Lista del catálogo
  return (
    <Modal title="Banco de ejercicios" subtitle="La guía de ejecución que ve el socio en su app" onClose={onClose} width={480}>
      <div className="mb-3 rounded-[10px] border border-line bg-[#FAFBFC] px-3.5 py-2.5 text-[12px] font-semibold leading-[1.5] text-muted">
        Cada ejercicio trae una <b>guía genérica de arranque</b> (descripción + video). <b>Toca cualquiera</b> para
        ver el detalle y <b>personalizarlo con lo tuyo</b>: tu propio video, tus fotos, tus indicaciones. Lo que
        edites es solo de tu gimnasio. Los ejercicios que crees en las rutinas aparecen aquí automáticamente.
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} placeholder="🔍 Buscar ejercicio…" />
      {catalogo.isLoading && <div className="mt-3"><LoadingState variant="table" rows={4} /></div>}
      <div className="mt-3 flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto">
        {lista.map((e) => {
          const tieneVideo = !!parseVideo(e.video_url)
          const completo = tieneVideo || e.descripcion || e.foto_url
          return (
            <button key={e.id} onClick={() => abrir(e)}
              className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-left hover:border-orange">
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-extrabold">{e.nombre}</div>
                <div className="text-[11px] font-semibold text-muted">{e.grupo_muscular || 'Sin grupo'}</div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1.5 text-[11px] font-extrabold">
                {tieneVideo && <span title="Con video">🎬</span>}
                {e.foto_url && <span title="Con foto">🖼️</span>}
                {completo
                  ? <span className="text-orange">personalizar →</span>
                  : <span className="text-faint">añadir guía →</span>}
              </div>
            </button>
          )
        })}
        {!catalogo.isLoading && lista.length === 0 && (
          <div className="rounded-[10px] bg-surface px-4 py-5 text-center text-[12.5px] font-semibold text-muted">
            {q ? 'Ningún ejercicio coincide.' : 'Aún no hay ejercicios en el banco. Se crean solos al escribirlos en una rutina.'}
          </div>
        )}
      </div>
    </Modal>
  )
}
