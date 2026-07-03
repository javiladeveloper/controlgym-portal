import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { applyEmpresaTema } from '../theme/tokens.js'
import { LogoMark } from '../components/icons.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'

function money(n, moneda = 'PEN') {
  const s = moneda === 'PEN' ? 'S/' : moneda === 'USD' ? '$' : ''
  return `${s} ${Number(n || 0).toLocaleString('es-PE')}`.trim()
}

const RED_LABEL = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', whatsapp: 'WhatsApp', youtube: 'YouTube', web: 'Web' }

// hex -> rgba para el overlay de la portada (usa el "fondo oscuro" del gym)
function hexToRgba(hex, a) {
  const h = (hex || '').replace('#', '')
  if (h.length < 6) return `rgba(20,27,46,${a})`
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

// Fuentes "de póster": solo se aplican a títulos/números (ilegibles en párrafos).
const FUENTES_DISPLAY = ['Anton', 'Bebas Neue', 'Teko', 'Oswald']
// Ejes de peso válidos por fuente en Google Fonts (pedir un peso inexistente da error 400).
const FONT_AXIS = {
  Anton: '', 'Bebas Neue': '', Teko: ':wght@400;600;700', Oswald: ':wght@400;600;700',
  'Roboto Condensed': ':wght@400;700',
}
const fontHref = (fams) =>
  'https://fonts.googleapis.com/css2?' +
  fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}${FONT_AXIS[f] ?? ':wght@400;600;700;800'}`).join('&') +
  '&display=swap'

// Radio de los botones según el estilo elegido (landing.estilo.botones)
const BTN_RADIUS = { pill: 999, suave: 12, recto: 5 }
// Radio de tarjetas (landing.estilo.tarjetas)
const CARD_RADIUS = { redonda: 22, suave: 14, recta: 6 }
// Orden por defecto de las secciones de la página
const DEFAULT_ORDEN = ['stats', 'promociones', 'planes', 'clases', 'testimonios', 'galeria', 'sedes', 'mapa']

// Iconos de redes sociales para el footer
const ICONO_RED = {
  facebook: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3V11H9v3h2.3v7h2.2z" /></svg>,
  instagram: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" /></svg>,
  tiktok: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 3c.4 2 1.7 3.4 3.9 3.6v3c-1.5 0-2.8-.4-3.9-1.2v5.8c0 3.3-2.3 5.8-5.6 5.8-3.1 0-5.5-2.3-5.5-5.4 0-3 2.3-5.4 5.4-5.4.3 0 .7 0 1 .1v3.1c-.3-.1-.6-.2-1-.2-1.4 0-2.4 1-2.4 2.4s1 2.4 2.4 2.4c1.5 0 2.6-1 2.6-2.7V3h3.1z" /></svg>,
  whatsapp: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.1c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.7.8 1.8.1.1.1.3 0 .4-.1.2-.1.3-.3.5l-.4.5c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1.1.9 2 1.2 2.3 1.4.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.3.1 1.7.8 2 1 .3.1.5.2.5.3.1.1.1.7-.1 1.4z" /></svg>,
  youtube: <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8 1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4c-.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3L10 15z" /></svg>,
  web: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
}

// Tema efectivo de la página: colores de la marca + override propio de la
// landing (empresa.landing.colores), si el gym personalizó su página.
function temaEfectivo(data) {
  const t = { ...(data?.tema || {}) }
  const ov = data?.landing?.colores || {}
  if (ov.primary) {
    t.color_primary = ov.primary
    t.color_primary_hover = ov.primary
  }
  if (ov.oscuro) {
    t.color_navy = ov.oscuro
    t.color_navy_soft = ov.oscuro
  }
  return t
}

export default function Landing({ slug }) {
  const [data, setData] = useState(undefined) // undefined=cargando, null=no existe
  const [lead, setLead] = useState(null) // { interes } cuando el formulario está abierto
  // Origen de la visita (utm_source): si el gym compartió el link desde una red,
  // el lead quedará atribuido a esa red en su CRM.
  const [origen] = useState(() => {
    const p = new URLSearchParams(window.location.search)
    return (p.get('utm_source') || p.get('src') || '').slice(0, 40)
  })

  useEffect(() => {
    let active = true
    supabase.rpc('get_landing_by_slug', { p_slug: slug }).then(({ data }) => {
      if (!active) return
      setData(data)
      if (data?.tema) {
        applyEmpresaTema(temaEfectivo(data)) // marca + override de colores de la página
        if (data.tema.font_family) document.documentElement.style.setProperty('--font-brand', data.tema.font_family)
      }
    })
    return () => { active = false }
  }, [slug])

  // Carga dinámica de fuentes (Google Fonts) con EMPAREJADO inteligente:
  // si la fuente elegida es "de póster" (Anton, Bebas…), se usa solo en
  // títulos/números y el cuerpo mantiene una letra legible.
  useEffect(() => {
    if (!data) return
    const elegida = data?.landing?.estilo?.fuente || data?.tema?.font_family || 'Manrope'
    const marca = data?.tema?.font_family
    const titulo = elegida
    const cuerpo = FUENTES_DISPLAY.includes(elegida)
      ? (marca && !FUENTES_DISPLAY.includes(marca) ? marca : 'Manrope')
      : elegida

    const id = 'lp-font-link'
    const href = fontHref([...new Set([titulo, cuerpo])])
    let link = document.getElementById(id)
    if (!link) {
      link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.href !== href) link.href = href
    const root = document.documentElement
    root.style.setProperty('--font-title', `'${titulo}'`)
    root.style.setProperty('--font-body', `'${cuerpo}'`)
    root.style.setProperty('--font-brand', `'${cuerpo}'`)
  }, [data])

  // Identidad en la pestaña del navegador: título y favicon del gym.
  useEffect(() => {
    if (!data) return
    const marca = data.tema?.nombre_marca || data.nombre
    document.title = `${marca}${data.eslogan ? ' — ' + data.eslogan : ''}`
    const fav = data.tema?.favicon_url || data.tema?.logo_url
    if (fav) {
      let l = document.querySelector("link[rel='icon']")
      if (!l) {
        l = document.createElement('link')
        l.rel = 'icon'
        document.head.appendChild(l)
      }
      l.href = fav
    }
  }, [data])

  if (data === undefined) {
    return <div className="flex min-h-screen items-center justify-center bg-canvas text-[13px] font-bold text-muted">Cargando…</div>
  }
  if (data === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-canvas px-4 text-center">
        <div className="text-[20px] font-extrabold">Gimnasio no encontrado</div>
        <div className="text-[13px] font-semibold text-muted">No existe un gimnasio en “{slug}.{ROOT_DOMAIN}”.</div>
      </div>
    )
  }

  const tema = temaEfectivo(data)
  const marca = tema.nombre_marca || data.nombre
  // /portal fuerza navegación real (cambio de path) hacia el panel de gestión
  const portalUrl = `/portal?g=${data.slug}`
  const redes = data.redes || {}
  const abrirLead = (interes) => setLead({ interes })
  const L = data.landing || {}
  // Merge con defaults: claves nuevas (ej. promociones) quedan visibles aunque
  // la config guardada no las tenga aún.
  const sec = { planes: true, clases: true, sedes: true, galeria: true, stats: true, mapa: true, promociones: true, ...(L.secciones || {}) }
  const galeria = L.galeria || []
  const promos = data.promociones || []

  // Stats: manuales del gym o, si no definió, las REALES calculadas de la BD.
  const sr = data.stats_reales || {}
  const statsAuto = [
    sr.socios_activos > 0 && { valor: `${sr.socios_activos}`, label: sr.socios_activos === 1 ? 'Miembro activo' : 'Miembros activos' },
    sr.sedes > 1 && { valor: `${sr.sedes}`, label: 'Sedes' },
    sr.clases_semana > 0 && { valor: `${sr.clases_semana}`, label: 'Clases por semana' },
    sr.entrenadores > 0 && { valor: `${sr.entrenadores}`, label: sr.entrenadores === 1 ? 'Entrenador' : 'Entrenadores' },
  ].filter(Boolean)
  // Modo explícito: 'auto' = datos reales calculados; 'manual' = los del gym.
  const statsModo = L.stats_modo || ((L.stats && L.stats.length > 0) ? 'manual' : 'auto')
  const stats = statsModo === 'manual' ? (L.stats || []) : statsAuto
  const rBtn = BTN_RADIUS[L.estilo?.botones || 'suave']
  const D = L.estilo?.diseno || 'clasico' // clasico | split | dark | minimal | bold
  const dark = D === 'dark'
  const rCard = CARD_RADIUS[L.estilo?.tarjetas || 'suave']
  const mayus = !!L.estilo?.titulo_mayus
  const ctaTxt = (L.cta_texto || '').trim() || (D === 'bold' ? '¡Empieza hoy!' : 'Inscríbete ahora')
  const alturaHero = L.estilo?.hero_altura || 'normal'
  const heroPadY = { compacto: 'py-16', normal: 'py-28', completo: 'flex min-h-[82vh] flex-col justify-center py-24' }[alturaHero] || 'py-28'
  // Orden guardado + secciones nuevas que aún no estén en él (al final)
  const orden = Array.isArray(L.orden) && L.orden.length
    ? [...L.orden, ...DEFAULT_ORDEN.filter((k) => !L.orden.includes(k))]
    : DEFAULT_ORDEN

  // Renderers de cada sección — la página los pinta en el orden configurado.
  const SECCIONES_RENDER = {
    stats: () => sec.stats && stats.length > 0 && (
      <section className="border-b border-line bg-white py-10">
        <div className="mx-auto grid max-w-[900px] grid-cols-2 gap-6 px-6 sm:grid-cols-4">
          {stats.map((s, i) => (
            <div key={i} className="text-center">
              <div className="lp-display text-[32px] font-extrabold tracking-[-1px]" style={{ color: tema.color_primary }}>{s.valor}</div>
              <div className="mt-1 text-[13px] font-bold text-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>
    ),
    promociones: () => sec.promociones && promos.length > 0 && (
      <section className="py-16" style={{ background: `${tema.color_primary}0d` }}>
        <div className="mx-auto max-w-[1000px] px-6">
          <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Ofertas y promociones</h2>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {promos.map((pr) => (
              <div key={pr.nombre}
                className="relative flex w-full max-w-[420px] flex-col overflow-hidden border-2 bg-white p-5 sm:w-[380px]"
                style={{ borderColor: tema.color_primary, borderRadius: rCard }}>
                <div className="absolute right-0 top-0 rounded-bl-xl px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white"
                  style={{ background: tema.color_primary }}>
                  Oferta
                </div>
                <div className="pr-14 text-[17px] font-extrabold">{pr.nombre}</div>
                {pr.descripcion && <div className="mt-1.5 flex-1 text-[13px] font-semibold leading-relaxed text-muted">{pr.descripcion}</div>}
                <div className="mt-auto flex items-center justify-between pt-3">
                  {pr.fecha_fin
                    ? <span className="text-[11.5px] font-extrabold text-faint">Hasta el {new Date(pr.fecha_fin + 'T12:00:00').toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })}</span>
                    : <span />}
                  <button onClick={() => abrirLead(`Promoción: ${pr.nombre}`)}
                    className="cursor-pointer border-none bg-transparent text-[13px] font-extrabold"
                    style={{ color: tema.color_primary }}>Aprovechar →</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    ),
    planes: () => sec.planes && data.planes?.length > 0 && (
      <section id="planes" className="mx-auto max-w-[1000px] px-6 py-20">
        <h2 className="text-center text-[30px] font-extrabold tracking-[-0.5px]">Planes</h2>
        <p className="mt-2 text-center text-[14px] font-semibold text-muted">Elige el plan que se ajusta a tu ritmo</p>
        <div className="mt-10 flex flex-wrap justify-center gap-5">
          {data.planes.map((p) => (
            <div key={p.nombre} className="relative flex w-full max-w-[260px] flex-col border border-line bg-white p-6 transition-transform hover:-translate-y-1 sm:w-[240px]"
              style={p.badge ? { borderColor: tema.color_primary, boxShadow: `0 10px 30px ${tema.color_primary}22`, borderRadius: rCard } : { borderRadius: rCard }}>
              {p.badge && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-extrabold text-white" style={{ background: tema.color_primary }}>{p.badge}</div>}
              <div className="text-[15px] font-extrabold text-muted">{p.nombre}</div>
              <div className="lp-display mt-2 text-[32px] font-extrabold tracking-[-1px]">{money(p.precio, data.moneda)}<span className="text-[14px] font-semibold text-muted" style={{ fontFamily: 'var(--font-body)' }}>/{p.unidad}</span></div>
              <div className="mt-3 flex-1 text-[13px] font-semibold leading-relaxed text-muted">{p.descripcion}</div>
              <button onClick={() => abrirLead(`Plan ${p.nombre}`)}
                className="mt-6 block w-full cursor-pointer border-none py-2.5 text-center text-[13px] font-extrabold text-white"
                style={{ background: tema.color_primary, borderRadius: rBtn }}>Elegir</button>
            </div>
          ))}
        </div>
      </section>
    ),
    testimonios: () => sec.testimonios !== false && (L.testimonios || []).length > 0 && (
      <section className="mx-auto max-w-[1000px] px-6 py-20">
        <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Lo que dicen nuestros socios</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          {L.testimonios.map((t, i) => (
            <div key={i} className="flex w-full max-w-[320px] flex-col border border-line bg-white p-5 sm:w-[300px]" style={{ borderRadius: rCard }}>
              <div className="text-[15px] tracking-[2px]" style={{ color: '#F59E0B' }}>
                {'★'.repeat(Math.min(5, t.estrellas || 5))}{'☆'.repeat(Math.max(0, 5 - (t.estrellas || 5)))}
              </div>
              <p className="mt-2.5 flex-1 text-[13.5px] font-semibold leading-relaxed text-muted">“{t.texto}”</p>
              <div className="mt-3 text-[13px] font-extrabold" style={{ color: tema.color_primary }}>{t.nombre}</div>
            </div>
          ))}
        </div>
      </section>
    ),
    clases: () => sec.clases && data.clases?.length > 0 && (
      <section className="bg-surface py-16">
        <div className="mx-auto max-w-[1000px] px-6 text-center">
          <h2 className="text-[26px] font-extrabold tracking-[-0.5px]">Clases y servicios</h2>
          <div className="mt-6 flex flex-wrap justify-center gap-2.5">
            {data.clases.map((c) => (
              <span key={c} className="rounded-full border border-line bg-white px-4 py-2 text-[13px] font-extrabold">{c}</span>
            ))}
          </div>
        </div>
      </section>
    ),
    galeria: () => sec.galeria && galeria.length > 0 && (
      <section className="mx-auto max-w-[1000px] px-6 py-20">
        <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Galería</h2>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {galeria.map((url, i) => (
            <div key={i} className="aspect-[4/3] overflow-hidden" style={{ borderRadius: rCard }}>
              <img src={url} alt="" className="h-full w-full object-cover transition-transform hover:scale-105" />
            </div>
          ))}
        </div>
      </section>
    ),
    sedes: () => sec.sedes && data.sedes?.length > 0 && (
      <section className="bg-surface py-20">
        <div className="mx-auto max-w-[1000px] px-6">
          <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Nuestras sedes</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.sedes.map((s) => (
              <div key={s.nombre} className="overflow-hidden border border-line bg-white" style={{ borderRadius: rCard }}>
                {s.foto_url && <div className="aspect-[16/10] overflow-hidden"><img src={s.foto_url} alt="" className="h-full w-full object-cover" /></div>}
                <div className="p-5">
                  <div className="text-[16px] font-extrabold">{s.nombre}</div>
                  {s.direccion && <div className="mt-1 text-[13px] font-semibold text-muted">{s.direccion}</div>}
                  {s.telefono && <div className="mt-2 text-[13px] font-bold" style={{ color: tema.color_primary }}>{s.telefono}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    ),
    mapa: () => (sec.mapa && Number(L.ubicacion?.lat) && Number(L.ubicacion?.lng)) ? (
      <section className="mx-auto max-w-[1000px] px-6 py-20">
        <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Encuéntranos</h2>
        {data.direccion && <p className="mt-2 text-center text-[14px] font-semibold text-muted">{data.direccion}</p>}
        <div className="mt-8 overflow-hidden border border-line shadow-sm" style={{ borderRadius: rCard }}>
          <iframe
            title="Ubicación"
            className="h-[340px] w-full"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(L.ubicacion.lng) - 0.006}%2C${Number(L.ubicacion.lat) - 0.004}%2C${Number(L.ubicacion.lng) + 0.006}%2C${Number(L.ubicacion.lat) + 0.004}&layer=mapnik&marker=${L.ubicacion.lat}%2C${L.ubicacion.lng}`}
          />
        </div>
        <div className="mt-3 text-center">
          <a href={`https://www.google.com/maps?q=${L.ubicacion.lat},${L.ubicacion.lng}`} target="_blank" rel="noreferrer"
            className="text-[13px] font-extrabold" style={{ color: tema.color_primary }}>
            Abrir en Google Maps →
          </a>
        </div>
      </section>
    ) : null,
  }

  return (
    <div className="lp-root min-h-screen bg-white">
      {/* Emparejado tipográfico: títulos con la fuente elegida, cuerpo legible */}
      <style>{`
        .lp-root { font-family: var(--font-body, 'Manrope'), system-ui, sans-serif; }
        .lp-root h1, .lp-root h2, .lp-root .lp-display { font-family: var(--font-title, var(--font-body, 'Manrope')), system-ui, sans-serif; }
      `}</style>

      {/* Diseño Nocturno: la página completa se vuelve oscura vía overrides */}
      {dark && (
        <style>{`
          .lp-root { background:#0B0E14 !important; color:#EDF0F7; }
          .lp-root .text-muted { color:#98A2B3 !important; }
          .lp-root .text-faint { color:#7A8496 !important; }
          .lp-root .text-ink, .lp-root h1, .lp-root h2 { color:#F2F4F8 !important; }
          .lp-root .bg-white { background:#10151F !important; }
          .lp-root .bg-surface { background:#0E1219 !important; }
          .lp-root .border-line { border-color:rgba(255,255,255,0.09) !important; }
        `}</style>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/90 px-6 py-3.5 backdrop-blur"
        style={dark ? { background: 'rgba(11,14,20,0.92)', borderColor: 'rgba(255,255,255,0.08)' } : undefined}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px] bg-orange">
            {tema.logo_url ? <img src={tema.logo_url} alt="" className="h-full w-full object-cover" /> : <LogoMark size={19} />}
          </div>
          <span className="text-[17px] font-extrabold tracking-[-0.3px]">{marca}</span>
        </div>
        <a href={portalUrl} className="rounded-[10px] bg-orange px-4 py-2 text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">
          Entrar
        </a>
      </header>

      {/* Hero — variante según el diseño elegido (landing.estilo.diseno) */}
      {D === 'split' ? (
        /* ── PANORAMA: texto a la izquierda, foto a la derecha ── */
        <section className="relative overflow-hidden" style={{ background: tema.color_navy }}>
          <div className={`mx-auto grid max-w-[1060px] items-center gap-10 px-6 md:grid-cols-2 ${alturaHero === 'compacto' ? 'py-12' : alturaHero === 'completo' ? 'py-24 md:min-h-[80vh]' : 'py-16 md:py-24'}`}>
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-extrabold text-white/80">
                <span className="h-2 w-2 rounded-full" style={{ background: tema.color_primary }} /> {data.nombre}
              </div>
              <h1 className="text-[40px] font-extrabold leading-[1.08] tracking-[-1px] text-white" style={{ color: '#fff', textTransform: mayus ? 'uppercase' : undefined }}>
                {data.eslogan || 'Tu mejor versión empieza aquí'}
              </h1>
              {data.mensaje_bienvenida && (
                <p className="mt-4 max-w-[460px] text-[15.5px] font-semibold text-white/70">{data.mensaje_bienvenida}</p>
              )}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button onClick={() => abrirLead('Quiero inscribirme')}
                  className="cursor-pointer border-none px-6 py-3.5 text-[15px] font-extrabold text-white shadow-lg transition-transform hover:scale-[1.02]"
                  style={{ background: tema.color_primary, borderRadius: rBtn }}>
                  {ctaTxt}
                </button>
                {sec.planes && data.planes?.length > 0 && (
                  <a href="#planes" className="border border-white/25 px-6 py-3.5 text-[15px] font-extrabold text-white transition-colors hover:bg-white/10"
                    style={{ borderRadius: rBtn }}>Ver planes</a>
                )}
              </div>
            </div>
            <div>
              {L.hero_url
                ? <img src={L.hero_url} alt="" className="h-[300px] w-full rounded-3xl object-cover shadow-2xl md:h-[360px]" />
                : <div className="h-[300px] w-full rounded-3xl md:h-[360px]" style={{ background: `linear-gradient(135deg, ${tema.color_primary}, transparent)` }} />}
            </div>
          </div>
        </section>
      ) : D === 'minimal' ? (
        /* ── MINIMAL: tipográfico, limpio, foto abajo ── */
        <section>
          <div className="mx-auto max-w-[860px] px-6 pb-12 pt-24 text-center">
            <div className="mb-5 inline-flex items-center gap-2 text-[12.5px] font-extrabold uppercase tracking-[2.5px] text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: tema.color_primary }} /> {data.nombre}
            </div>
            <h1 className="text-[50px] font-extrabold leading-[1.05] tracking-[-2px] text-ink" style={{ textTransform: mayus ? 'uppercase' : undefined }}>
              {data.eslogan || 'Tu mejor versión empieza aquí'}
            </h1>
            <div className="mx-auto mt-6 h-1.5 w-24 rounded-full" style={{ background: tema.color_primary }} />
            {data.mensaje_bienvenida && (
              <p className="mx-auto mt-5 max-w-[540px] text-[16px] font-semibold text-muted">{data.mensaje_bienvenida}</p>
            )}
            <div className="mt-8 flex items-center justify-center gap-3">
              <button onClick={() => abrirLead('Quiero inscribirme')}
                className="cursor-pointer border-none px-6 py-3.5 text-[15px] font-extrabold text-white transition-transform hover:scale-[1.02]"
                style={{ background: tema.color_primary, borderRadius: rBtn }}>
                {ctaTxt}
              </button>
              {sec.planes && data.planes?.length > 0 && (
                <a href="#planes" className="border-2 px-6 py-3 text-[15px] font-extrabold transition-opacity hover:opacity-75"
                  style={{ borderRadius: rBtn, borderColor: tema.color_primary, color: tema.color_primary }}>Ver planes</a>
              )}
            </div>
          </div>
          {L.hero_url && (
            <div className="mx-auto max-w-[1060px] px-6 pb-8">
              <img src={L.hero_url} alt="" className="h-[280px] w-full rounded-3xl object-cover md:h-[340px]" />
            </div>
          )}
        </section>
      ) : D === 'bold' ? (
        /* ── IMPACTO: degradado fuerte, tipografía gigante ── */
        <section className="relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${tema.color_navy} 10%, ${tema.color_primary} 170%)` }}>
          {L.hero_url && <img src={L.hero_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}
          <div className={`relative mx-auto max-w-[1000px] px-6 text-center ${heroPadY}`}>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full px-5 py-2 text-[12px] font-extrabold uppercase tracking-[2px] text-white"
              style={{ background: hexToRgba(tema.color_primary, 0.35) }}>
              {data.nombre}
            </div>
            <h1 className="text-[54px] font-extrabold uppercase leading-[1] tracking-[-1.5px] text-white" style={{ color: '#fff', textTransform: mayus ? 'uppercase' : undefined }}>
              {data.eslogan || 'Tu mejor versión empieza aquí'}
            </h1>
            <div className="mx-auto mt-6 h-2 w-40 -skew-x-12" style={{ background: tema.color_primary }} />
            {data.mensaje_bienvenida && (
              <p className="mx-auto mt-5 max-w-[560px] text-[16.5px] font-bold text-white/80">{data.mensaje_bienvenida}</p>
            )}
            <div className="mt-9 flex items-center justify-center gap-3">
              <button onClick={() => abrirLead('Quiero inscribirme')}
                className="cursor-pointer border-none px-8 py-4 text-[16px] font-extrabold uppercase tracking-wide text-white shadow-2xl transition-transform hover:scale-[1.04]"
                style={{ background: tema.color_primary, borderRadius: rBtn }}>
                {ctaTxt}
              </button>
              {sec.planes && data.planes?.length > 0 && (
                <a href="#planes" className="border-2 border-white/50 px-7 py-3.5 text-[15px] font-extrabold uppercase text-white transition-colors hover:bg-white/10"
                  style={{ borderRadius: rBtn }}>Planes</a>
              )}
            </div>
          </div>
        </section>
      ) : (
        /* ── CLÁSICO (también base del Nocturno): foto de fondo completa ── */
        <section className="relative overflow-hidden" style={{ background: tema.color_navy }}>
          {L.hero_url && (
            <>
              <img src={L.hero_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              {/* overlay con el "fondo oscuro" configurado por el gym */}
              <div className="absolute inset-0" style={{ background: hexToRgba(tema.color_navy, L.hero_overlay ?? 0.55) }} />
            </>
          )}
          <div className={`relative mx-auto max-w-[1000px] px-6 text-center ${heroPadY}`}>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-extrabold text-white/80">
              <span className="h-2 w-2 rounded-full" style={{ background: tema.color_primary }} /> {data.nombre}
            </div>
            <h1 className="text-[44px] font-extrabold leading-[1.1] tracking-[-1px] text-white" style={{ color: '#fff', textTransform: mayus ? 'uppercase' : undefined }}>
              {data.eslogan || 'Tu mejor versión empieza aquí'}
            </h1>
            {data.mensaje_bienvenida && (
              <p className="mx-auto mt-4 max-w-[560px] text-[16px] font-semibold text-white/70">{data.mensaje_bienvenida}</p>
            )}
            <div className="mt-8 flex items-center justify-center gap-3">
              <button onClick={() => abrirLead('Quiero inscribirme')}
                className="cursor-pointer border-none px-6 py-3.5 text-[15px] font-extrabold text-white shadow-lg transition-transform hover:scale-[1.02]"
                style={{ background: tema.color_primary, borderRadius: rBtn }}>
                {ctaTxt}
              </button>
              {sec.planes && data.planes?.length > 0 && (
                <a href="#planes" className="border border-white/25 px-6 py-3.5 text-[15px] font-extrabold text-white transition-colors hover:bg-white/10"
                  style={{ borderRadius: rBtn }}>
                  Ver planes
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Secciones de la página, en el orden configurado por el gym */}
      {orden.map((key) => {
        const R = SECCIONES_RENDER[key]
        return R ? <Fragment key={key}>{R()}</Fragment> : null
      })}

      {/* Footer */}
      <footer className="border-t border-line px-6 py-10" style={{ background: tema.color_navy }}>
        <div className="mx-auto flex max-w-[1000px] flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-orange">
              {tema.logo_url ? <img src={tema.logo_url} alt="" className="h-full w-full object-cover" /> : <LogoMark size={16} />}
            </div>
            <span className="text-[15px] font-extrabold text-white">{marca}</span>
          </div>
          {(data.telefono || data.email || data.direccion) && (
            <div className="text-[12.5px] font-semibold text-white/60">
              {[data.direccion, data.telefono, data.email].filter(Boolean).join(' · ')}
            </div>
          )}
          {Object.keys(redes).some((k) => redes[k]) && (
            <div className="flex flex-wrap justify-center gap-2.5">
              {Object.entries(redes).filter(([, v]) => v).map(([k, v]) => (
                <a key={k}
                  href={k === 'whatsapp' ? `https://wa.me/${String(v).replace(/\D/g, '')}` : v.startsWith('http') ? v : `https://${v}`}
                  target="_blank" rel="noreferrer" title={RED_LABEL[k] || k}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/25 hover:text-white">
                  {ICONO_RED[k] || <span className="text-[10px] font-extrabold">{(RED_LABEL[k] || k).slice(0, 2)}</span>}
                </a>
              ))}
            </div>
          )}
          <div className="text-[11px] font-semibold text-white/40">
            Powered by FitCore · {ROOT_DOMAIN}
          </div>
        </div>
      </footer>

      {/* Botón flotante de WhatsApp (usa el número de Redes sociales) */}
      {L.whatsapp_flotante && redes.whatsapp && (
        <a href={`https://wa.me/${String(redes.whatsapp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-transform hover:scale-110"
          style={{ background: '#25D366' }} title="Escríbenos por WhatsApp">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff" aria-hidden>
            <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.4 14.1c-.2.7-1.3 1.3-1.9 1.4-.5.1-1.1.1-1.8-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3s.7-2.1 1-2.4c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4.2.5.7 1.7.8 1.8.1.1.1.3 0 .4-.1.2-.1.3-.3.5l-.4.5c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1.1.9 2 1.2 2.3 1.4.3.1.5.1.6-.1.2-.2.7-.8.9-1.1.2-.3.4-.2.6-.1.3.1 1.7.8 2 1 .3.1.5.2.5.3.1.1.1.7-.1 1.4z" />
          </svg>
        </a>
      )}

      {/* Formulario de inscripción / contacto → crea un lead en el CRM del gym */}
      {lead && (
        <LeadModal
          slug={data.slug}
          gym={marca}
          interes={lead.interes}
          fuente={origen}
          color={tema.color_primary}
          radius={rBtn}
          onClose={() => setLead(null)}
        />
      )}
    </div>
  )
}

function LeadModal({ slug, gym, interes, fuente, color, radius, onClose }) {
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState('')

  async function enviar(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const nota = [interes, mensaje.trim()].filter(Boolean).join(' · ')
    const { error } = await supabase.rpc('crear_lead_publico', {
      p_slug: slug, p_nombre: nombre, p_telefono: telefono, p_email: email, p_nota: nota,
      p_fuente: fuente || null,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setOk(true)
  }

  const inputCls = 'rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-current'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {ok ? (
          <div className="py-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: `${color}1a` }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
            </div>
            <div className="mt-4 text-[18px] font-extrabold">¡Listo! Recibimos tus datos</div>
            <p className="mt-1.5 text-[13px] font-semibold text-muted">{gym} se pondrá en contacto contigo muy pronto.</p>
            <button onClick={onClose} className="mt-5 cursor-pointer border-none px-6 py-2.5 text-[13.5px] font-extrabold text-white"
              style={{ background: color, borderRadius: radius }}>Cerrar</button>
          </div>
        ) : (
          <>
            <div className="text-[18px] font-extrabold">Inscríbete en {gym}</div>
            <p className="mt-1 text-[12.5px] font-semibold text-muted">{interes} · déjanos tus datos y te contactamos</p>
            <form onSubmit={enviar} className="mt-4 flex flex-col gap-3" style={{ color }}>
              <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre *" className={inputCls} />
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono / WhatsApp" className={inputCls} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Correo (opcional)" className={inputCls} />
              <textarea rows={2} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="¿Algo que quieras contarnos?" className={`${inputCls} resize-none`} />
              {error && <div className="rounded-[10px] bg-red-50 px-3 py-2 text-[12.5px] font-bold text-red">{error}</div>}
              <button type="submit" disabled={busy || !nombre.trim() || (!telefono.trim() && !email.trim())}
                className="mt-1 cursor-pointer border-none py-3 text-[14.5px] font-extrabold text-white disabled:opacity-50"
                style={{ background: color, borderRadius: radius }}>
                {busy ? 'Enviando…' : 'Enviar'}
              </button>
              <p className="text-center text-[11px] font-semibold text-faint">Deja al menos un teléfono o correo para contactarte.</p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
