import { useEffect, useState } from 'react'
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

// Radio de los botones según el estilo elegido (landing.estilo.botones)
const BTN_RADIUS = { pill: 999, suave: 12, recto: 5 }

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
  const stats = (L.stats && L.stats.length > 0) ? L.stats : statsAuto
  const rBtn = BTN_RADIUS[L.estilo?.botones || 'suave']

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/90 px-6 py-3.5 backdrop-blur">
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

      {/* Hero — con foto de portada opcional + overlay */}
      <section className="relative overflow-hidden" style={{ background: tema.color_navy }}>
        {L.hero_url && (
          <>
            <img src={L.hero_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
            {/* overlay con el "fondo oscuro" configurado por el gym */}
            <div className="absolute inset-0" style={{ background: hexToRgba(tema.color_navy, L.hero_overlay ?? 0.55) }} />
          </>
        )}
        <div className="relative mx-auto max-w-[1000px] px-6 py-28 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-[12px] font-extrabold text-white/80">
            <span className="h-2 w-2 rounded-full" style={{ background: tema.color_primary }} /> {data.nombre}
          </div>
          <h1 className="text-[44px] font-extrabold leading-[1.1] tracking-[-1px] text-white">
            {data.eslogan || 'Tu mejor versión empieza aquí'}
          </h1>
          {data.mensaje_bienvenida && (
            <p className="mx-auto mt-4 max-w-[560px] text-[16px] font-semibold text-white/70">{data.mensaje_bienvenida}</p>
          )}
          <div className="mt-8 flex items-center justify-center gap-3">
            <button onClick={() => abrirLead('Quiero inscribirme')}
              className="cursor-pointer border-none px-6 py-3.5 text-[15px] font-extrabold text-white shadow-lg transition-transform hover:scale-[1.02]"
              style={{ background: tema.color_primary, borderRadius: rBtn }}>
              Inscríbete ahora
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

      {/* Estadísticas */}
      {sec.stats && stats.length > 0 && (
        <section className="border-b border-line bg-white py-10">
          <div className="mx-auto grid max-w-[900px] grid-cols-2 gap-6 px-6 sm:grid-cols-4">
            {stats.map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-[32px] font-extrabold tracking-[-1px]" style={{ color: tema.color_primary }}>{s.valor}</div>
                <div className="mt-1 text-[13px] font-bold text-muted">{s.label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Promociones activas */}
      {sec.promociones && promos.length > 0 && (
        <section className="py-16" style={{ background: `${tema.color_primary}0d` }}>
          <div className="mx-auto max-w-[1000px] px-6">
            <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Ofertas y promociones</h2>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              {promos.map((pr) => (
                <div key={pr.nombre}
                  className="relative flex w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border-2 bg-white p-5 sm:w-[380px]"
                  style={{ borderColor: tema.color_primary }}>
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
      )}

      {/* Planes */}
      {sec.planes && data.planes?.length > 0 && (
        <section id="planes" className="mx-auto max-w-[1000px] px-6 py-20">
          <h2 className="text-center text-[30px] font-extrabold tracking-[-0.5px]">Planes</h2>
          <p className="mt-2 text-center text-[14px] font-semibold text-muted">Elige el plan que se ajusta a tu ritmo</p>
          <div className="mt-10 flex flex-wrap justify-center gap-5">
            {data.planes.map((p) => (
              <div key={p.nombre} className="relative flex w-full max-w-[260px] flex-col rounded-2xl border border-line bg-white p-6 transition-transform hover:-translate-y-1 sm:w-[240px]"
                style={p.badge ? { borderColor: tema.color_primary, boxShadow: `0 10px 30px ${tema.color_primary}22` } : {}}>
                {p.badge && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-extrabold text-white" style={{ background: tema.color_primary }}>{p.badge}</div>}
                <div className="text-[15px] font-extrabold text-muted">{p.nombre}</div>
                <div className="mt-2 text-[32px] font-extrabold tracking-[-1px]">{money(p.precio, data.moneda)}<span className="text-[14px] font-semibold text-muted">/{p.unidad}</span></div>
                <div className="mt-3 flex-1 text-[13px] font-semibold leading-relaxed text-muted">{p.descripcion}</div>
                <button onClick={() => abrirLead(`Plan ${p.nombre}`)}
                  className="mt-6 block w-full cursor-pointer border-none py-2.5 text-center text-[13px] font-extrabold text-white"
                  style={{ background: tema.color_primary, borderRadius: rBtn }}>Elegir</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Clases */}
      {sec.clases && data.clases?.length > 0 && (
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
      )}

      {/* Galería */}
      {sec.galeria && galeria.length > 0 && (
        <section className="mx-auto max-w-[1000px] px-6 py-20">
          <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Galería</h2>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {galeria.map((url, i) => (
              <div key={i} className="aspect-[4/3] overflow-hidden rounded-xl">
                <img src={url} alt="" className="h-full w-full object-cover transition-transform hover:scale-105" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sedes */}
      {sec.sedes && data.sedes?.length > 0 && (
        <section className="bg-surface py-20">
          <div className="mx-auto max-w-[1000px] px-6">
            <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Nuestras sedes</h2>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.sedes.map((s) => (
                <div key={s.nombre} className="overflow-hidden rounded-2xl border border-line bg-white">
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
      )}

      {/* Mapa de ubicación */}
      {sec.mapa && Number(L.ubicacion?.lat) && Number(L.ubicacion?.lng) ? (
        <section className="mx-auto max-w-[1000px] px-6 py-20">
          <h2 className="text-center text-[26px] font-extrabold tracking-[-0.5px]">Encuéntranos</h2>
          {data.direccion && <p className="mt-2 text-center text-[14px] font-semibold text-muted">{data.direccion}</p>}
          <div className="mt-8 overflow-hidden rounded-2xl border border-line shadow-sm">
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
      ) : null}

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
            <div className="flex flex-wrap justify-center gap-3">
              {Object.entries(redes).filter(([, v]) => v).map(([k, v]) => (
                <a key={k} href={v.startsWith('http') ? v : `https://${v}`} target="_blank" rel="noreferrer"
                  className="text-[12.5px] font-extrabold text-white/70 hover:text-white">{RED_LABEL[k] || k}</a>
              ))}
            </div>
          )}
          <div className="text-[11px] font-semibold text-white/40">
            Powered by FitCore · {ROOT_DOMAIN}
          </div>
        </div>
      </footer>

      {/* Formulario de inscripción / contacto → crea un lead en el CRM del gym */}
      {lead && (
        <LeadModal
          slug={data.slug}
          gym={marca}
          interes={lead.interes}
          color={tema.color_primary}
          radius={rBtn}
          onClose={() => setLead(null)}
        />
      )}
    </div>
  )
}

function LeadModal({ slug, gym, interes, color, radius, onClose }) {
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
