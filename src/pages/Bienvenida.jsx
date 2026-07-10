import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { FitCoreLogo } from '../components/icons.jsx'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import { subirBranding } from '../hooks/useConfiguracion.js'
import DireccionAutocomplete from '../components/forms/DireccionAutocomplete.jsx'
import HorarioEditor, { HORARIO_DEFAULT, resumenHorario } from '../components/forms/HorarioEditor.jsx'
import { urlPublica } from '../lib/tenant.js'

// Extrae los colores dominantes del logo (canvas): se agrupan por tono,
// se descartan grises/blancos/negros y se devuelven los 4 más presentes.
function extraerColoresDeLogo(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const N = 48
        const canvas = document.createElement('canvas')
        canvas.width = N; canvas.height = N
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, N, N)
        const { data } = ctx.getImageData(0, 0, N, N)
        const buckets = new Map()
        for (let i = 0; i < data.length; i += 4) {
          const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
          if (a < 128) continue // transparente
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          if (max - min < 28) continue // gris/blanco/negro: no sirve de color de marca
          if (max > 245 || max < 40) continue // casi blanco o casi negro
          // agrupar en cubos de 32 por canal
          const key = `${r >> 5}-${g >> 5}-${b >> 5}`
          const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 }
          e.r += r; e.g += g; e.b += b; e.n++
          buckets.set(key, e)
        }
        const hex = (n) => Math.round(n).toString(16).padStart(2, '0')
        const top = [...buckets.values()]
          .sort((a, b) => b.n - a.n)
          .slice(0, 4)
          .map((e) => `#${hex(e.r / e.n)}${hex(e.g / e.n)}${hex(e.b / e.n)}`)
        resolve(top)
      } catch { resolve([]) }
    }
    img.onerror = () => resolve([])
    img.src = url
  })
}

// Asistente de bienvenida: 3-4 preguntas según el TIPO de negocio y armamos
// su espacio con datos reales (disciplinas, planes con sus precios, contacto,
// marca). Todo saltable — si salta, se queda el seed genérico del registro.

// El tipo de negocio se infiere del plan comercial (columna empresa.plan_slug)
const TIPO_POR_PLAN = { academia: 'clases', ninos: 'ninos', trainer: 'personal_trainer' }

// ── Preguntas por tipo ───────────────────────────────────────────────────────
const DISCIPLINAS = {
  fitness: [
    { nombre: 'Musculación', color: '#E24B4A', acceso_libre: true, fijo: true },
    { nombre: 'Funcional', color: '#FF6B35' }, { nombre: 'Spinning', color: '#1D9E75' },
    { nombre: 'Box', color: '#374151' }, { nombre: 'CrossFit', color: '#7C3AED' },
    { nombre: 'Zumba', color: '#E11D48' }, { nombre: 'Yoga', color: '#8B5CF6' },
    { nombre: 'HIIT', color: '#F59E0B' }, { nombre: 'Pilates', color: '#059669' },
    { nombre: 'Baile', color: '#EC4899' },
  ],
  clases: [
    { nombre: 'Yoga', color: '#8B5CF6' }, { nombre: 'Pilates', color: '#059669' },
    { nombre: 'Baile', color: '#E11D48' }, { nombre: 'Ballet', color: '#EC4899' },
    { nombre: 'Marinera', color: '#B45309' }, { nombre: 'Jiu-Jitsu Brasileño', color: '#1D4ED8' },
    { nombre: 'Muay Thai', color: '#DC2626' }, { nombre: 'Karate', color: '#0C0A09' },
    { nombre: 'Box', color: '#374151' }, { nombre: 'MMA', color: '#111827' },
    { nombre: 'Zumba', color: '#F97316' }, { nombre: 'Stretching', color: '#2563EB' },
  ],
  ninos: [
    { nombre: 'Psicomotricidad', color: '#2563EB' }, { nombre: 'Baile infantil', color: '#E11D48' },
    { nombre: 'Karate niños', color: '#0C0A09' }, { nombre: 'Mini funcional', color: '#F97316' },
    { nombre: 'Ballet', color: '#EC4899' }, { nombre: 'Fútbol', color: '#16A34A' },
    { nombre: 'Gimnasia', color: '#8B5CF6' }, { nombre: 'Vacaciones útiles', color: '#0EA5E9' },
  ],
  personal_trainer: [
    { nombre: 'Sesión personal', color: '#FF6B35' }, { nombre: 'Sesión en pareja', color: '#2563EB' },
    { nombre: 'Grupo pequeño', color: '#059669' }, { nombre: 'Entrenamiento online', color: '#8B5CF6' },
  ],
}

const PLANES_SUGERIDOS = {
  fitness: [
    { nombre: 'Mensual', precio: 80, unidad: 'mes', popular: true, congela: 15 },
    { nombre: 'Trimestral', precio: 210, unidad: 'trimestre', congela: 15 },
    { nombre: 'Anual', precio: 700, unidad: 'anual', congela: 30 },
    { nombre: 'Por día', precio: 10, unidad: 'dia' },
  ],
  clases: [
    { nombre: 'Mensual ilimitado', precio: 150, unidad: 'mes', popular: true, congela: 15 },
    { nombre: 'Mensual 8 clases', precio: 100, unidad: 'mes' },
    { nombre: 'Clase suelta', precio: 20, unidad: 'dia' },
  ],
  ninos: [
    { nombre: 'Mensual', precio: 150, unidad: 'mes', popular: true },
    { nombre: 'Plan Hermanos', precio: 250, unidad: 'mes', descripcion: 'Hasta 2 hermanos' },
    { nombre: 'Vacaciones útiles', precio: 200, unidad: 'mes' },
  ],
  personal_trainer: [
    { nombre: 'Mensual 12 sesiones', precio: 350, unidad: 'mes', popular: true },
    { nombre: 'Paquete 8 sesiones', precio: 260, unidad: 'mes' },
    { nombre: 'Sesión suelta', precio: 40, unidad: 'dia' },
  ],
}

const TITULOS = {
  fitness: { q1: '¿Qué tiene tu gimnasio?', q2: '¿Cómo cobras a tus socios?', gente: 'socios' },
  clases: { q1: '¿Qué clases dictas?', q2: '¿Cómo cobras a tus alumnos?', gente: 'alumnos' },
  ninos: { q1: '¿Qué actividades tienen los niños?', q2: '¿Cómo cobras a los papás?', gente: 'alumnos' },
  personal_trainer: { q1: '¿Qué tipos de sesión ofreces?', q2: '¿Cómo cobras tus paquetes?', gente: 'clientes' },
}

const COLORES_MARCA = ['#FF6B35', '#E11D48', '#DC2626', '#7C3AED', '#2563EB', '#0EA5E9', '#059669', '#F59E0B', '#0C0A09']

const chipCls = (on) =>
  `cursor-pointer rounded-full border px-4 py-2 text-[13px] font-extrabold transition-colors ${on ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`

export default function Bienvenida() {
  const navigate = useNavigate()
  const { empresa, reloadBootstrap } = useAuth()

  // Registro pendiente: el negocio NO existe todavía — se crea al final del
  // wizard. Si no hay pendiente, es el flujo viejo sobre la empresa activa.
  const [pendiente] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('fc.registroPendiente')) } catch { return null }
  })
  const [creada, setCreada] = useState(null) // { empresa_id, slug, nombre } al finalizar

  const planSlug = pendiente?.plan || empresa?.plan_slug
  const tipo = TIPO_POR_PLAN[planSlug] || 'fitness'
  const esCadena = planSlug === 'pro' || planSlug === 'cadena'
  const nombreNegocio = pendiente?.nombre || empresa?.nombre
  const t = TITULOS[tipo]

  const [paso, setPaso] = useState(0)
  const [aplicando, setAplicando] = useState(false)
  const [error, setError] = useState('')

  // P1: disciplinas (las fijas empiezan elegidas)
  const [elegidas, setElegidas] = useState(() => DISCIPLINAS[tipo].filter((d) => d.fijo).map((d) => d.nombre))
  const [extra, setExtra] = useState('')
  const [extras, setExtras] = useState([])
  // P2: planes con precio editable
  const [planes, setPlanes] = useState(() => PLANES_SUGERIDOS[tipo].map((p) => ({ ...p, on: !!p.popular, precio: String(p.precio) })))
  const [matricula, setMatricula] = useState('')
  // P3: contacto (horario estructurado por día, no texto libre)
  const [horario, setHorario] = useState(HORARIO_DEFAULT)
  const [whatsapp, setWhatsapp] = useState('')
  const [direccion, setDireccion] = useState('')
  const [ubicacionSel, setUbicacionSel] = useState(null) // coords del autocompletado
  const [sedesExtra, setSedesExtra] = useState(esCadena ? [''] : [])
  // P4: logo + color. El archivo se guarda en memoria y se sube AL FINAL
  // (recién ahí existe la empresa); la vista previa y los colores salen del blob local.
  const [color, setColor] = useState('#FF6B35')
  const [logoFile, setLogoFile] = useState(null)
  const [logoUrl, setLogoUrl] = useState('') // objectURL local para previsualizar
  const [coloresLogo, setColoresLogo] = useState([])
  const logoRef = useRef(null)

  async function onLogo(file) {
    if (!file) return
    const preview = URL.createObjectURL(file)
    setLogoFile(file)
    setLogoUrl(preview)
    const sugeridos = await extraerColoresDeLogo(preview)
    setColoresLogo(sugeridos)
    if (sugeridos[0]) setColor(sugeridos[0]) // el dominante como propuesta
  }

  const total = 4
  const toggleDisciplina = (n, fijo) => {
    if (fijo) return
    setElegidas((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]))
  }

  // Crea la empresa (solo en modo registro pendiente) y devuelve su id.
  async function crearEmpresa() {
    const { data, error } = await supabase.rpc('registrar_empresa', {
      p_nombre: pendiente.nombre, p_slug: pendiente.slug, p_categoria_codigo: pendiente.categoria,
    })
    if (error) throw error
    await supabase.rpc('elegir_plan', { p_empresa_id: data.empresa_id, p_plan: pendiente.plan, p_con_app: pendiente.conApp })
    sessionStorage.removeItem('fc.registroPendiente')
    setCreada({ empresa_id: data.empresa_id, slug: pendiente.slug, nombre: pendiente.nombre })
    return data.empresa_id
  }

  // "Configurar después" en modo registro: igual hay que crear el negocio
  // (con el seed genérico), si no el usuario se queda sin nada.
  async function crearYSalir() {
    setAplicando(true); setError('')
    try {
      await crearEmpresa()
      await reloadBootstrap()
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setError(e.message)
    } finally {
      setAplicando(false)
    }
  }

  async function aplicar() {
    setAplicando(true); setError('')
    try {
      const empresaId = pendiente ? await crearEmpresa() : empresa.id
      if (pendiente) await reloadBootstrap() // activa la empresa recién creada

      // Ubicación para el mapa: la del autocompletado o geocodificar (best effort)
      let ubicacion = ubicacionSel && ubicacionSel.direccion === direccion.trim() ? ubicacionSel : null
      if (!ubicacion && direccion.trim()) {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&q=${encodeURIComponent(direccion + ', Perú')}`)
          const j = await r.json()
          if (j?.[0]) ubicacion = { lat: j[0].lat, lng: j[0].lon, direccion: direccion.trim() }
        } catch { /* sin mapa, no pasa nada */ }
      }

      const catalogo = DISCIPLINAS[tipo]
      const config = {
        disciplinas: [
          ...catalogo.filter((d) => elegidas.includes(d.nombre)).map(({ nombre, color, acceso_libre }) => ({ nombre, color, acceso_libre: !!acceso_libre })),
          ...extras.map((nombre, i) => ({ nombre, color: COLORES_MARCA[i % COLORES_MARCA.length] })),
        ],
        planes: planes.filter((p) => p.on && Number(p.precio) > 0).map((p) => ({
          nombre: p.nombre, precio: Number(p.precio), unidad: p.unidad,
          popular: !!p.popular, congela: p.congela || 0,
          matricula: Number(matricula) || 0, descripcion: p.descripcion || '',
        })),
        horario: resumenHorario(horario), whatsapp: whatsapp.trim(), direccion: direccion.trim(),
        ubicacion,
        sedes: sedesExtra.map((s) => s.trim()).filter(Boolean),
        color,
      }

      const { error } = await supabase.rpc('aplicar_onboarding', { p_empresa_id: empresaId, p_config: config })
      if (error) throw error
      // Horario estructurado (el RPC solo guarda el texto derivado)
      await supabase.from('empresa').update({ horario }).eq('id', empresaId)
      // Logo (si lo eligió): recién ahora se sube, ya con empresa creada
      if (logoFile) {
        try {
          const url = await subirBranding(empresaId, 'logo', logoFile)
          await supabase.from('empresa_tema').update({ logo_url: url }).eq('empresa_id', empresaId)
        } catch { /* el logo se puede subir después en Configuración → Marca */ }
      }
      await reloadBootstrap()
      setPaso(total) // pantalla final
    } catch (e) {
      setError(e.message)
    } finally {
      setAplicando(false)
    }
  }

  // En la pantalla final: sondear el subdominio hasta que el SSL esté emitido,
  // para mostrar "activando…" → "✓ en línea" en vivo.
  const [paginaLista, setPaginaLista] = useState(false)
  const slugFinal = creada?.slug || empresa?.slug
  useEffect(() => {
    if (paso !== total || !slugFinal || paginaLista) return
    const url = urlPublica(slugFinal)
    if (url.includes('?g=')) { setPaginaLista(true); return } // dev: siempre lista
    let activo = true
    let timer
    const probar = async () => {
      try {
        await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(4000) })
        if (activo) setPaginaLista(true)
      } catch {
        if (activo) timer = setTimeout(probar, 5000)
      }
    }
    probar()
    return () => { activo = false; clearTimeout(timer) }
  }, [paso, slugFinal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Abre la página pública a prueba de demo: si el subdominio aún no tiene
  // SSL (tarda ~1 min la primera vez), abre por /?g= que funciona al instante.
  async function abrirPagina() {
    const slug = creada?.slug || empresa?.slug
    const url = urlPublica(slug)
    const respaldo = `${window.location.origin}/?g=${slug}`
    if (url === respaldo) { window.open(url, '_blank'); return }
    try {
      await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(3000) })
      window.open(url, '_blank')
    } catch {
      window.open(respaldo, '_blank')
    }
  }

  if (!empresa && !pendiente) return null

  return (
    <div className="flex min-h-screen items-start justify-center bg-canvas px-4 py-6 sm:py-10">
      {aplicando && <LoadingOverlay texto="Armando tu espacio…" sub="Creando tus clases, planes y página web" />}
      <div className="w-full max-w-[560px]">
        <div className="mb-6 flex items-center gap-3">
          <a href="https://fitcorecenter.com" title="Ir a fitcorecenter.com" className="transition-opacity hover:opacity-75">
            <FitCoreLogo size={44} />
          </a>
          <div>
            <div className="text-[20px] font-extrabold tracking-[-0.3px]">¡Bienvenido, {nombreNegocio}! 🎉</div>
            <div className="text-[12px] font-semibold text-muted">
              {paso < total
                ? `Cuéntanos de tu negocio y te lo dejamos armado · paso ${paso + 1} de ${total}${pendiente ? ' · nada se crea hasta el final' : ''}`
                : 'Tu espacio está listo'}
            </div>
          </div>
        </div>

        {/* Barra de progreso */}
        {paso < total && (
          <div className="mb-5 flex gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= paso ? 'bg-orange' : 'bg-line'}`} />
            ))}
          </div>
        )}

        <div className="rounded-card border border-line bg-white p-5 shadow-[0_10px_40px_rgba(20,27,46,0.06)] sm:p-7">
          {/* ── PASO 1: disciplinas ── */}
          {paso === 0 && (
            <>
              <h2 className="text-[18px] font-extrabold">{t.q1}</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Marca todo lo que ofreces — creamos tus servicios y un horario de ejemplo.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {DISCIPLINAS[tipo].map((d) => (
                  <button key={d.nombre} onClick={() => toggleDisciplina(d.nombre, d.fijo)}
                    className={chipCls(elegidas.includes(d.nombre)) + (d.fijo ? ' opacity-90' : '')}
                    title={d.fijo ? 'Incluida siempre en un gimnasio' : ''}>
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: d.color }} />
                    {d.nombre}{d.fijo ? ' ✓' : ''}
                  </button>
                ))}
                {extras.map((n) => (
                  <button key={n} onClick={() => setExtras((s) => s.filter((x) => x !== n))} className={chipCls(true)}>{n} ✕</button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input value={extra} onChange={(e) => setExtra(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && extra.trim()) { setExtras((s) => [...s, extra.trim()]); setExtra('') } }}
                  placeholder="¿Otra? Escríbela y Enter"
                  className="flex-1 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13px] outline-none focus:border-orange" />
              </div>
            </>
          )}

          {/* ── PASO 2: planes y precios ── */}
          {paso === 1 && (
            <>
              <h2 className="text-[18px] font-extrabold">{t.q2}</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Activa los que ofreces y pon TUS precios — así tus planes nacen reales.</p>
              <div className="mt-4 flex flex-col gap-2">
                {planes.map((p, i) => (
                  <div key={p.nombre} className={`flex items-center gap-3 rounded-[10px] border p-3 ${p.on ? 'border-orange bg-orange-50/50' : 'border-line'}`}>
                    <input type="checkbox" checked={p.on}
                      onChange={(e) => setPlanes((s) => s.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))}
                      className="h-4 w-4 accent-orange-600" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-extrabold">{p.nombre} {p.popular && <span className="ml-1 rounded-full bg-orange px-2 py-0.5 text-[9px] font-extrabold text-white">POPULAR</span>}</div>
                      {p.descripcion && <div className="text-[11px] font-semibold text-muted">{p.descripcion}</div>}
                    </div>
                    <div className="flex items-center gap-1 text-[13px] font-extrabold">
                      S/ <input type="number" min="0" value={p.precio} disabled={!p.on}
                        onChange={(e) => setPlanes((s) => s.map((x, j) => j === i ? { ...x, precio: e.target.value } : x))}
                        className="w-[76px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[13px] font-extrabold outline-none focus:border-orange disabled:opacity-40" />
                    </div>
                  </div>
                ))}
              </div>
              {tipo !== 'personal_trainer' && (
                <label className="mt-3.5 flex items-center gap-2 text-[13px] font-bold">
                  ¿Cobras matrícula (pago único al inscribirse)? S/
                  <input type="number" min="0" value={matricula} onChange={(e) => setMatricula(e.target.value)}
                    placeholder="0" className="w-[80px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[13px] font-extrabold outline-none focus:border-orange" />
                </label>
              )}
            </>
          )}

          {/* ── PASO 3: contacto (+sedes si es cadena) ── */}
          {paso === 2 && (
            <>
              <h2 className="text-[18px] font-extrabold">Datos de tu negocio</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Con esto tu página web sale completa: contacto, horario y mapa.</p>
              <div className="mt-4 flex flex-col gap-3.5">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">WhatsApp del negocio</span>
                  <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="999 888 777"
                    className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-orange" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Dirección (para el mapa de tu página)</span>
                  <DireccionAutocomplete value={direccion} onChange={setDireccion}
                    onPick={(s) => setUbicacionSel({ lat: s.lat, lng: s.lng, direccion: s.direccion })}
                    placeholder="Av. Principal 123, Tacna"
                    className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[13.5px] outline-none focus:border-orange" />
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Horario de atención</span>
                  <HorarioEditor value={horario} onChange={setHorario} />
                </div>
                {esCadena && (
                  <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[12px] font-semibold text-muted">
                    🏢 ¿Tienes más sedes? Se agregan en <b>Configuración → Sedes</b> al activar tu plan
                    (el mes de prueba incluye 1 sede).
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── PASO 4: logo + color de marca ── */}
          {paso === 3 && (
            <>
              <h2 className="text-[18px] font-extrabold">Tu logo y tu color</h2>
              <p className="mt-1 text-[12.5px] font-semibold text-muted">Sube tu logo y te sugerimos los colores que salen de él — o elige el tuyo a mano.</p>

              {/* Logo (opcional) */}
              <div className="mt-4 flex items-center gap-4">
                <button onClick={() => logoRef.current?.click()}
                  className="flex h-[76px] w-[76px] cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-surface text-[24px] transition-colors hover:border-orange">
                  {logoUrl ? <img src={logoUrl} alt="logo" className="h-full w-full object-cover" /> : '📷'}
                </button>
                <div>
                  <div className="text-[13px] font-extrabold">{logoUrl ? 'Logo cargado ✓' : 'Sube tu logo (opcional)'}</div>
                  <div className="text-[11.5px] font-semibold text-muted">
                    {logoUrl ? 'Toca la imagen para cambiarlo.' : 'PNG o JPG. Si no lo tienes a mano, lo subes después en Configuración → Marca.'}
                  </div>
                </div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => { onLogo(e.target.files?.[0]); e.target.value = '' }} />
              </div>

              {/* Sugerencias extraídas del logo */}
              {coloresLogo.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">🎨 Colores de tu logo</div>
                  <div className="mt-2 flex flex-wrap gap-2.5">
                    {coloresLogo.map((c) => (
                      <button key={c} onClick={() => setColor(c)}
                        className={`h-11 w-11 cursor-pointer rounded-full border-4 transition-transform hover:scale-110 ${color === c ? 'border-navy' : 'border-white shadow'}`}
                        style={{ background: c }} title={c} />
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">O elige uno</div>
              <div className="mt-2 flex flex-wrap gap-2.5">
                {COLORES_MARCA.map((c) => (
                  <button key={c} onClick={() => setColor(c)}
                    className={`h-11 w-11 cursor-pointer rounded-full border-4 transition-transform hover:scale-110 ${color === c ? 'border-navy' : 'border-white shadow'}`}
                    style={{ background: c }} title={c} />
                ))}
                <label className="flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-3 text-[12px] font-extrabold text-muted hover:border-orange">
                  Otro <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 cursor-pointer border-none bg-transparent p-0" />
                </label>
              </div>
              <div className="mt-5 rounded-[12px] border border-line p-4">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Así se verá</div>
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[10px]" style={{ background: color }}>
                    {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-[16px] font-extrabold text-white">{nombreNegocio?.[0]}</span>}
                  </div>
                  <span className="text-[15px] font-extrabold">{nombreNegocio}</span>
                  <button className="ml-auto rounded-[10px] border-none px-5 py-2.5 text-[13.5px] font-extrabold text-white" style={{ background: color }}>
                    Inscríbete ahora
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── FINAL ── */}
          {paso === total && (
            <div className="text-center">
              <div className="text-[52px]">🎉</div>
              <h2 className="mt-2 text-[20px] font-extrabold">¡{nombreNegocio} está listo!</h2>
              <p className="mx-auto mt-2 max-w-[380px] text-[13px] font-semibold text-muted">
                Tus {t.gente}, clases, planes y página web ya están armados con tu información. Todo se puede afinar desde el panel.
              </p>
              <div className="mt-6 flex flex-col gap-2.5">
                <button onClick={abrirPagina}
                  className="cursor-pointer rounded-[11px] border border-orange bg-orange-50 py-3 text-[14px] font-extrabold text-orange hover:bg-orange-100">
                  🌐 Ver mi página web
                </button>
                {paginaLista ? (
                  <p className="-mt-1 flex items-center justify-center gap-1.5 text-[11.5px] font-extrabold text-green-600">
                    ✓ {slugFinal}.fitcorecenter.com ya está en línea
                  </p>
                ) : (
                  <p className="-mt-1 flex items-center justify-center gap-2 text-[11px] font-semibold text-faint">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-orange" />
                    Activando <b>{slugFinal}.fitcorecenter.com</b>… estará lista en menos de un minuto
                  </p>
                )}
                <button onClick={() => navigate('/dashboard', { replace: true })}
                  className="cursor-pointer rounded-[11px] border-none bg-orange py-3 text-[14.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] hover:bg-orange-600">
                  Ir a mi panel →
                </button>
              </div>
            </div>
          )}

          {error && <div className="mt-4 rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}

          {/* Navegación */}
          {paso < total && (
            <div className="mt-6 flex items-center justify-between">
              <button onClick={() => (pendiente ? crearYSalir() : navigate('/dashboard', { replace: true }))}
                disabled={aplicando}
                className="cursor-pointer border-none bg-transparent text-[12.5px] font-extrabold text-faint hover:text-muted disabled:opacity-50">
                {pendiente ? 'Saltar — crear con lo básico' : 'Configurar después'}
              </button>
              <div className="flex gap-2">
                {paso > 0 && (
                  <button onClick={() => setPaso(paso - 1)}
                    className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted">← Atrás</button>
                )}
                <button onClick={() => (paso === total - 1 ? aplicar() : setPaso(paso + 1))}
                  disabled={aplicando}
                  className="cursor-pointer rounded-[10px] border-none bg-orange px-6 py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                  {paso === total - 1 ? (pendiente ? '✨ Crear mi negocio' : '✨ Armar mi espacio') : 'Siguiente →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
