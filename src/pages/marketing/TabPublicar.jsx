import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { toast } from '../../lib/toast.js'

/**
 * PUBLICAR: un post, todas las redes (2026-09-02).
 *
 * El dueño sube su foto UNA vez y sale en Instagram, Facebook y TikTok sin
 * abrir tres apps.
 *
 * Lo importante de esta pantalla no es el formulario: es la VISTA PREVIA. Cada
 * red recorta distinto (Instagram cuadra la foto, TikTok la pone vertical) y
 * corta el texto en distinto punto. Mostrarle al dueño lo que va a pasar es más
 * honesto que describírselo — y evita la sorpresa de ver su promo con la cara
 * cortada.
 */

const REDES = [
  { id: 'instagram', nombre: 'Instagram', icono: '📸' },
  { id: 'messenger', nombre: 'Página de Facebook', icono: '💬' },
  { id: 'tiktok', nombre: 'TikTok', icono: '🎵', soloVideo: true },
]

const ESTADO_POST = {
  borrador: { txt: 'Borrador', cls: 'bg-line2 text-faint' },
  programada: { txt: 'Programada', cls: 'bg-orange-50 text-orange' },
  publicando: { txt: 'Publicando…', cls: 'bg-orange-50 text-orange' },
  publicada: { txt: 'Publicada', cls: 'bg-green-50 text-green-600' },
  fallida: { txt: 'Falló', cls: 'bg-red-50 text-red' },
}

const TOPE_TEXTO = 2200

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  return {
    authorization: `Bearer ${data?.session?.access_token || ''}`,
    'content-type': 'application/json',
  }
}

async function pedir(url, init) {
  const r = await fetch(url, { ...init, headers: await authHeader() })
  const out = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(out.error || 'Algo salió mal')
  return out
}

/**
 * Lo que impide publicar (⛔) y lo que solo conviene saber (💡).
 *
 * Se valida ANTES, no descubriendo el error en el historial: que TikTok rechace
 * un post sin video es predecible, y decírselo al dueño cuando aún puede
 * arreglarlo cuesta lo mismo que decírselo después.
 */
function chequeos(canales, tipoMedia, hayMedia) {
  const out = []
  if (canales.includes('tiktok') && tipoMedia !== 'video') {
    out.push({ tipo: 'bloqueo', txt: 'TikTok solo publica videos: agrega uno (MP4 o MOV).' })
  }
  if (canales.includes('instagram') && !hayMedia) {
    out.push({ tipo: 'bloqueo', txt: 'Instagram no publica solo texto: agrega una foto o un video.' })
  }
  if (canales.includes('tiktok')) {
    out.push({ tipo: 'aviso', txt: 'En TikTok los DM no llegan al panel: sirve para publicar, no para conversar.' })
  }
  return out
}

export default function TabPublicar({ sedeId }) {
  const qc = useQueryClient()
  const [texto, setTexto] = useState('')
  const [canales, setCanales] = useState(['instagram'])
  const [media, setMedia] = useState(null) // { url, tipoMedia }
  const [subiendo, setSubiendo] = useState(false)
  const [publicando, setPublicando] = useState(false)
  const [programar, setProgramar] = useState(false)
  const [cuando, setCuando] = useState('')
  const [previa, setPrevia] = useState('instagram')
  const fileRef = useRef(null)

  const historial = useQuery({
    queryKey: ['pub-historial', sedeId],
    queryFn: () => pedir(`/api/leadia?action=publicar&op=listar&sedeId=${sedeId}`),
    refetchInterval: 30000, // una publicación en curso avanza sola
  })

  if (historial.data?.activo === false) {
    return (
      <Card className="p-6">
        <div className="text-[14px] font-extrabold">Finny todavía no está activo en esta sede</div>
        <p className="mt-1 text-[13px] font-semibold leading-relaxed text-muted">
          Publicar usa las redes que conectas para Finny. Actívalo en
          Configuración › Finny y conecta Instagram, Facebook o TikTok.
        </p>
      </Card>
    )
  }

  async function subirArchivo(file) {
    if (!file) return
    // Se valida en el navegador ANTES de subir: descubrir el peso después de
    // esperar la subida es la peor forma de enterarse.
    if (file.size > 3 * 1024 * 1024) {
      toast.error(`Tu archivo pesa ${(file.size / 1024 / 1024).toFixed(1)}MB y el máximo es 3MB. Usa uno más liviano.`)
      return
    }
    setSubiendo(true)
    try {
      const dataUrl = await new Promise((ok, err) => {
        const fr = new FileReader()
        fr.onload = () => ok(fr.result)
        fr.onerror = () => err(new Error('No se pudo leer el archivo'))
        fr.readAsDataURL(file)
      })
      const out = await pedir(`/api/leadia?action=publicar&op=media&sedeId=${sedeId}`, {
        method: 'POST', body: JSON.stringify({ sedeId, imagen: dataUrl }),
      })
      setMedia({ url: out.url, tipoMedia: out.tipoMedia })
    } catch (e) {
      toast.error(e.message)
    } finally { setSubiendo(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function publicarPost() {
    if (publicando) return
    setPublicando(true)
    try {
      await pedir(`/api/leadia?action=publicar&op=crear&sedeId=${sedeId}`, {
        method: 'POST',
        body: JSON.stringify({
          sedeId, texto, canales,
          ...(media ? { mediaUrls: [media.url], tipoMedia: media.tipoMedia } : {}),
          ...(programar && cuando ? { programadaPara: new Date(cuando).toISOString() } : {}),
        }),
      })
      toast.ok(programar ? 'Post programado.' : 'Post enviado a tus redes.')
      setTexto(''); setMedia(null); setProgramar(false); setCuando('')
      qc.invalidateQueries({ queryKey: ['pub-historial', sedeId] })
    } catch (e) {
      toast.error(e.message)
    } finally { setPublicando(false) }
  }

  const problemas = chequeos(canales, media?.tipoMedia, !!media)
  const bloqueos = problemas.filter((p) => p.tipo === 'bloqueo')
  const puede = texto.trim() && canales.length > 0 && bloqueos.length === 0
    && !publicando && !subiendo && (!programar || cuando)

  const items = historial.data?.items || []

  return (
    <div>
      <div className="rounded-[12px] bg-orange-50 p-3.5">
        <p className="text-[12px] font-semibold leading-relaxed text-orange">
          📸 En TikTok se publica de verdad. En Instagram y Facebook falta que
          Meta apruebe el permiso (en trámite) — mientras tanto el post queda
          guardado y listo.
        </p>
      </div>

      <Card className="mt-3 p-4">
        <div className="border-b border-line pb-3">
          <div className="text-[14px] font-extrabold">Arma tu publicación</div>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">
            Sube tu foto, escribe el texto y elige a qué redes va. Antes de
            publicar ves cómo va a quedar.
          </p>
        </div>

        <label className="mt-3 block">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-extrabold text-muted">Texto del post</span>
            <span className={`text-[10.5px] font-semibold ${
              texto.length > TOPE_TEXTO - 100 ? 'font-extrabold text-red' : 'text-faint'}`}>
              {texto.length} / {TOPE_TEXTO}
            </span>
          </div>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value.slice(0, TOPE_TEXTO))} rows={4}
            placeholder="Ej: Este mes 2x1 en la mensualidad 💪 Ven con un amigo y entrenen juntos. Escríbenos y te contamos."
            className="mt-1 w-full resize-none rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold outline-none focus:border-orange" />
        </label>

        <div className="mt-3">
          <span className="text-[11.5px] font-extrabold text-muted">Foto o video</span>
          {!media ? (
            <div className="mt-1">
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden"
                onChange={(e) => subirArchivo(e.target.files?.[0])} />
              <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                className="w-full cursor-pointer rounded-[10px] border border-dashed border-line bg-white py-4 text-[12px] font-extrabold text-muted transition-colors hover:border-orange hover:text-orange disabled:opacity-50">
                {subiendo ? 'Subiendo…' : '📷 Agregar foto o video'}
              </button>
              <p className="mt-1 text-[11px] font-semibold text-faint">
                Hasta 3MB. Instagram necesita imagen o video; TikTok solo video.
              </p>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-3 rounded-[10px] border border-line p-2">
              {media.tipoMedia === 'video'
                ? <video src={media.url} className="h-16 w-16 rounded object-cover" muted />
                : <img src={media.url} alt="" className="h-16 w-16 rounded object-cover" />}
              <span className="text-[12px] font-semibold text-muted">
                {media.tipoMedia === 'video' ? 'Video listo' : 'Foto lista'}
              </span>
              <button onClick={() => setMedia(null)}
                className="ml-auto cursor-pointer border-none bg-transparent text-[11.5px] font-extrabold text-muted hover:text-red">
                Quitar
              </button>
            </div>
          )}
        </div>

        <div className="mt-3">
          <span className="text-[11.5px] font-extrabold text-muted">¿Dónde se publica?</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {REDES.map((r) => {
              const on = canales.includes(r.id)
              return (
                <button key={r.id}
                  onClick={() => setCanales((c) => on ? c.filter((x) => x !== r.id) : [...c, r.id])}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-[11.5px] font-extrabold transition-colors ${
                    on ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
                  {r.icono} {r.nombre}
                </button>
              )
            })}
          </div>
        </div>

        {problemas.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {problemas.map((p, i) => (
              <div key={i} className={`rounded-[9px] px-3 py-2 text-[11.5px] font-semibold leading-relaxed ${
                p.tipo === 'bloqueo' ? 'bg-red-50 text-red' : 'bg-line2 text-muted'}`}>
                {p.tipo === 'bloqueo' ? '⛔' : '💡'} {p.txt}
              </div>
            ))}
          </div>
        )}

        {(texto || media) && canales.length > 0 && (
          <Previa texto={texto} media={media} canales={canales} activa={previa} onCambiar={setPrevia} />
        )}

        <div className="mt-3 border-t border-line pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-muted">
            <input type="checkbox" checked={programar} className="accent-orange"
              onChange={(e) => setProgramar(e.target.checked)} />
            Programar para más tarde
          </label>
          {programar && (
            <input type="datetime-local" value={cuando} onChange={(e) => setCuando(e.target.value)}
              className="mt-2 rounded-[10px] border border-line px-3 py-2 text-[12.5px] font-semibold outline-none focus:border-orange" />
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <button onClick={publicarPost} disabled={!puede}
            className="cursor-pointer rounded-[9px] border-none bg-orange px-4 py-2 text-[12px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
            {publicando ? 'Enviando…' : programar ? 'Programar post' : 'Publicar ahora'}
          </button>
        </div>
      </Card>

      <div className="mt-4">
        <div className="text-[14px] font-extrabold">Tus publicaciones</div>
        {historial.isLoading && <p className="mt-2 text-[13px] font-semibold text-faint">Cargando…</p>}
        {!historial.isLoading && items.length === 0 && (
          <Card className="mt-2 p-8 text-center">
            <div className="text-[14px] font-extrabold">Todavía no publicaste nada</div>
            <p className="mt-1 text-[12.5px] font-semibold text-muted">
              Sube una foto de tu gym, escribe algo y sale en todas tus redes.
            </p>
          </Card>
        )}
        {items.length > 0 && (
          <div className="mt-2 space-y-2.5">
            {items.map((p) => {
              const e = ESTADO_POST[p.estado] || { txt: p.estado, cls: 'bg-line2 text-faint' }
              return (
                <Card key={p.id} className="flex items-start gap-3 p-3.5">
                  {p.mediaUrls?.[0] && (
                    p.tipoMedia === 'video'
                      ? <video src={p.mediaUrls[0]} className="h-14 w-14 shrink-0 rounded object-cover" muted />
                      : <img src={p.mediaUrls[0]} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[12.5px] font-semibold leading-relaxed">{p.texto}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {(p.canales || []).map((c) => (
                        <span key={c} className="rounded-full bg-line2 px-1.5 py-0.5 text-[10px] font-extrabold text-faint">
                          {REDES.find((r) => r.id === c)?.nombre || c}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${e.cls}`}>{e.txt}</span>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Cómo se va a ver en cada red.
 *
 * Instagram recorta CUADRADO (por eso `aspect-square`): así el dueño ve lo que
 * la red le va a cortar de una foto vertical, que es justo la sorpresa que se
 * quiere evitar. TikTok es 9:16 con el video entero (`object-contain`) para que
 * se vean las franjas de un video horizontal.
 */
function Previa({ texto, media, canales, activa, onCambiar }) {
  const cual = canales.includes(activa) ? activa : canales[0]

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-faint">Así se va a ver</span>
        {canales.length > 1 && (
          <div className="flex gap-1">
            {canales.map((c) => (
              <button key={c} onClick={() => onCambiar(c)}
                className={`cursor-pointer rounded-full border-none px-2 py-0.5 text-[10.5px] font-extrabold ${
                  cual === c ? 'bg-ink text-white' : 'bg-line2 text-muted'}`}>
                {REDES.find((r) => r.id === c)?.icono}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-1.5 flex justify-center rounded-[12px] bg-line2/40 p-4">
        {cual === 'tiktok' ? (
          <div className="w-[180px] overflow-hidden rounded-[10px] bg-black">
            <div className="relative aspect-[9/16]">
              {media?.tipoMedia === 'video'
                ? <video src={media.url} className="h-full w-full object-contain" muted />
                : <div className="grid h-full place-items-center px-3 text-center text-[10px] font-semibold text-white/60">
                    TikTok necesita un video vertical
                  </div>}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 p-2">
                <p className="text-[9.5px] font-semibold leading-snug text-white line-clamp-3">{texto}</p>
              </div>
            </div>
          </div>
        ) : cual === 'instagram' ? (
          <div className="w-[240px] overflow-hidden rounded-[10px] bg-white">
            <div className="flex items-center gap-2 p-2">
              <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]" />
              <span className="text-[10px] font-extrabold">tu gimnasio</span>
            </div>
            {media
              ? (media.tipoMedia === 'video'
                  ? <video src={media.url} className="aspect-square w-full object-cover" muted />
                  : <img src={media.url} alt="" className="aspect-square w-full object-cover" />)
              : <div className="grid aspect-square w-full place-items-center bg-line2 px-3 text-center text-[10px] font-semibold text-faint">
                  Instagram necesita una foto o un video
                </div>}
            <div className="px-2 py-1.5 text-[11px]">♡ 💬 ➤</div>
            <p className="px-2 pb-2 text-[10px] font-semibold leading-snug text-ink line-clamp-3">{texto}</p>
          </div>
        ) : (
          <div className="w-[260px] overflow-hidden rounded-[10px] bg-white">
            <div className="flex items-center gap-2 p-2">
              <div className="h-6 w-6 rounded-full bg-[#1877f2]" />
              <div>
                <div className="text-[10px] font-extrabold">Tu gimnasio</div>
                <div className="text-[9px] font-semibold text-faint">ahora · 🌎</div>
              </div>
            </div>
            <p className="px-2 pb-2 text-[10px] font-semibold leading-snug line-clamp-4">{texto}</p>
            {media && (media.tipoMedia === 'video'
              ? <video src={media.url} className="max-h-40 w-full bg-black object-contain" muted />
              : <img src={media.url} alt="" className="max-h-40 w-full bg-black object-contain" />)}
            <div className="border-t border-line px-2 py-1.5 text-[9.5px] font-semibold text-faint">
              👍 Me gusta · 💬 Comentar · ↗ Compartir
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
