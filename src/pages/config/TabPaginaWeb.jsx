import { useEffect, useRef, useState } from 'react'
import { Card, PrimaryButton } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { useGuardarEmpresa, subirImagen } from '../../hooks/useConfiguracion.js'

const SECCIONES = [
  ['promociones', 'Ofertas y promociones'], ['planes', 'Planes'], ['clases', 'Clases'],
  ['sedes', 'Sedes'], ['galeria', 'Galería'], ['stats', 'Estadísticas'], ['mapa', 'Mapa de ubicación'],
]

const MAX_GALERIA = 12 // tope de fotos en la galería

// Diseños de página: cambian la ESTRUCTURA de la landing, no solo colores.
const DISENOS = [
  ['clasico', 'Clásico', 'Foto de fondo, centrado y sobrio'],
  ['split', 'Panorama', 'Texto y foto lado a lado'],
  ['dark', 'Nocturno', 'Página oscura, dramática'],
  ['minimal', 'Minimal', 'Tipográfico, limpio, con aire'],
  ['bold', 'Impacto', 'Degradados y letra gigante'],
]

// Mini-boceto visual de cada diseño para el selector.
function MiniDiseno({ k }) {
  const base = 'h-12 w-full overflow-hidden rounded-md border border-line'
  if (k === 'split') return (
    <div className={`${base} flex bg-[#141B2E]`}>
      <div className="flex flex-1 flex-col justify-center gap-1 p-1.5">
        <div className="h-1.5 w-3/4 rounded bg-white/70" /><div className="h-1 w-1/2 rounded bg-white/30" />
        <div className="mt-0.5 h-2 w-8 rounded bg-orange" />
      </div>
      <div className="m-1.5 w-2/5 rounded bg-white/25" />
    </div>
  )
  if (k === 'dark') return (
    <div className={`${base} bg-black p-1.5`}>
      <div className="mx-auto h-1.5 w-2/3 rounded bg-white/60" />
      <div className="mt-1.5 flex gap-1">{[0,1,2].map(i => <div key={i} className="h-4 flex-1 rounded bg-white/10" />)}</div>
    </div>
  )
  if (k === 'minimal') return (
    <div className={`${base} bg-white p-1.5 text-center`}>
      <div className="mx-auto h-2 w-3/4 rounded bg-[#141B2E]" />
      <div className="mx-auto mt-1 h-1 w-8 rounded bg-orange" />
      <div className="mx-auto mt-1.5 h-3 w-full rounded bg-[#E9EBF0]" />
    </div>
  )
  if (k === 'bold') return (
    <div className={`${base} bg-gradient-to-br from-[#141B2E] to-orange p-1.5 text-center`}>
      <div className="mx-auto mt-1 h-2.5 w-4/5 rounded bg-white/90" />
      <div className="mx-auto mt-1 h-1 w-10 -skew-x-12 bg-orange" />
    </div>
  )
  return ( // clasico
    <div className={`${base} flex flex-col items-center justify-center gap-1 bg-[#141B2E] p-1.5`}>
      <div className="h-1.5 w-2/3 rounded bg-white/70" />
      <div className="h-1 w-1/2 rounded bg-white/30" />
      <div className="h-2 w-8 rounded bg-orange" />
    </div>
  )
}

// Plantillas completas: diseño + colores + estilo de botones, de un clic.
const PLANTILLAS = [
  { nombre: 'Energía',   primary: '#E11D48', oscuro: '#0C0A09', diseno: 'clasico', botones: 'pill' },
  { nombre: 'Océano',    primary: '#2563EB', oscuro: '#0B1220', diseno: 'split',   botones: 'suave' },
  { nombre: 'Bosque',    primary: '#059669', oscuro: '#06231B', diseno: 'minimal', botones: 'recto' },
  { nombre: 'Atardecer', primary: '#F97316', oscuro: '#1C1210', diseno: 'split',   botones: 'pill' },
  { nombre: 'Neón',      primary: '#A855F7', oscuro: '#140524', diseno: 'dark',    botones: 'pill' },
  { nombre: 'Grafito',   primary: '#1F2937', oscuro: '#030712', diseno: 'minimal', botones: 'recto' },
  { nombre: 'Fuego',     primary: '#DC2626', oscuro: '#180404', diseno: 'bold',    botones: 'recto' },
  { nombre: 'Eléctrico', primary: '#06B6D4', oscuro: '#041418', diseno: 'bold',    botones: 'pill' },
]

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

// Estilo aleatorio con paletas que siempre se ven bien (matiz al azar,
// primario saturado + fondo muy oscuro del mismo matiz).
function estiloAleatorio() {
  const h = Math.floor(Math.random() * 360)
  return {
    colores: { primary: hslToHex(h, 78, 46), oscuro: hslToHex(h, 45, 7) },
    botones: ['pill', 'suave', 'recto'][Math.floor(Math.random() * 3)],
    overlay: [0.45, 0.55, 0.65][Math.floor(Math.random() * 3)],
    diseno: DISENOS[Math.floor(Math.random() * DISENOS.length)][0],
  }
}

export default function TabPaginaWeb() {
  const { empresa, tema, reloadBootstrap } = useAuth()
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
        colores: base.colores || null, // null = heredar los colores de la marca
        estilo: base.estilo || { botones: 'suave' },
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
    const cupo = MAX_GALERIA - L.galeria.length
    if (cupo <= 0) return
    const lote = files.slice(0, cupo) // respetar el tope aunque seleccionen más
    if (files.length > cupo) alert(`Máximo ${MAX_GALERIA} fotos: se subirán solo las primeras ${cupo}.`)
    setBusy('galeria')
    try {
      const urls = []
      for (const f of lote) urls.push(await subirImagen(empresa.id, 'galeria', f))
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
            <div className="text-[14.5px] font-extrabold">Galería <span className="text-[12px] font-bold text-faint">({L.galeria.length}/{MAX_GALERIA})</span></div>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">Fotos de tus instalaciones y ambiente. Máximo {MAX_GALERIA}.</p>
          </div>
          <button onClick={() => galRef.current?.click()} disabled={busy === 'galeria' || L.galeria.length >= MAX_GALERIA}
            className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12.5px] font-extrabold text-ink hover:border-orange disabled:opacity-50">
            {busy === 'galeria' ? 'Subiendo…' : L.galeria.length >= MAX_GALERIA ? 'Límite alcanzado' : 'Agregar fotos'}
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

      {/* Estilo y colores de la página (independientes de la marca del panel) */}
      <Card className="mt-4 p-[19px]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[14.5px] font-extrabold">Estilo y colores de la página</div>
            <p className="mt-0.5 text-[12px] font-semibold text-muted">
              Elige una plantilla, prueba suerte con el aleatorio, o personaliza cada color.
            </p>
          </div>
          <button
            onClick={() => {
              const r = estiloAleatorio()
              upd({ colores: r.colores, hero_overlay: r.overlay, estilo: { ...(L.estilo || {}), botones: r.botones, diseno: r.diseno } })
            }}
            className="flex-shrink-0 cursor-pointer rounded-full border-none bg-ink px-4 py-2 text-[12.5px] font-extrabold text-white transition-transform hover:scale-[1.03] active:scale-[0.97]"
          >
            🎲 Sorpréndeme
          </button>
        </div>

        {/* Diseño de página (estructura) */}
        <div className="mt-4">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Diseño de la página</div>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {DISENOS.map(([k, lab, desc]) => {
              const activo = (L.estilo?.diseno || 'clasico') === k
              return (
                <button key={k}
                  onClick={() => upd({ estilo: { ...(L.estilo || {}), diseno: k } })}
                  className={`rounded-xl border p-2 text-left transition-colors ${activo ? 'border-orange bg-orange-50' : 'border-line bg-white hover:border-orange'}`}>
                  <MiniDiseno k={k} />
                  <div className="mt-1.5 text-[12px] font-extrabold">{lab}</div>
                  <div className="text-[10px] font-semibold leading-tight text-faint">{desc}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Plantillas completas: diseño + colores + botones de un clic */}
        <div className="mt-4">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Plantillas (diseño + colores)</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {PLANTILLAS.map((t) => {
              const activa = L.colores?.primary === t.primary && L.colores?.oscuro === t.oscuro
                && (L.estilo?.diseno || 'clasico') === t.diseno
              return (
                <button key={t.nombre}
                  onClick={() => upd({
                    colores: { primary: t.primary, oscuro: t.oscuro },
                    estilo: { ...(L.estilo || {}), diseno: t.diseno, botones: t.botones },
                  })}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-extrabold transition-colors ${activa ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-ink hover:border-orange'}`}>
                  <span className="h-3.5 w-3.5 rounded-full" style={{ background: t.primary }} />
                  <span className="h-3.5 w-3.5 rounded-full border border-line" style={{ background: t.oscuro }} />
                  {t.nombre}
                  <span className="text-[10px] font-bold text-faint">· {DISENOS.find(d => d[0] === t.diseno)?.[1]}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Colores personalizados */}
        <label className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!L.colores}
            onChange={(e) =>
              upd({
                colores: e.target.checked
                  ? { primary: tema?.color_primary || '#FF6B35', oscuro: tema?.color_navy || '#141B2E' }
                  : null,
              })
            }
            className="h-4 w-4 accent-orange-600"
          />
          <span className="text-[13px] font-bold">Personalizar colores de la página</span>
        </label>
        {L.colores && (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-[11.5px] font-semibold text-faint">
              Se inician con los colores de tu marca — elige otros para que la página se vea diferente al panel.
            </p>
            {[
              ['primary', 'Color principal (botones, ofertas y acentos)'],
              ['oscuro', 'Fondo oscuro (portada y pie de página)'],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-bold">{label}</span>
                <div className="flex items-center gap-2">
                  <input type="color" value={L.colores[key] || '#000000'}
                    onChange={(e) => upd({ colores: { ...L.colores, [key]: e.target.value } })}
                    className="h-8 w-10 cursor-pointer rounded border border-line bg-white" />
                  <input value={L.colores[key] || ''}
                    onChange={(e) => upd({ colores: { ...L.colores, [key]: e.target.value } })}
                    className="w-[92px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[12px] font-bold outline-none focus:border-orange" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Estilo de botones */}
        <div className="mt-5">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Estilo de botones</div>
          <div className="mt-2 flex gap-2">
            {[['pill', 'Redondeados'], ['suave', 'Suaves'], ['recto', 'Rectos']].map(([k, lab]) => {
              const activo = (L.estilo?.botones || 'suave') === k
              return (
                <button key={k}
                  onClick={() => upd({ estilo: { ...(L.estilo || {}), botones: k } })}
                  className={`border px-4 py-2 text-[12.5px] font-extrabold transition-colors ${activo ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}
                  style={{ borderRadius: k === 'pill' ? 999 : k === 'suave' ? 10 : 4 }}>
                  {lab}
                </button>
              )
            })}
          </div>
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
