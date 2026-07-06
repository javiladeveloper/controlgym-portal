import { useEffect, useState, useCallback } from 'react'
import { FitCoreLogo } from '../components/icons.jsx'

// Demo de venta de FitCore para dueños de gimnasios. Vive en tu dominio
// (fitcorecenter.com/demo) con las capturas REALES del panel y la app.
// Recorrido: "un día en tu gimnasio" — cada módulo es un momento real.

const C = {
  navy: '#0E1526', surface: '#1C2438', orange: '#FF6B35',
  ink: '#F4F6FB', muted: '#8B96AC', faint: '#5A6478',
  line: 'rgba(255,255,255,.09)', orangeSoft: 'rgba(255,107,53,.14)',
}
const cap = (n) => `/landing/capturas/${n}.jpg`

const PASOS = [
  { k: 'clientes', momento: 'Llega un socio', titulo: 'Todos tus socios, ordenados',
    desc: 'Cada persona con su ficha, DNI verificado, plan y vencimiento. Lo buscas por nombre o DNI en un segundo — se acabó el cuaderno.',
    puntos: ['Alta con DNI verificado', 'Ves quién está por vencer', 'Historial de asistencia'] },
  { k: 'membresias', momento: 'Le cobras', titulo: 'Que no se te escape ni un pago',
    desc: 'Los cobros pendientes al frente, en rojo los vencidos. Cobras y renuevas en un clic, aceptas pagos en partes, y le mandas el recordatorio por WhatsApp.',
    puntos: ['Vencidos y por vencer a la vista', 'Cobra y renueva en 1 clic', 'Precio especial para el que vuelve'] },
  { k: 'rutinas', momento: 'Le arman su plan', titulo: 'Rutina y dieta, directo a su celular',
    desc: 'El entrenador arma la rutina por día, el nutricionista la dieta, con banco de ejercicios y videos. Un botón y le llega a la app del socio.',
    puntos: ['Rutina por día con series y carga', 'Videos de cómo se hace cada ejercicio', 'Se envía a la app del socio'] },
  { k: 'personal', momento: 'Manejas tu equipo', titulo: 'Tu equipo, turnos y planilla',
    desc: 'Colaboradores con sueldo o pago por clase, sus datos bancarios a la mano, y la planilla del mes en un solo pago. Hasta ves quién atendió más rápido.',
    puntos: ['Sueldo o pago por clase', 'Planilla del mes en lote', 'Ranking de desempeño'] },
  { k: 'kardex', momento: 'Vendes en recepción', titulo: 'Tus productos y su stock',
    desc: 'Proteínas, agua, suplementos — controlas el stock, registras cada venta, y todo cae solo en tus finanzas del día.',
    puntos: ['Stock por sede', 'Cada venta va a la caja', 'Suplementos para recomendar'] },
  { k: 'finanzas', momento: 'Cierras el día', titulo: 'Sabes exactamente cuánto entró',
    desc: 'Caja del día que cuadra sola, ingresos contra gastos, quién debe, y todo lo exportas a Excel cuando lo necesites.',
    puntos: ['Caja del día con cuadre', 'Ingresos vs gastos claros', 'Reporte de deudores'] },
]

const REG = 'https://fitcorecenter.com/registro'

// Pantallas del panel para el tour "por dentro" (capturas reales de MaximusGym).
const TOUR = [
  { k: 'clientes', nombre: 'Clientes', pie: 'Todos tus socios, con su plan, estado y vencimiento. Búscalos por nombre o DNI.' },
  { k: 'membresias', nombre: 'Membresías', pie: 'Cobros pendientes al frente, en rojo los vencidos. Cobra y renueva en un clic.' },
  { k: 'rutinas', nombre: 'Rutinas y dietas', pie: 'El plan del socio por día, con banco de ejercicios y video. Se envía a su app.' },
  { k: 'personal', nombre: 'Personal', pie: 'Tu equipo con sueldo o pago por clase, turnos y la planilla del mes.' },
  { k: 'kardex', nombre: 'Kardex', pie: 'Inventario y ventas de productos, conectados a la caja del día.' },
  { k: 'finanzas', nombre: 'Finanzas', pie: 'Ingresos vs gastos, caja del día que cuadra sola y reporte de deudores.' },
]

// Tour navegable del panel: modal a pantalla completa con la captura grande,
// navegación por flechas / teclado / miniaturas. Muestra el producto real
// sin dar acceso al panel (cero riesgo).
function TourPanel({ onClose }) {
  const [i, setI] = useState(0)
  const n = TOUR.length
  const ir = useCallback((idx) => setI((idx + n) % n), [n])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') ir(i + 1)
      else if (e.key === 'ArrowLeft') ir(i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, ir, onClose])

  const s = TOUR[i]
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(6,10,18,.94)', display: 'flex', flexDirection: 'column', padding: '20px 24px' }}>
      {/* Barra superior */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1200, width: '100%', margin: '0 auto 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FitCoreLogo size={26} />
          <span style={{ fontWeight: 800, fontSize: 15 }}>El panel por dentro</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, marginLeft: 6 }}>{i + 1} / {n} · {s.nombre}</span>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,.08)', border: 'none', color: C.ink, width: 34, height: 34, borderRadius: 9, fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>✕</button>
      </div>

      {/* Captura grande + flechas */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', flex: 1, maxWidth: 1200, width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        <button onClick={() => ir(i - 1)} aria-label="Anterior" style={{ position: 'absolute', left: -6, zIndex: 2, background: 'rgba(28,36,56,.9)', border: `1px solid ${C.line}`, color: C.ink, width: 44, height: 44, borderRadius: 999, fontSize: 20, fontWeight: 800, cursor: 'pointer' }}>‹</button>
        <img key={s.k} src={cap(s.k)} alt={s.nombre}
          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 12, border: `1px solid ${C.line}`, boxShadow: '0 30px 80px rgba(0,0,0,.6)', animation: 'dvFade .35s ease' }} />
        <button onClick={() => ir(i + 1)} aria-label="Siguiente" style={{ position: 'absolute', right: -6, zIndex: 2, background: 'rgba(28,36,56,.9)', border: `1px solid ${C.line}`, color: C.ink, width: 44, height: 44, borderRadius: 999, fontSize: 20, fontWeight: 800, cursor: 'pointer' }}>›</button>
      </div>

      {/* Pie + miniaturas */}
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1200, width: '100%', margin: '12px auto 0' }}>
        <p style={{ textAlign: 'center', color: C.muted, fontSize: 13.5, fontWeight: 600, margin: '0 0 14px' }}>{s.pie}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {TOUR.map((t, idx) => (
            <button key={t.k} onClick={() => ir(idx)}
              style={{ background: 'none', border: idx === i ? `2px solid ${C.orange}` : `2px solid transparent`, padding: 0, borderRadius: 8, cursor: 'pointer', opacity: idx === i ? 1 : .55, transition: 'opacity .2s' }}>
              <img src={cap(t.k)} alt={t.nombre} style={{ width: 96, height: 58, objectFit: 'cover', objectPosition: 'left top', borderRadius: 6, display: 'block' }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function DemoVenta() {
  const [tourOpen, setTourOpen] = useState(false)

  // Aparición suave de secciones al hacer scroll
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
      { threshold: 0.12 },
    )
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div style={{ background: C.navy, color: C.ink, fontFamily: "'Manrope', system-ui, sans-serif", overflowX: 'hidden', minHeight: '100vh' }}>
      <style>{`
        .dv-wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }
        .dv-shot { border-radius: 14px; border: 1px solid ${C.line}; box-shadow: 0 34px 80px rgba(0,0,0,.5); display: block; width: 100%; }
        .dv-paso { display: grid; grid-template-columns: 1fr 1.12fr; gap: 54px; align-items: center; padding: 62px 0; border-top: 1px solid ${C.line}; }
        .dv-paso:nth-child(even) { grid-template-columns: 1.12fr 1fr; }
        .dv-paso:nth-child(even) .dv-txt { order: 2; }
        @media (max-width: 820px) {
          .dv-paso, .dv-paso:nth-child(even) { grid-template-columns: 1fr !important; gap: 26px; }
          .dv-paso:nth-child(even) .dv-txt { order: 0; }
          .dv-eco, .dv-web { grid-template-columns: 1fr !important; gap: 34px; }
          .dv-phone { width: 230px !important; }
        }
        .reveal { opacity: 0; transform: translateY(22px); transition: opacity .7s ease, transform .7s ease; }
        .reveal.in { opacity: 1; transform: none; }
        @media (prefers-reduced-motion: reduce) { .reveal { opacity: 1; transform: none; transition: none; } }
        .dv-a { text-decoration: none; }
        @keyframes dvFade { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      {tourOpen && <TourPanel onClose={() => setTourOpen(false)} />}

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 20, backdropFilter: 'blur(12px)', background: 'rgba(14,21,38,.82)', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', maxWidth: 1160, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 800, fontSize: 18, letterSpacing: '-.4px' }}>
            <FitCoreLogo size={30} /> FitCore
          </div>
          <a className="dv-a" href={REG} style={{ background: C.orange, color: '#fff', padding: '10px 18px', borderRadius: 10, fontWeight: 800, fontSize: 13.5 }}>Empieza gratis</a>
        </div>
      </header>

      {/* Hero */}
      <section style={{ position: 'relative', padding: '84px 0 54px', textAlign: 'center' }}>
        <div style={{ position: 'absolute', top: -80, left: '50%', transform: 'translateX(-50%)', width: 620, height: 420, background: 'radial-gradient(closest-side, rgba(255,107,53,.16), transparent)', pointerEvents: 'none' }} />
        <div className="dv-wrap" style={{ position: 'relative' }}>
          <span style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: C.orange, marginBottom: 18 }}>El sistema operativo de tu gimnasio</span>
          <h1 style={{ fontSize: 'clamp(34px,6vw,60px)', lineHeight: 1.04, letterSpacing: '-1.5px', fontWeight: 800, margin: '0 0 20px' }}>
            Controla todo tu gym.<br /><span style={{ color: C.orange }}>Y trae más socios.</span>
          </h1>
          <p style={{ maxWidth: 560, margin: '0 auto 30px', fontSize: 16.5, lineHeight: 1.6, color: C.muted, fontWeight: 500 }}>
            Socios, cobros, rutinas, tu propia página web y una app para tus miembros — todo en una sola plataforma, hecha para gimnasios del Perú.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="dv-a" href={REG} style={{ background: C.orange, color: '#fff', padding: '14px 26px', borderRadius: 12, fontWeight: 800, fontSize: 15, boxShadow: '0 12px 34px rgba(255,107,53,.3)' }}>Empieza gratis — 1 mes</a>
            <button onClick={() => setTourOpen(true)} style={{ color: C.ink, background: 'transparent', border: `1px solid ${C.line}`, padding: '14px 24px', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>Ver el panel por dentro →</button>
          </div>
          <div style={{ marginTop: 16, fontSize: 12.5, color: C.faint, fontWeight: 600 }}>Sin tarjeta · Sin instalar nada · Listo hoy</div>
        </div>
      </section>

      {/* Segmentos */}
      <div className="dv-wrap">
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 18px', padding: '8px 0 60px' }}>
          {['🏋️ Gimnasios', '🧘 Yoga y pilates', '💃 Academias de baile', '🥋 Artes marciales', '👦 Para niños', '🔥 Personal trainers'].map((s) => (
            <span key={s} style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>{s}</span>
          ))}
        </div>
      </div>

      {/* Recorrido */}
      <section style={{ padding: '30px 0 20px' }}>
        <div className="dv-wrap">
          <div className="reveal" style={{ textAlign: 'center', marginBottom: 8 }}>
            <h2 style={{ fontSize: 'clamp(26px,4vw,34px)', letterSpacing: '-.7px', fontWeight: 800, margin: 0 }}>Un día en tu gimnasio, resuelto</h2>
            <p style={{ color: C.muted, fontWeight: 600, margin: '10px 0 0', fontSize: 14.5 }}>Desde que llega un socio hasta que cierras la caja — FitCore te acompaña en cada momento.</p>
          </div>
          {PASOS.map((p) => (
            <div className="dv-paso reveal" key={p.k}>
              <div className="dv-txt">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.4px', color: C.orange, marginBottom: 12 }}>
                  <span style={{ width: 22, height: 1, background: C.orange }} />{p.momento}
                </span>
                <h3 style={{ fontSize: 'clamp(22px,3vw,27px)', letterSpacing: '-.5px', fontWeight: 800, lineHeight: 1.15, margin: '0 0 14px' }}>{p.titulo}</h3>
                <p style={{ color: C.muted, fontWeight: 500, lineHeight: 1.6, fontSize: 14.5, margin: '0 0 20px', maxWidth: 440 }}>{p.desc}</p>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 9 }}>
                  {p.puntos.map((x) => (
                    <li key={x} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, fontWeight: 600, color: 'rgba(244,246,251,.86)' }}>
                      <span style={{ color: C.orange, fontWeight: 800 }}>✓</span>{x}
                    </li>
                  ))}
                </ul>
              </div>
              <img className="dv-shot" src={cap(p.k)} alt={p.titulo} loading="lazy" />
            </div>
          ))}
        </div>
      </section>

      {/* App */}
      <section style={{ padding: '80px 0', marginTop: 40, background: 'linear-gradient(180deg, transparent, rgba(255,107,53,.05))', borderTop: `1px solid ${C.line}` }}>
        <div className="dv-wrap dv-eco" style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 56, alignItems: 'center' }}>
          <div className="reveal">
            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: C.orange, border: `1px solid ${C.line}`, borderRadius: 999, padding: '5px 14px', marginBottom: 16 }}>📱 Incluye la app para tus socios</span>
            <h2 style={{ fontSize: 'clamp(26px,4vw,36px)', letterSpacing: '-.8px', lineHeight: 1.12, fontWeight: 800, margin: '0 0 16px' }}>Tu gimnasio en el bolsillo de cada socio</h2>
            <p style={{ color: C.muted, fontWeight: 500, lineHeight: 1.6, fontSize: 15, margin: '0 0 22px', maxWidth: 460 }}>No es solo un software para ti. Tus miembros llevan su carnet, su rutina y su dieta en el celular — con la marca de tu gimnasio, en Android y iPhone.</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 11 }}>
              {['Carnet QR para entrar al gym', 'Su rutina del día, con videos', 'Reserva de clases y su progreso', 'Pide ayuda al trainer desde la app'].map((x) => (
                <li key={x} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, background: C.orange, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, flexShrink: 0 }}>✓</span>{x}
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal dv-phone" style={{ justifySelf: 'center', width: 262, borderRadius: 34, padding: 9, background: '#05090F', border: '7px solid #263149', boxShadow: '0 40px 90px rgba(0,0,0,.6)' }}>
            <img src={cap('app')} alt="La app FitCore del socio" style={{ borderRadius: 26, display: 'block', width: '100%' }} />
          </div>
        </div>
      </section>

      {/* Web propia */}
      <section style={{ padding: '70px 0', borderTop: `1px solid ${C.line}` }}>
        <div className="dv-wrap dv-web" style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 54, alignItems: 'center' }}>
          <img className="dv-shot reveal" src={cap('web')} alt="Página web del gimnasio" loading="lazy" />
          <div className="reveal">
            <h2 style={{ fontSize: 'clamp(24px,3.5vw,32px)', letterSpacing: '-.7px', lineHeight: 1.14, fontWeight: 800, margin: '0 0 14px' }}>Tu propia página web,<br />sin pagar un diseñador</h2>
            <p style={{ color: C.muted, fontWeight: 500, lineHeight: 1.6, fontSize: 14.5, margin: '0 0 16px', maxWidth: 440 }}>Cada gimnasio recibe su página con dirección propia (tugym.fitcorecenter.com), lista para compartir en redes. Los interesados caen directo a tu CRM.</p>
            <div style={{ background: C.orangeSoft, border: '1px solid rgba(255,107,53,.28)', borderRadius: 12, padding: '14px 16px', fontSize: 13, lineHeight: 1.55, fontWeight: 600 }}>
              <b style={{ color: C.orange }}>Ningún otro sistema en Perú te da esto:</b> otros muestran una ficha genérica con la marca de ellos. Aquí la página es <b>tuya</b> — tu dirección, tus colores, tu estilo.
            </div>
          </div>
        </div>
      </section>

      {/* Cierre */}
      <section style={{ textAlign: 'center', padding: '90px 0 40px' }}>
        <div className="dv-wrap">
          <h2 style={{ fontSize: 'clamp(28px,5vw,44px)', letterSpacing: '-1px', lineHeight: 1.1, fontWeight: 800, margin: '0 0 16px' }}>Empieza gratis hoy</h2>
          <p style={{ color: C.muted, fontSize: 16, fontWeight: 500, margin: '0 auto 28px', maxWidth: 480 }}>Un mes de prueba, sin tarjeta. Registra tu gimnasio en un minuto y empieza a ordenarlo — y a crecer.</p>
          <a className="dv-a" href={REG} style={{ background: C.orange, color: '#fff', padding: '14px 26px', borderRadius: 12, fontWeight: 800, fontSize: 15, boxShadow: '0 12px 34px rgba(255,107,53,.3)' }}>Crear mi gimnasio →</a>
        </div>
      </section>

      <footer style={{ textAlign: 'center', padding: '30px 0 50px', color: C.faint, fontSize: 12.5, fontWeight: 600, borderTop: `1px solid ${C.line}` }}>
        FitCore · El sistema operativo del fitness · fitcorecenter.com
      </footer>
    </div>
  )
}
