import { useEffect, useRef, useState } from 'react'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useGuardarEmpresa, subirImagen } from '../../hooks/useConfiguracion.js'

const SECCIONES = [
  ['promociones', 'Ofertas y promociones'], ['planes', 'Planes'], ['clases', 'Clases'],
  ['sedes', 'Sedes'], ['galeria', 'Galería'], ['stats', 'Estadísticas'], ['mapa', 'Mapa de ubicación'],
]

export default function TabPaginaWeb() {
  const { empresa, reloadBootstrap } = useAuth()
  const guardar = useGuardarEmpresa(empresa?.id)
  const [L, setL] = useState(null) // objeto landing en edición
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState('')
  const heroRef = useRef(null)
  const galRef = useRef(null)

  useEffect(() => {
    if (empresa) {
      const base = empresa.landing || {}
      setL({
        hero_url: base.hero_url || '',
        hero_overlay: base.hero_overlay ?? 0.55,
        galeria: base.galeria || [],
        stats: base.stats || [],
        ubicacion: base.ubicacion || { lat: '', lng: '' },
        secciones: { planes: true, clases: true, sedes: true, galeria: true, stats: true, mapa: true, promociones: true, ...(base.secciones || {}) },
      })
    }
  }, [empresa])

  if (!L) return <div className="text-[13px] text-muted">Cargando…</div>
  const upd = (patch) => { setL((s) => ({ ...s, ...patch })); setOk(false) }

  async function subirHero(file) {
    setBusy('hero')
    try { upd({ hero_url: await subirImagen(empresa.id, 'hero', file) + `?t=${file.size}` }) }
    catch (e) { alert('No se pudo subir: ' + e.message) } finally { setBusy('') }
  }
  async function agregarGaleria(files) {
    setBusy('galeria')
    try {
      const urls = []
      for (const f of files) urls.push(await subirImagen(empresa.id, 'galeria', f))
      upd({ galeria: [...L.galeria, ...urls] })
    } catch (e) { alert('No se pudo subir: ' + e.message) } finally { setBusy('') }
  }

  function onGuardar() {
    guardar.mutate({ landing: L }, {
      onSuccess: async () => { setOk(true); await reloadBootstrap() },
      onError: (e) => alert('No se pudo guardar: ' + e.message),
    })
  }

  return (
    <div className="max-w-[820px]">
      {/* Portada */}
      <Card className="p-[19px]">
        <div className="text-[14.5px] font-extrabold">Foto de portada (hero)</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Imagen de fondo del banner principal de tu página.</p>
        <div className="mt-4 overflow-hidden rounded-xl border border-line" style={{ height: 180, background: '#141B2E', position: 'relative' }}>
          {L.hero_url && <img src={L.hero_url} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0" style={{ background: `rgba(20,27,46,${L.hero_overlay})` }} />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="text-[18px] font-extrabold">{empresa.eslogan || 'Tu eslogan aquí'}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <button onClick={() => heroRef.current?.click()} disabled={busy === 'hero'}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-ink hover:border-orange disabled:opacity-50">
            {busy === 'hero' ? 'Subiendo…' : L.hero_url ? 'Cambiar portada' : 'Subir portada'}
          </button>
          {L.hero_url && <button onClick={() => upd({ hero_url: '' })} className="text-[12px] font-extrabold text-red">Quitar</button>}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11.5px] font-bold text-muted">Oscurecer</span>
            <input type="range" min="0" max="0.85" step="0.05" value={L.hero_overlay} onChange={(e) => upd({ hero_overlay: Number(e.target.value) })} className="accent-orange-600" />
          </div>
        </div>
        <input ref={heroRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subirHero(f); e.target.value = '' }} />
      </Card>

      {/* Galería */}
      <Card className="mt-4 p-[19px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14.5px] font-extrabold">Galería</div>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">Fotos de tus instalaciones y ambiente.</p>
          </div>
          <button onClick={() => galRef.current?.click()} disabled={busy === 'galeria'}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-ink hover:border-orange disabled:opacity-50">
            {busy === 'galeria' ? 'Subiendo…' : 'Agregar fotos'}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2.5">
          {L.galeria.map((url, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button onClick={() => upd({ galeria: L.galeria.filter((_, j) => j !== i) })}
                className="absolute right-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-extrabold text-white opacity-0 transition group-hover:opacity-100">✕</button>
            </div>
          ))}
          {L.galeria.length === 0 && <div className="col-span-4 rounded-lg border border-dashed border-line py-6 text-center text-[12px] font-semibold text-faint">Sin fotos aún</div>}
        </div>
        <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files || [])]; if (fs.length) agregarGaleria(fs); e.target.value = '' }} />
      </Card>

      {/* Estadísticas */}
      <Card className="mt-4 p-[19px]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14.5px] font-extrabold">Estadísticas</div>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">
              Números destacados. Si no agregas ninguno, se muestran automáticamente los <b>datos reales</b> del gym (socios activos, sedes, clases, entrenadores).
            </p>
          </div>
          <button onClick={() => upd({ stats: [...L.stats, { label: '', valor: '' }] })}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-ink hover:border-orange">Agregar dato</button>
        </div>
        <div className="mt-4 flex flex-col gap-2.5">
          {L.stats.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <input value={s.valor} onChange={(e) => upd({ stats: L.stats.map((x, j) => j === i ? { ...x, valor: e.target.value } : x) })} placeholder="500+"
                className="w-[110px] rounded-[9px] border border-line bg-white px-3 py-2 text-[13px] font-extrabold outline-none focus:border-orange" />
              <input value={s.label} onChange={(e) => upd({ stats: L.stats.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} placeholder="Miembros activos"
                className="flex-1 rounded-[9px] border border-line bg-white px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange" />
              <button onClick={() => upd({ stats: L.stats.filter((_, j) => j !== i) })} className="text-[12px] font-extrabold text-red">Quitar</button>
            </div>
          ))}
          {L.stats.length === 0 && <div className="text-[12px] font-semibold text-faint">Sin estadísticas. Agrega números que quieras mostrar.</div>}
        </div>
      </Card>

      {/* Ubicación (mapa) */}
      <Card className="mt-4 p-[19px]">
        <div className="text-[14.5px] font-extrabold">Ubicación en el mapa</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">
          En Google Maps: clic derecho sobre tu gimnasio → copia las coordenadas y pégalas aquí.
        </p>
        <div className="mt-4 flex items-center gap-2.5">
          <input value={L.ubicacion.lat} onChange={(e) => upd({ ubicacion: { ...L.ubicacion, lat: e.target.value.trim() } })} placeholder="Latitud (-12.0464)"
            className="w-[170px] rounded-[9px] border border-line bg-white px-3 py-2 text-[13px] font-bold outline-none focus:border-orange" />
          <input value={L.ubicacion.lng} onChange={(e) => upd({ ubicacion: { ...L.ubicacion, lng: e.target.value.trim() } })} placeholder="Longitud (-77.0428)"
            className="w-[170px] rounded-[9px] border border-line bg-white px-3 py-2 text-[13px] font-bold outline-none focus:border-orange" />
          <button
            onClick={() => {
              const partes = (L.ubicacion.lat || '').split(',')
              if (partes.length === 2) upd({ ubicacion: { lat: partes[0].trim(), lng: partes[1].trim() } })
            }}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[12px] font-extrabold text-muted hover:border-orange"
            title="Si pegaste 'lat, lng' junto en el primer campo, sepáralo">
            Separar
          </button>
        </div>
        {Number(L.ubicacion.lat) && Number(L.ubicacion.lng) ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-line">
            <iframe
              title="Mapa"
              className="h-[220px] w-full"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(L.ubicacion.lng) - 0.005}%2C${Number(L.ubicacion.lat) - 0.003}%2C${Number(L.ubicacion.lng) + 0.005}%2C${Number(L.ubicacion.lat) + 0.003}&layer=mapnik&marker=${L.ubicacion.lat}%2C${L.ubicacion.lng}`}
            />
          </div>
        ) : null}
      </Card>

      {/* Secciones visibles */}
      <Card className="mt-4 p-[19px]">
        <div className="text-[14.5px] font-extrabold">Secciones visibles</div>
        <p className="mt-0.5 text-[12px] font-semibold text-muted">Muestra u oculta partes de tu página web.</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {SECCIONES.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={!!L.secciones[key]} onChange={(e) => upd({ secciones: { ...L.secciones, [key]: e.target.checked } })} className="h-4 w-4 accent-orange-600" />
              <span className="text-[13px] font-bold">{label}</span>
            </label>
          ))}
        </div>
      </Card>

      <div className="mt-5 flex items-center gap-3">
        <PrimaryButton onClick={onGuardar} disabled={guardar.isPending}>{guardar.isPending ? 'Guardando…' : 'Guardar página web'}</PrimaryButton>
        {ok && <span className="text-[13px] font-extrabold text-green-600">Guardado ✓</span>}
        {empresa.slug && <a href={`${window.location.origin}/?g=${empresa.slug}`} target="_blank" rel="noreferrer" className="ml-auto text-[13px] font-extrabold text-orange">Ver mi página →</a>}
      </div>
    </div>
  )
}
