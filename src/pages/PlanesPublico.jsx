import { useEffect, useMemo, useState } from 'react'
import { FitCoreLogo } from '../components/icons.jsx'

// Página PÚBLICA de planes con checkout de Culqi (fitcorecenter.com/planes).
// Requisito de Culqi para aprobar el comercio: >=5 servicios con imagen +
// descripción + precio, y un botón de pago que el revisor pruebe SIN cuenta.
// Hace un cargo único del primer mes vía /api/culqi/pago-publico.

const C = {
  navy: '#0E1526', surface: '#1C2438', orange: '#FF6B35',
  ink: '#F4F6FB', muted: '#8B96AC', faint: '#5A6478',
  line: 'rgba(255,255,255,.09)', orangeSoft: 'rgba(255,107,53,.12)',
}

const CULQI_PK = (import.meta.env.VITE_CULQI_PUBLIC_KEY || '').trim()

// Los 6 planes/servicios de FitCore. imagen = captura real del producto.
// base = solo panel · app = panel + app del socio (adicional).
const PLANES = [
  { slug: 'trainer', nombre: 'Trainer', base: 29, app: 49, img: '/landing/capturas/clientes.jpg',
    para: 'Personal trainers',
    desc: 'Tus clientes, tus paquetes de sesiones, tus cobros y tu página personal (tunombre.fitcorecenter.com) para captar desde tus redes.',
    incluye: ['Clientes y paquetes de sesiones', 'Cobros y recordatorios', 'Tu página web personal'] },
  { slug: 'academia', nombre: 'Academia', base: 49, app: 69, img: '/landing/capturas/membresias.jpg',
    para: 'Yoga, pilates, baile y box',
    desc: 'Clases, alumnos, reservas, cobros y tu página web — sin módulos de gimnasio que no usas. Un panel a la medida de tu estudio.',
    incluye: ['Clases y reservas con cupo', 'Alumnos y membresías', 'Página web con tu marca'] },
  { slug: 'estudio', nombre: 'Estudio', base: 49, app: 79, img: '/landing/capturas/web.jpg',
    para: 'Gimnasios pequeños · 1 sede',
    desc: 'Hasta 100 socios activos, 1 sede y 2 usuarios del panel. Socios, membresías, cobros, clases, check-in y tu página web.',
    incluye: ['Hasta 100 socios · 1 sede', 'Membresías, cobros y check-in', 'Página web + reportes básicos'] },
  { slug: 'ninos', nombre: 'Niños', base: 69, app: 109, img: '/landing/capturas/personal.jpg',
    para: 'Academias infantiles',
    desc: 'Alumnos con apoderados, clases por edades, control de recojo autorizado y tu página web. Pensado para escuelas deportivas de niños.',
    incluye: ['Alumnos con apoderados', 'Clases por edades', 'Recojo autorizado + página web'] },
  { slug: 'crecimiento', nombre: 'Crecimiento', base: 99, app: 139, img: '/landing/capturas/finanzas.jpg', popular: true,
    para: 'El gym que quiere crecer',
    desc: 'Socios ilimitados, hasta 3 sedes, CRM con captación por red, promociones al cobro, kardex, máquinas, finanzas y 8 diseños de página.',
    incluye: ['Socios ilimitados · 3 sedes', 'CRM + captación desde redes', 'Kardex, finanzas y reportes Excel'] },
  { slug: 'cadena', nombre: 'Cadena', base: 179, app: 229, img: '/landing/capturas/rutinas.jpg',
    para: 'Multi-sede y franquicias',
    desc: 'Sedes y socios ilimitados, torniquetes y huella, varias marcas en una cuenta y soporte prioritario por WhatsApp. Todo lo de Crecimiento y más.',
    incluye: ['Sedes y socios ilimitados', 'Torniquetes y huella', 'Varias marcas + soporte prioritario'] },
]

const money = (n) => `S/ ${Number(n).toLocaleString('es-PE')}`

function cargarCulqi() {
  return new Promise((resolve, reject) => {
    if (window.Culqi) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.culqi.com/js/v4'
    s.onload = resolve
    s.onerror = () => reject(new Error('No se pudo cargar el checkout'))
    document.head.appendChild(s)
  })
}

export default function PlanesPublico() {
  const [conApp, setConApp] = useState(false)
  const [checkout, setCheckout] = useState(null) // plan en proceso de pago
  const [estado, setEstado] = useState(null) // { tipo:'ok'|'error', texto }

  useEffect(() => {
    document.title = 'Planes y precios — FitCore'
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
      { threshold: 0.12 },
    )
    document.querySelectorAll('.pp-reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div style={{ background: C.navy, color: C.ink, fontFamily: "'Manrope', system-ui, sans-serif", minHeight: '100vh' }}>
      <style>{`
        .pp-wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }
        .pp-a { text-decoration: none; }
        .pp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
        @media (max-width: 940px) { .pp-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 640px) { .pp-grid { grid-template-columns: 1fr; } }
        .pp-card { display: flex; flex-direction: column; background: ${C.surface};
          border: 1px solid ${C.line}; border-radius: 18px; overflow: hidden;
          transition: transform .28s ease, box-shadow .28s ease, border-color .28s ease; }
        .pp-card:hover { transform: translateY(-6px); border-color: rgba(255,107,53,.5);
          box-shadow: 0 30px 70px rgba(0,0,0,.45); }
        .pp-shot { aspect-ratio: 16/10; width: 100%; object-fit: cover; object-position: left top;
          border-bottom: 1px solid ${C.line}; background: #0A0F1A; }
        .pp-btn { cursor: pointer; border: none; width: 100%; padding: 13px; border-radius: 11px;
          font-weight: 800; font-size: 14.5px; color: #fff; background: ${C.orange};
          box-shadow: 0 10px 26px rgba(255,107,53,.28); transition: filter .2s; }
        .pp-btn:hover { filter: brightness(1.06); }
        .pp-btn:disabled { opacity: .55; cursor: default; box-shadow: none; }
        .pp-reveal { opacity: 0; transform: translateY(20px); transition: opacity .6s ease, transform .6s ease; }
        .pp-reveal.in { opacity: 1; transform: none; }
        @media (prefers-reduced-motion: reduce){ .pp-reveal{opacity:1;transform:none;transition:none} }
        .pp-toggle { display: inline-flex; background: ${C.surface}; border: 1px solid ${C.line};
          border-radius: 999px; padding: 4px; gap: 4px; }
        .pp-toggle button { cursor: pointer; border: none; background: transparent; color: ${C.muted};
          font-weight: 800; font-size: 13.5px; padding: 8px 18px; border-radius: 999px; transition: all .2s; }
        .pp-toggle button.on { background: ${C.orange}; color: #fff; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 20, backdropFilter: 'blur(12px)', background: 'rgba(14,21,38,.82)', borderBottom: `1px solid ${C.line}` }}>
        <div className="pp-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px' }}>
          <a className="pp-a" href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 18, letterSpacing: '-.4px', color: C.ink }}>
            <FitCoreLogo size={30} /> FitCore
          </a>
          <a className="pp-a" href="/registro" style={{ color: C.muted, fontWeight: 700, fontSize: 13.5 }}>Prueba gratis 30 días →</a>
        </div>
      </header>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '64px 0 34px' }}>
        <div className="pp-wrap">
          <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: C.orange, marginBottom: 16 }}>Planes y precios</span>
          <h1 style={{ fontSize: 'clamp(30px,5vw,46px)', lineHeight: 1.08, letterSpacing: '-1.2px', fontWeight: 800, margin: '0 0 16px' }}>
            El plan justo para tu negocio
          </h1>
          <p style={{ maxWidth: 560, margin: '0 auto 28px', fontSize: 16, lineHeight: 1.6, color: C.muted, fontWeight: 500 }}>
            Software de gestión + página web propia para gimnasios, estudios y entrenadores del Perú. Contrata en un minuto, con o sin la app para tus socios.
          </p>
          <div className="pp-toggle" role="group" aria-label="Incluir app del socio">
            <button className={!conApp ? 'on' : ''} onClick={() => setConApp(false)}>Solo panel</button>
            <button className={conApp ? 'on' : ''} onClick={() => setConApp(true)}>Panel + App del socio</button>
          </div>
        </div>
      </section>

      {/* Grid de planes */}
      <section style={{ padding: '10px 0 40px' }}>
        <div className="pp-wrap">
          <div className="pp-grid">
            {PLANES.map((p) => {
              const precio = conApp ? p.app : p.base
              return (
                <div key={p.slug} className="pp-card pp-reveal" style={p.popular ? { borderColor: C.orange } : undefined}>
                  <div style={{ position: 'relative' }}>
                    <img className="pp-shot" src={p.img} alt={`FitCore — plan ${p.nombre}`} loading="lazy" />
                    {p.popular && (
                      <span style={{ position: 'absolute', top: 12, right: 12, background: C.orange, color: '#fff', fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 999, boxShadow: '0 6px 18px rgba(255,107,53,.4)' }}>MÁS POPULAR</span>
                    )}
                  </div>
                  <div style={{ padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.5px', color: C.orange }}>{p.para}</div>
                    <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.5px', margin: '4px 0 8px' }}>{p.nombre}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
                      <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-1px' }}>{money(precio)}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: C.muted }}>/mes</span>
                    </div>
                    <p style={{ fontSize: 13, lineHeight: 1.55, color: C.muted, fontWeight: 500, margin: '0 0 14px' }}>{p.desc}</p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 18px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {p.incluye.map((f) => (
                        <li key={f} style={{ display: 'flex', gap: 8, fontSize: 12.5, fontWeight: 600, color: C.ink }}>
                          <span style={{ color: C.orange, fontWeight: 800 }}>✓</span> {f}
                        </li>
                      ))}
                    </ul>
                    <button className="pp-btn" style={{ marginTop: 'auto' }} onClick={() => setCheckout({ ...p, precio, conApp })}>
                      Contratar {money(precio)}/mes
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <p style={{ textAlign: 'center', color: C.faint, fontSize: 12.5, fontWeight: 600, marginTop: 26 }}>
            Precios en soles (S/), IGV incluido. Pago mensual, sin permanencia — cancela cuando quieras.
            ¿Prefieres probar antes? <a className="pp-a" href="/registro" style={{ color: C.orange }}>30 días gratis sin tarjeta →</a>
          </p>
        </div>
      </section>

      <footer style={{ textAlign: 'center', padding: '30px 0 50px', color: C.faint, fontSize: 12.5, fontWeight: 600, borderTop: `1px solid ${C.line}` }}>
        FitCore · El sistema operativo del fitness · fitcorecenter.com ·{' '}
        <a className="pp-a" href="/terminos" style={{ color: C.muted }}>Términos</a> ·{' '}
        <a className="pp-a" href="/privacidad" style={{ color: C.muted }}>Privacidad</a> ·{' '}
        <a className="pp-a" href="/reclamaciones" style={{ color: C.muted }}>Libro de reclamaciones</a>
      </footer>

      {checkout && (
        <CheckoutModal
          plan={checkout}
          onClose={() => setCheckout(null)}
          onDone={(texto) => { setCheckout(null); setEstado({ tipo: 'ok', texto }) }}
        />
      )}
      {estado && <Aviso {...estado} onClose={() => setEstado(null)} />}
    </div>
  )
}

// Modal: pide datos mínimos de contacto y abre el checkout de Culqi (cargo único).
function CheckoutModal({ plan, onClose, onDone }) {
  const [f, setF] = useState({ nombre: '', nombre_gym: '', email: '', telefono: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const listo = useMemo(() => f.email.includes('@') && f.nombre.trim() && f.nombre_gym.trim(), [f])
  const input = { background: '#0E1524', border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 13px', fontSize: 14, color: C.ink, outline: 'none', width: '100%' }

  async function pagar() {
    setErr('')
    if (!CULQI_PK) { setErr('Los pagos con tarjeta se habilitan muy pronto. Escríbenos por WhatsApp para contratar por Yape/Plin.'); return }
    setBusy(true)
    try {
      await cargarCulqi()
      window.Culqi.publicKey = CULQI_PK
      window.culqi = async function () {
        if (window.Culqi.token) {
          try { window.Culqi.close() } catch { /* modal puede no existir */ }
          try {
            const res = await fetch('/api/culqi/pago-publico', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                token_id: window.Culqi.token.id,
                plan_slug: plan.slug, con_app: plan.conApp,
                email: f.email, nombre: f.nombre, telefono: f.telefono, nombre_gym: f.nombre_gym,
              }),
            })
            const out = await res.json()
            if (!res.ok) throw new Error(out.error || 'No se pudo procesar el pago')
            onDone('¡Pago recibido! 🎉 Te contactaremos por correo para dejar tu cuenta lista en minutos.')
          } catch (e) {
            setErr(e.message); setBusy(false)
          }
        } else if (window.Culqi.error) {
          setErr(window.Culqi.error.user_message || 'Tarjeta rechazada'); setBusy(false)
        }
      }
      window.Culqi.settings({ title: 'FitCore', currency: 'PEN', amount: Math.round(plan.precio * 100) })
      window.Culqi.options({
        lang: 'auto', installments: false,
        paymentMethods: { tarjeta: true, yape: false, bancaMovil: false, agente: false, billetera: false, cuotealo: false },
        style: { buttonBackground: '#FF6B35' },
      })
      window.Culqi.open()
    } catch (e) {
      setErr(e.message || 'No se pudo abrir el checkout'); setBusy(false)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(6,10,18,.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 24, boxShadow: '0 40px 100px rgba(0,0,0,.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Contratar {plan.nombre}</div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: 'rgba(255,255,255,.08)', border: 'none', color: C.ink, width: 32, height: 32, borderRadius: 9, fontWeight: 800, cursor: 'pointer' }}>✕</button>
        </div>
        <p style={{ color: C.muted, fontSize: 13, fontWeight: 600, margin: '0 0 16px' }}>
          {plan.conApp ? 'Panel + App del socio' : 'Solo panel'} · <b style={{ color: C.orange }}>{money(plan.precio)}/mes</b> · primer mes ahora
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input style={input} placeholder="Tu nombre *" value={f.nombre} onChange={set('nombre')} />
          <input style={input} placeholder="Nombre de tu gimnasio *" value={f.nombre_gym} onChange={set('nombre_gym')} />
          <input style={input} type="email" placeholder="Correo *" value={f.email} onChange={set('email')} />
          <input style={input} placeholder="Teléfono / WhatsApp" value={f.telefono} onChange={set('telefono')} />
        </div>
        {err && <div style={{ marginTop: 12, background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#FCA5A5', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, fontWeight: 600 }}>{err}</div>}
        <button className="pp-btn" style={{ marginTop: 16 }} disabled={busy || !listo} onClick={pagar}>
          {busy ? 'Abriendo pago…' : `Pagar ${money(plan.precio)} con tarjeta`}
        </button>
        <p style={{ textAlign: 'center', color: C.faint, fontSize: 11, fontWeight: 600, marginTop: 12 }}>
          🔒 Pago seguro procesado por Culqi. No guardamos tu tarjeta.
        </p>
      </div>
    </div>
  )
}

function Aviso({ tipo, texto, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(6,10,18,.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 28, textAlign: 'center', boxShadow: '0 40px 100px rgba(0,0,0,.6)' }}>
        <div style={{ fontSize: 42, marginBottom: 10 }}>{tipo === 'ok' ? '🎉' : '⚠️'}</div>
        <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5, margin: '0 0 20px' }}>{texto}</p>
        <button className="pp-btn" onClick={onClose}>Entendido</button>
      </div>
    </div>
  )
}
