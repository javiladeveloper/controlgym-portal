import { useEffect, useState } from 'react'
import { FitControlLogo } from '../components/icons.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'

// Landing de la PLATAFORMA (fitcorecenter.com): dark premium.
// Tokens: bg #141B2E · surface #1F293D · primary #FF6B35 · muted #8E9AA8 · radius 8px
// En producción el panel vive en app.fitcorecenter.com; en dev (localhost) nos
// quedamos en el mismo origen para no saltar a producción al hacer clic.
const IS_DEV_HOST = ['localhost', '127.0.0.1'].includes(window.location.hostname)
const APP_URL = IS_DEV_HOST ? '' : `https://app.${ROOT_DOMAIN}`
// Contacto oficial de la plataforma
const WA_NUM = '+51 986 110 558'
const WA_LINK = 'https://wa.me/51986110558?text=' + encodeURIComponent('Hola, quiero información sobre FitControl para mi gimnasio')
const MAIL_HOLA = `hola@${ROOT_DOMAIN}`
const MAIL_SOPORTE = `soporte@${ROOT_DOMAIN}`
const C = {
  bg: '#141B2E', surface: '#1F293D', primary: '#FF6B35',
  muted: '#8E9AA8', border: '1px solid rgba(255,255,255,0.08)',
}

// ── Mockup del panel en código (nítido, sin imágenes) ───────────────────────
function DashboardMockup() {
  const barras = [28, 42, 35, 24, 18, 30, 55, 88, 72, 40]
  return (
    <div className="w-full max-w-[520px] overflow-hidden"
      style={{ background: C.surface, border: C.border, borderRadius: 14, boxShadow: '0 40px 100px rgba(0,0,0,0.5), 0 20px 60px rgba(255,107,53,0.12)' }}>
      {/* barra de ventana */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: C.border }}>
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full" style={{ background: C.primary }} />
        <span className="ml-2 text-[11px] font-bold" style={{ color: C.muted }}>FitControl · Panel</span>
        <span className="ml-auto rounded-full px-2.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white" style={{ background: C.primary }}>En vivo</span>
      </div>
      <div className="p-4">
        {/* métricas */}
        <div className="grid grid-cols-3 gap-2.5">
          {[['Socios activos', '312', '+18 este mes'], ['Ingresos del mes', 'S/ 24,830', '+9%'], ['Hora pico', '7:00 pm', '34 en sede']].map(([l, v, d]) => (
            <div key={l} className="rounded-lg p-3" style={{ border: C.border }}>
              <div className="text-[9px] font-extrabold uppercase tracking-wider" style={{ color: C.muted }}>{l}</div>
              <div className="mt-1 text-[17px] font-extrabold text-white">{v}</div>
              <div className="text-[9.5px] font-bold" style={{ color: C.primary }}>{d}</div>
            </div>
          ))}
        </div>
        {/* gráfico */}
        <div className="mt-3 rounded-lg p-3" style={{ border: C.border }}>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-extrabold text-white">Asistencia de hoy</span>
            <span className="text-[9px] font-bold" style={{ color: C.muted }}>6am — 9pm</span>
          </div>
          <div className="mt-2.5 flex h-[64px] items-end gap-1.5">
            {barras.map((h, i) => (
              <div key={i} className="flex-1 rounded-t"
                style={{ height: `${h}%`, background: h > 60 ? C.primary : 'rgba(255,107,53,0.35)' }} />
            ))}
          </div>
        </div>
        {/* check-ins */}
        <div className="mt-3 rounded-lg p-3" style={{ border: C.border }}>
          {[['CM', 'Carlos Mendoza', 'Huella verificada · 6:05 pm'], ['LR', 'Lucía Ramos', 'Check-in recepción · 6:02 pm']].map(([ini, n, d]) => (
            <div key={ini} className="flex items-center gap-2.5 py-1.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-extrabold text-white" style={{ background: 'rgba(255,107,53,0.25)', color: C.primary }}>{ini}</span>
              <div className="min-w-0">
                <div className="text-[11px] font-extrabold text-white">{n}</div>
                <div className="text-[9px] font-semibold" style={{ color: C.muted }}>{d}</div>
              </div>
              <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: '#3FCB9C' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Mockup de la página web de un gym (navegador con landing en miniatura) ──
function GymPageMockup() {
  return (
    <div className="w-full max-w-[460px] overflow-hidden"
      style={{ background: C.surface, border: C.border, borderRadius: 14, boxShadow: '0 40px 100px rgba(0,0,0,0.5)' }}>
      {/* barra del navegador */}
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: C.border }}>
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-2 rounded-md px-3 py-1 text-[10px] font-bold" style={{ background: 'rgba(255,255,255,0.06)', color: C.muted }}>
          🔒 powergym.{ROOT_DOMAIN}
        </span>
      </div>
      {/* landing del gym en miniatura */}
      <div className="bg-white">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-4 w-4 rounded" style={{ background: '#D32F2F' }} />
            <span className="text-[9px] font-extrabold text-slate-900">POWERGYM</span>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[8px] font-extrabold text-white" style={{ background: '#D32F2F' }}>INSCRÍBETE</span>
        </div>
        <div className="relative flex h-[110px] flex-col items-center justify-center px-6 text-center" style={{ background: 'linear-gradient(135deg, #1a1a1a 0%, #3a0d0d 100%)' }}>
          <div className="text-[13px] font-extrabold tracking-tight text-white">ENTRENA SIN EXCUSAS</div>
          <div className="mt-1 text-[8px] font-semibold text-white/70">3 sedes en Lima · Desde S/ 79 al mes</div>
          <span className="mt-2 rounded-full px-3 py-1 text-[8px] font-extrabold text-white" style={{ background: '#D32F2F' }}>Empieza hoy →</span>
        </div>
        <div className="grid grid-cols-3 gap-2 p-3">
          {[['Mensual', 'S/ 79'], ['Trimestral', 'S/ 210'], ['Anual', 'S/ 750']].map(([n, p]) => (
            <div key={n} className="rounded-lg border border-slate-200 p-2 text-center">
              <div className="text-[7.5px] font-extrabold text-slate-500">{n}</div>
              <div className="text-[11px] font-extrabold text-slate-900">{p}</div>
              <div className="mx-auto mt-1.5 h-[10px] w-12 rounded-full" style={{ background: '#D32F2F' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const SEGMENTOS = ['🏋️ Gimnasios fitness', '🧘 Yoga y pilates', '💃 Academias de baile', '🥋 Artes marciales', '👦 Academias para niños', '🔥 Entrenamiento funcional']

const ANTES_DESPUES = [
  ['Cuaderno de asistencias en recepción', 'Check-in en un clic, listo para torniquete y huella'],
  ['"¿Quién no ha pagado?" buscando en Excel', 'Vencimientos y cobros a la vista, renovación en segundos'],
  ['Interesados que se pierden en el WhatsApp', 'CRM con cada prospecto y desde qué red social llegó'],
  ['Sin página web o pagando una carísima', 'Tu web con tu marca, gratis, lista en minutos'],
]

const FAQS = [
  ['¿Necesito instalar algo o comprar equipos?', 'No. FitControl funciona desde el navegador de tu compu, tablet o celular. Los torniquetes y lectores de huella son opcionales y se integran cuando los necesites.'],
  ['¿Cómo funciona la página web de mi gimnasio?', 'Al registrarte eliges tu dirección (tugym.' + ROOT_DOMAIN + ') y tu página se genera sola con tus planes, horario, fotos y colores. Eliges entre 8 diseños y todo lo editas desde el panel, sin programadores.'],
  ['¿Cómo cobro a mis socios?', 'Como siempre lo has hecho: Yape, Plin, efectivo o tarjeta. FitControl registra cada cobro, aplica promociones automáticamente y te cuadra la caja. No nos llevamos comisión de tus membresías.'],
  ['¿Sirve si solo doy clases (yoga, baile, box, dojo)?', 'Sí, con plan propio: Academia a S/49/mes con un panel a tu medida — clases, alumnos, reservas y tu página web, sin módulos que no usas.'],
  ['Soy personal trainer, ¿me sirve?', 'Sí — es nuestro plan más accesible (S/29/mes): tus clientes, tus paquetes de sesiones, tus cobros y tu página personal (tunombre.fitcorecenter.com) para captar desde tus redes. Y cuando salga la app, apareces en las búsquedas de tu zona sin costo extra.'],
  ['¿Qué incluye la app para socios y cuánto cuesta?', 'Es un adicional fijo por gimnasio (no por socio): tus alumnos reservan clases, ven su rutina, su dieta y el estado de su membresía desde su celular. Cuesta desde S/ 30 extra al mes según tu plan, cubre a todos tus socios y está disponible muy pronto.'],
  ['¿Qué pasa cuando termina mi mes de prueba?', 'Eliges el plan que te acomode y sigues donde quedaste. Tus datos nunca se borran ni se bloquean de un día para otro.'],
  ['¿Puedo cambiar de plan o cancelar?', 'Cuando quieras, sin permanencia ni penalidades. Subes o bajas de plan según crece tu gimnasio.'],
]

const VALORES = [
  { icon: '🚪', t: 'Check-ins sin fricción', d: 'Acceso validado al segundo en recepción — y listo para torniquetes con huella. Cero colas, cero cuadernos.' },
  { icon: '📈', t: 'Capta y retén con datos', d: 'Cada interesado de tus redes cae a tu CRM con su origen. Sabes qué red te trae clientes y a quién renovar antes de que se vaya.' },
  { icon: '💳', t: 'Cobros que cuadran solos', d: 'Yape, Plin, efectivo o tarjeta. Promociones que descuentan solas y una caja que siempre cuadra con Finanzas.' },
]

const FEATURES = [
  ['🌐', 'Página web con tu marca', 'tugym.fitcorecenter.com lista en minutos, con tus colores, fotos y planes.'],
  ['📧', 'Avisos automáticos', 'Email al instante con cada nuevo interesado para cerrarlo en minutos.'],
  ['🏋️', 'Clases y servicios', 'Horario semanal, cupos y acceso por plan. Yoga, baile, funcional, lo que tengas.'],
  ['📦', 'Kardex e inventario', 'Stock y ventas de productos conectados a tu caja.'],
  ['🎨', 'Personalización total', '8 diseños de página, colores, tipografías. Tu marca, no la nuestra.'],
  ['📊', 'Reportes en Excel', 'Asistencia, ingresos, por vencer, inventario y prospectos con un clic.'],
]

const PASOS = [
  ['1', 'Regístrate gratis', 'Nombre de tu gym, tu dirección web y el tipo de gimnasio. Un minuto.'],
  ['2', 'Personaliza', 'Logo, colores y fotos. Tus planes y horario ya vienen pre-armados.'],
  ['3', 'Comparte y crece', 'Tu página en WhatsApp e Instagram. Los interesados caen a tu CRM.'],
]

// Cada plan tiene 2 precios: solo panel, o panel + app para socios (adicional).
const PLANES = [
  {
    nombre: 'Estudio', base: 49, conApp: 79, popular: false, foto: '/landing/paso2.jpg',
    para: 'Yoga, pilates, baile y gimnasios pequeños',
    features: ['1 sede · hasta 50 socios activos', '2 usuarios del panel', 'Socios, membresías y cobros', 'Clases y check-in', 'Página web con subdominio', 'Reportes básicos'],
    no: ['CRM y captación desde redes'],
  },
  {
    nombre: 'Crecimiento', base: 99, conApp: 139, popular: true, foto: '/landing/hero.jpg',
    para: 'El gimnasio que quiere captar y crecer',
    features: ['Hasta 3 sedes · 200 socios activos', 'Usuarios ilimitados', 'Todo lo de Estudio', 'CRM + captación con origen por red', 'Emails automáticos de interesados', 'Promociones aplicadas al cobro', 'Kardex, máquinas y finanzas', 'Personalización total (8 diseños)', 'Reportes en Excel'],
    no: [],
  },
  {
    nombre: 'Cadena', base: 179, conApp: 229, popular: false, foto: '/landing/devices.jpg',
    para: 'Multi-sede, franquicias y gyms completos',
    features: ['Sedes y socios ilimitados', 'Todo lo de Crecimiento', 'Torniquetes y huella', 'Varias marcas en una cuenta', 'Soporte prioritario por WhatsApp'],
    no: [],
  },
]

export default function PlataformaLanding() {
  // Precios: alterna entre solo panel y panel + app para socios
  const [conApp, setConApp] = useState(false)
  // Menú móvil del header
  const [menu, setMenu] = useState(false)
  // Aparición suave de secciones al hacer scroll
  useEffect(() => {
    const els = document.querySelectorAll('.lp-rev')
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('lp-rev-in'); io.unobserve(e.target) }
      }),
      { threshold: 0.12 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <div className="min-h-screen text-white" style={{ background: C.bg, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        html { scroll-behavior: smooth; }
        .lp-rev { opacity: 0; transform: translateY(20px); transition: opacity .6s ease, transform .6s ease; }
        .lp-rev-in { opacity: 1; transform: none; }
        details.lp-faq summary::-webkit-details-marker { display: none; }
        details.lp-faq[open] .lp-faq-chevron { transform: rotate(180deg); }
      `}</style>
      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: 'rgba(20,27,46,0.85)', borderBottom: C.border }}>
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <FitControlLogo size={36} />
            <span className="text-[17px] font-extrabold tracking-[-0.3px]">FitControl</span>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            {[['Funciones', '#funciones'], ['Tu página web', '#pagina-web'], ['Precios', '#precios'], ['La app', '#app'], ['Preguntas', '#faq']].map(([l, h]) => (
              <a key={h} href={h} className="px-3 py-2 text-[13px] font-bold transition-colors hover:text-white" style={{ color: C.muted }}>{l}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href={`${APP_URL}/login`} className="hidden px-3 py-2 text-[13.5px] font-extrabold transition-colors hover:text-white sm:block" style={{ color: C.muted }}>Entrar</a>
            <a href={`${APP_URL}/registro`} className="rounded-lg px-4 py-2.5 text-[13.5px] font-extrabold text-white transition-transform hover:scale-[1.03]" style={{ background: C.primary }}>
              Crear mi gimnasio
            </a>
            <button onClick={() => setMenu(!menu)} aria-label="Menú"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[20px] md:hidden" style={{ border: C.border }}>
              {menu ? '✕' : '☰'}
            </button>
          </div>
        </div>
        {/* Menú móvil desplegable */}
        {menu && (
          <nav className="flex flex-col px-6 pb-4 md:hidden" style={{ borderTop: C.border }}>
            {[['Funciones', '#funciones'], ['Tu página web', '#pagina-web'], ['Precios', '#precios'], ['Preguntas', '#faq']].map(([l, h]) => (
              <a key={h} href={h} onClick={() => setMenu(false)}
                className="border-b border-white/5 py-3.5 text-[14.5px] font-extrabold" style={{ color: C.muted }}>{l}</a>
            ))}
            <a href={`${APP_URL}/login`} className="py-3.5 text-[14.5px] font-extrabold" style={{ color: C.primary }}>Entrar al panel →</a>
          </nav>
        )}
      </header>

      {/* Hero: foto real de gimnasio de fondo + copy + mockup del panel */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/landing/hero.jpg')" }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(20,27,46,0.96) 0%, rgba(20,27,46,0.86) 45%, rgba(20,27,46,0.62) 100%)' }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28" style={{ background: 'linear-gradient(180deg, transparent, #141B2E)' }} />
        <div className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full opacity-[0.14] blur-3xl" style={{ background: C.primary }} />
        <div className="relative mx-auto grid max-w-[1100px] items-center gap-12 px-6 py-20 md:grid-cols-[1.05fr_1fr] md:py-24">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11.5px] font-extrabold uppercase tracking-[1.5px]" style={{ border: C.border, color: C.muted }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.primary }} /> El sistema operativo del fitness
            </div>
            <h1 className="text-[44px] font-extrabold leading-[1.06] tracking-[-1.5px]">
              Control total.<br />
              <span style={{ color: C.primary }}>Máxima retención.</span>
            </h1>
            <p className="mt-5 max-w-[480px] text-[16px] font-semibold leading-relaxed" style={{ color: C.muted }}>
              Gimnasios, academias, gyms para niños y personal trainers: accesos, cobros,
              clientes y tu página web en una sola plataforma. Y pronto, la app donde
              las personas te encuentran y entrenan contigo.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href={`${APP_URL}/registro`}
                className="rounded-lg px-7 py-3.5 text-[15px] font-extrabold text-white transition-transform hover:scale-[1.03]"
                style={{ background: C.primary, boxShadow: '0 12px 36px rgba(255,107,53,0.35)' }}>
                Empieza gratis
              </a>
              <a href={`https://powergym.${ROOT_DOMAIN}`} target="_blank" rel="noreferrer"
                className="rounded-lg px-6 py-3.5 text-[14.5px] font-extrabold text-white transition-colors hover:bg-white/5"
                style={{ border: C.border }}>
                Ver un gym de ejemplo →
              </a>
            </div>
            <p className="mt-4 text-[12px] font-semibold" style={{ color: C.muted }}>1 mes de prueba · sin tarjeta · listo hoy</p>
          </div>
          <div className="flex justify-center md:justify-end">
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* Para todo tipo de gimnasio */}
      <section className="lp-rev mx-auto max-w-[1100px] px-6 pb-2 pt-2">
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          {SEGMENTOS.map((s) => (
            <span key={s} className="rounded-full px-4 py-2 text-[12.5px] font-bold" style={{ border: C.border, color: C.muted }}>{s}</span>
          ))}
        </div>
      </section>

      {/* 3 propuestas de valor */}
      <section className="lp-rev mx-auto max-w-[1100px] px-6 pb-6 pt-10">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {VALORES.map((v) => (
            <div key={v.t} className="rounded-lg p-6" style={{ background: C.surface, border: C.border }}>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg text-[20px]"
                style={{ background: 'rgba(255,107,53,0.12)', boxShadow: '0 0 24px rgba(255,107,53,0.15)' }}>{v.icon}</div>
              <div className="mt-4 text-[16px] font-extrabold">{v.t}</div>
              <div className="mt-2 text-[13px] font-semibold leading-relaxed" style={{ color: C.muted }}>{v.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Antes / Con FitControl */}
      <section className="lp-rev mx-auto max-w-[1100px] px-6 pt-14">
        <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Deja el cuaderno y el Excel</h2>
        <div className="mx-auto mt-9 grid max-w-[900px] grid-cols-1 gap-3">
          {ANTES_DESPUES.map(([antes, despues]) => (
            <div key={antes} className="grid grid-cols-1 overflow-hidden rounded-lg md:grid-cols-2" style={{ border: C.border }}>
              <div className="flex items-center gap-3 px-5 py-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <span className="text-[15px] opacity-50">✕</span>
                <span className="text-[13.5px] font-semibold line-through decoration-white/25" style={{ color: C.muted }}>{antes}</span>
              </div>
              <div className="flex items-center gap-3 px-5 py-4" style={{ background: 'rgba(255,107,53,0.07)' }}>
                <span className="text-[15px] font-extrabold" style={{ color: C.primary }}>✓</span>
                <span className="text-[13.5px] font-bold text-white">{despues}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features compactos */}
      <section id="funciones" className="lp-rev mx-auto max-w-[1100px] px-6 py-16">
        <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Todo lo demás, también incluido</h2>
        <div className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, t, d]) => (
            <div key={t} className="flex items-start gap-3.5 rounded-lg p-4" style={{ border: C.border }}>
              <span className="text-[20px]">{icon}</span>
              <div>
                <div className="text-[14px] font-extrabold">{t}</div>
                <div className="mt-0.5 text-[12.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Tu página web en minutos */}
      <section id="pagina-web" className="lp-rev relative overflow-hidden py-16">
        <div className="pointer-events-none absolute -left-40 top-20 h-[420px] w-[420px] rounded-full opacity-[0.10] blur-3xl" style={{ background: C.primary }} />
        <div className="relative mx-auto grid max-w-[1100px] items-center gap-12 px-6 md:grid-cols-[1fr_1.05fr]">
          <div className="flex justify-center md:justify-start">
            <GymPageMockup />
          </div>
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11.5px] font-extrabold uppercase tracking-[1.5px]" style={{ border: C.border, color: C.primary }}>
              Incluido en todos los planes
            </div>
            <h2 className="text-[30px] font-extrabold leading-[1.15] tracking-[-0.8px]">
              Tu página web profesional,<br />sin pagar un diseñador
            </h2>
            <p className="mt-4 max-w-[460px] text-[14.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>
              Cada gimnasio en FitControl recibe su propia página con dirección propia,
              lista para compartir en redes y recibir interesados directo a tu CRM.
            </p>
            <p className="mt-3 max-w-[460px] rounded-lg px-4 py-3 text-[13px] font-semibold leading-relaxed" style={{ background: 'rgba(255,107,53,0.08)', border: '1px solid rgba(255,107,53,0.25)' }}>
              <b style={{ color: C.primary }}>Ningún otro sistema en Perú te da esto:</b>{' '}
              otros muestran una ficha genérica con la marca de ellos. Aquí la página es <b>tuya</b>:
              tu dirección, tus colores, tu estilo — tu gimnasio con identidad propia en internet.
            </p>
            <ul className="mt-6 space-y-2.5 text-[13.5px] font-semibold" style={{ color: C.muted }}>
              {[
                ['🌐', <span key="d">Dirección propia: <b className="text-white">tugym.{ROOT_DOMAIN}</b></span>],
                ['🎨', <span key="e">8 diseños — de sobrios a extravagantes — con tus colores y fotos</span>],
                ['🎲', <span key="f">Botón aleatorio: prueba combinaciones hasta dar con la tuya</span>],
                ['📥', <span key="g">Cada "Inscríbete" cae a tu CRM con la red social de origen</span>],
              ].map(([ic, txt]) => (
                <li key={ic} className="flex items-start gap-3"><span className="text-[16px]">{ic}</span>{txt}</li>
              ))}
            </ul>
            <a href={`https://powergym.${ROOT_DOMAIN}`} target="_blank" rel="noreferrer"
              className="mt-7 inline-block rounded-lg px-6 py-3 text-[14px] font-extrabold text-white transition-colors hover:bg-white/5"
              style={{ border: `1px solid ${C.primary}`, color: C.primary }}>
              Ver una página real →
            </a>
          </div>
        </div>
      </section>

      {/* Pasos */}
      <section className="lp-rev py-16" style={{ background: C.surface }}>
        <div className="mx-auto max-w-[960px] px-6">
          <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Empieza en 3 pasos</h2>
          <div className="mt-9 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {PASOS.map(([n, t, d]) => (
              <div key={n} className="overflow-hidden rounded-lg" style={{ background: C.bg, border: C.border }}>
                <div className="h-[140px] overflow-hidden">
                  <img src={`/landing/paso${n}.jpg`} alt={t} loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="p-6 pt-5 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-[16px] font-extrabold text-white" style={{ background: C.primary }}>{n}</div>
                  <div className="mt-3.5 text-[15px] font-extrabold">{t}</div>
                  <div className="mt-1.5 text-[12.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Precios */}
      <section id="precios" className="lp-rev mx-auto max-w-[1100px] px-6 py-18 pt-16">
        <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Un plan para cada tipo de gimnasio</h2>
        <p className="mt-2 text-center text-[14px] font-semibold" style={{ color: C.muted }}>
          Estudio de yoga, gym de barrio o cadena multi-sede: paga solo por lo que necesitas.
        </p>

        {/* Toggle: solo panel vs panel + app del socio */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex rounded-full p-1" style={{ background: C.surface, border: C.border }}>
            <button onClick={() => setConApp(false)}
              className="rounded-full px-5 py-2 text-[13px] font-extrabold transition-colors"
              style={conApp ? { color: C.muted } : { background: C.primary, color: '#fff' }}>
              Solo panel
            </button>
            <button onClick={() => setConApp(true)}
              className="flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-extrabold transition-colors"
              style={conApp ? { background: C.primary, color: '#fff' } : { color: C.muted }}>
              📱 Panel + App del socio
              <span className="rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide"
                style={{ background: conApp ? 'rgba(255,255,255,0.2)' : 'rgba(255,107,53,0.15)', color: conApp ? '#fff' : C.primary }}>
                Pronto
              </span>
            </button>
          </div>
        </div>
        {conApp && (
          <p className="mt-3 text-center text-[12.5px] font-semibold" style={{ color: C.muted }}>
            Tus socios reservan clases, ven su rutina y su membresía desde su celular. Disponible muy pronto — el precio ya es el definitivo.
          </p>
        )}

        <div className="mx-auto mt-10 grid max-w-[1000px] grid-cols-1 gap-4 md:grid-cols-3">
          {PLANES.map((p) => (
            <div key={p.nombre} className="relative flex flex-col overflow-hidden rounded-xl pt-0"
              style={{
                background: C.surface,
                border: p.popular ? `2px solid ${C.primary}` : C.border,
                boxShadow: p.popular ? '0 24px 60px rgba(255,107,53,0.18)' : 'none',
              }}>
              <div className="h-[110px] w-full overflow-hidden">
                <img src={p.foto} alt={`Plan ${p.nombre}`} loading="lazy" className="h-full w-full object-cover opacity-90" />
              </div>
              <div className="flex flex-1 flex-col p-7 pt-5">
              {p.popular && (
                <div className="absolute left-1/2 top-2.5 z-10 -translate-x-1/2 rounded-full px-4 py-1 text-[10.5px] font-extrabold tracking-[0.5px] text-white" style={{ background: C.primary, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
                  MÁS POPULAR
                </div>
              )}
              <div className="text-[15px] font-extrabold">{p.nombre}</div>
              <div className="mt-0.5 text-[12px] font-semibold" style={{ color: C.muted }}>{p.para}</div>
              <div className="mt-4 text-[38px] font-extrabold tracking-[-2px]">
                S/ {conApp ? p.conApp : p.base}<span className="text-[14px] font-semibold" style={{ color: C.muted }}>/mes</span>
              </div>
              <div className="text-[11.5px] font-semibold" style={{ color: C.muted }}>
                {conApp
                  ? `S/ ${p.base} sin app · el adicional cubre a todos tus socios`
                  : `+S/ ${p.conApp - p.base}/mes si luego quieres la app del socio`}
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-[13px] font-semibold" style={{ color: C.muted }}>
                {conApp && (
                  <li className="flex items-start gap-2 font-extrabold text-white">
                    <span className="mt-0.5" style={{ color: C.primary }}>✓</span>App para tus socios (iOS y Android)
                  </li>
                )}
                {p.features.map((x) => (
                  <li key={x} className="flex items-start gap-2"><span className="mt-0.5" style={{ color: C.primary }}>✓</span>{x}</li>
                ))}
                {p.no.map((x) => (
                  <li key={x} className="flex items-start gap-2 opacity-40"><span className="mt-0.5">✕</span>{x}</li>
                ))}
              </ul>
              <a href={`${APP_URL}/registro`}
                className="mt-6 block rounded-lg py-3 text-center text-[14px] font-extrabold text-white transition-transform hover:scale-[1.02]"
                style={p.popular ? { background: C.primary } : { border: `1px solid ${C.primary}`, color: C.primary }}>
                Empezar gratis
              </a>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-[12px] font-semibold" style={{ color: C.muted }}>
          Todos los planes incluyen 1 mes de prueba gratis, sin tarjeta. Cambia de plan cuando quieras.
        </p>

        {/* Segmentos especiales: no todo negocio fitness es un gimnasio clásico */}
        <div className="mx-auto mt-10 max-w-[1000px] rounded-xl p-6" style={{ background: C.surface, border: C.border }}>
          <div className="text-center text-[16px] font-extrabold">¿No eres un gimnasio clásico? También tenemos tu plan</div>
          <p className="mt-1 text-center text-[12.5px] font-semibold" style={{ color: C.muted }}>
            Un panel a tu medida, sin módulos que no usas — con tu página web incluida.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ['💪', 'Personal Trainer', 29, 'Tus clientes, tus paquetes de sesiones y tu página personal'],
              ['🥋', 'Academia / Estudio', 49, 'Dojos, yoga, baile, box: clases, alumnos y reservas'],
              ['👦', 'Gym para Niños', 69, 'Alumnos con apoderados y clases por edades'],
            ].map(([ic, t, precio, d]) => (
              <a key={t} href={`${APP_URL}/registro`} className="rounded-lg p-4 transition-colors hover:bg-white/5" style={{ border: C.border }}>
                <div className="text-[22px]">{ic}</div>
                <div className="mt-1.5 text-[14px] font-extrabold">{t}</div>
                <div className="text-[18px] font-extrabold" style={{ color: C.primary }}>S/ {precio}<span className="text-[11px] font-semibold" style={{ color: C.muted }}>/mes</span></div>
                <div className="mt-1 text-[11.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>{d}</div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* La app que viene: marketplace + app del socio */}
      <section id="app" className="lp-rev relative overflow-hidden py-16" style={{ background: C.surface }}>
        <div className="pointer-events-none absolute -right-32 top-10 h-[380px] w-[380px] rounded-full opacity-[0.10] blur-3xl" style={{ background: C.primary }} />
        <div className="relative mx-auto max-w-[1100px] px-6">
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[1.5px]" style={{ background: 'rgba(255,107,53,0.12)', color: C.primary }}>
              📱 Próximamente
            </span>
            <h2 className="mt-4 text-[30px] font-extrabold tracking-[-0.8px]">La app que cambia el juego</h2>
            <p className="mx-auto mt-2 max-w-[560px] text-[14.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>
              Una sola app para todo el fitness: las personas encuentran dónde entrenar,
              y tus clientes viven tu negocio desde su celular.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['🗺️', 'Te encuentran a ti', 'Las personas buscarán gimnasios, academias y personal trainers cerca de ellas. Estar suscrito a FitControl te pone en el mapa — sin costo extra.'],
              ['📲', 'Tu negocio en su bolsillo', 'Tus socios ven su rutina, su dieta, su membresía y reservan tus clases — con tu marca y tus colores.'],
              ['🎥', 'Papás tranquilos', 'En gyms para niños, el apoderado verá la asistencia de su hijo y las cámaras de la clase en vivo.'],
              ['🏋️', 'Modo entrenador', 'Tus trainers y nutricionistas asignan rutinas y dietas desde su celular, en el piso del gym.'],
            ].map(([ic, t, d]) => (
              <div key={t} className="rounded-lg p-5" style={{ background: C.bg, border: C.border }}>
                <div className="text-[26px]">{ic}</div>
                <div className="mt-2.5 text-[14.5px] font-extrabold">{t}</div>
                <div className="mt-1.5 text-[12.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>{d}</div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-[13px] font-semibold" style={{ color: C.muted }}>
            Aparecer en la app está <b className="text-white">incluido con tu suscripción</b>. Las funciones para tus
            clientes son un adicional <b style={{ color: C.primary }}>desde S/ 20/mes</b> — puedes reservarlo desde hoy
            y se cobra recién cuando la app esté activa.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="lp-rev mx-auto max-w-[760px] px-6 pb-16 pt-16">
        <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Preguntas frecuentes</h2>
        <div className="mt-8 space-y-2.5">
          {FAQS.map(([q, a]) => (
            <details key={q} className="lp-faq rounded-lg" style={{ background: C.surface, border: C.border }}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[14.5px] font-extrabold">
                {q}
                <span className="lp-faq-chevron text-[12px] transition-transform" style={{ color: C.primary }}>▼</span>
              </summary>
              <p className="px-5 pb-5 text-[13.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-center text-[13.5px] font-semibold" style={{ color: C.muted }}>
          ¿Tienes otra duda?{' '}
          <a href={WA_LINK} target="_blank" rel="noreferrer" className="font-extrabold underline decoration-2 underline-offset-4" style={{ color: '#25D366' }}>
            Escríbenos por WhatsApp
          </a>
          {' '}o a{' '}
          <a href={`mailto:${MAIL_HOLA}`} className="font-extrabold" style={{ color: C.primary }}>{MAIL_HOLA}</a>
        </p>
      </section>

      {/* CTA final: panel + app en dispositivos reales */}
      <section className="lp-rev px-6 pb-20 pt-4">
        <div className="relative mx-auto max-w-[1000px] overflow-hidden rounded-xl" style={{ border: C.border }}>
          <div className="absolute inset-0 bg-cover" style={{ backgroundImage: "url('/landing/devices.jpg')", backgroundPosition: 'right center' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(24,32,52,0.97) 30%, rgba(24,32,52,0.72) 60%, rgba(24,32,52,0.15) 100%)' }} />
          <div className="relative max-w-[560px] px-8 py-14 md:px-12 md:py-16">
            <h2 className="text-[26px] font-extrabold tracking-[-0.5px]">Tu gimnasio, en control esta misma tarde</h2>
            <p className="mt-2 max-w-[420px] text-[14px] font-semibold" style={{ color: C.muted }}>
              Panel + página web + captación de clientes. Sin instalaciones, sin técnicos, sin permanencia.
            </p>
            <a href={`${APP_URL}/registro`}
              className="mt-7 inline-block rounded-lg px-8 py-4 text-[15.5px] font-extrabold text-white transition-transform hover:scale-[1.03]"
              style={{ background: C.primary, boxShadow: '0 12px 36px rgba(255,107,53,0.35)' }}>
              Crear mi gimnasio gratis
            </a>
          </div>
        </div>
      </section>

      {/* Footer completo */}
      <footer className="px-6 pb-8 pt-14" style={{ borderTop: C.border }}>
        <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <FitControlLogo size={34} />
              <span className="text-[16px] font-extrabold">FitControl</span>
            </div>
            <p className="mt-3 max-w-[240px] text-[12.5px] font-semibold leading-relaxed" style={{ color: C.muted }}>
              El sistema operativo del fitness: gimnasios, academias, gyms para niños y personal trainers en una sola plataforma.
            </p>
            <p className="mt-3 text-[12px] font-semibold" style={{ color: C.muted }}>🇵🇪 Hecho en Perú</p>
          </div>

          <div>
            <div className="text-[12px] font-extrabold uppercase tracking-[1.2px]" style={{ color: C.muted }}>Producto</div>
            <ul className="mt-3.5 space-y-2.5 text-[13.5px] font-bold">
              {[['Funciones', '#funciones'], ['Tu página web', '#pagina-web'], ['Precios', '#precios'], ['Preguntas frecuentes', '#faq']].map(([l, h]) => (
                <li key={h}><a href={h} className="transition-colors hover:text-white" style={{ color: C.muted }}>{l}</a></li>
              ))}
              <li>
                <a href={`https://powergym.${ROOT_DOMAIN}`} target="_blank" rel="noreferrer" className="transition-colors hover:text-white" style={{ color: C.muted }}>
                  Gym de ejemplo ↗
                </a>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-[12px] font-extrabold uppercase tracking-[1.2px]" style={{ color: C.muted }}>Contacto</div>
            <ul className="mt-3.5 space-y-2.5 text-[13.5px] font-bold">
              <li>
                <a href={WA_LINK} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 transition-colors hover:text-white" style={{ color: C.muted }}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]" style={{ background: '#25D366' }}>💬</span>
                  {WA_NUM}
                </a>
              </li>
              <li><a href={`mailto:${MAIL_HOLA}`} className="transition-colors hover:text-white" style={{ color: C.muted }}>{MAIL_HOLA}</a></li>
              <li><a href={`mailto:${MAIL_SOPORTE}`} className="transition-colors hover:text-white" style={{ color: C.muted }}>{MAIL_SOPORTE}</a></li>
              <li className="text-[13px] font-bold" style={{ color: C.muted }}>📍 Lima, Perú</li>
              <li className="text-[12px] font-semibold" style={{ color: 'rgba(142,154,168,0.6)' }}>Ventas: hola@ · Ayuda técnica: soporte@</li>
            </ul>
          </div>

          <div>
            <div className="text-[12px] font-extrabold uppercase tracking-[1.2px]" style={{ color: C.muted }}>Tu cuenta</div>
            <ul className="mt-3.5 space-y-2.5 text-[13.5px] font-bold">
              <li><a href={`${APP_URL}/login`} className="transition-colors hover:text-white" style={{ color: C.muted }}>Entrar al panel</a></li>
              <li><a href={`${APP_URL}/registro`} className="transition-colors hover:text-white" style={{ color: C.primary }}>Crear mi gimnasio gratis</a></li>
            </ul>
          </div>
        </div>

        <div className="mx-auto mt-12 flex max-w-[1100px] flex-col items-center justify-between gap-3 pt-6 sm:flex-row" style={{ borderTop: C.border }}>
          <div className="text-[11.5px] font-semibold" style={{ color: 'rgba(142,154,168,0.5)' }}>© 2026 FitControl. Todos los derechos reservados.</div>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-[12px] font-bold">
            <a href="/terminos" className="transition-colors hover:text-white" style={{ color: C.muted }}>Términos y condiciones</a>
            <a href="/privacidad" className="transition-colors hover:text-white" style={{ color: C.muted }}>Privacidad</a>
            <a href="/devoluciones" className="transition-colors hover:text-white" style={{ color: C.muted }}>Cambios y devoluciones</a>
            <a href="/reclamaciones" className="transition-colors hover:text-white" style={{ color: C.muted }}>📖 Libro de Reclamaciones</a>
          </div>
        </div>
      </footer>

      {/* WhatsApp flotante */}
      <a href={WA_LINK} target="_blank" rel="noreferrer" aria-label="Escríbenos por WhatsApp"
        className="fixed bottom-5 right-5 z-30 flex h-[54px] w-[54px] items-center justify-center rounded-full transition-transform hover:scale-110"
        style={{ background: '#25D366', boxShadow: '0 10px 30px rgba(37,211,102,0.45)' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff" aria-hidden>
          <path d="M12 2a10 10 0 0 0-8.62 15.07L2 22l5.09-1.33A10 10 0 1 0 12 2Zm0 18.18c-1.5 0-2.97-.4-4.25-1.15l-.3-.18-3.02.79.8-2.94-.2-.31a8.18 8.18 0 1 1 6.97 3.79Zm4.49-6.13c-.25-.12-1.45-.72-1.68-.8-.22-.08-.39-.12-.55.13-.16.24-.63.8-.77.96-.14.16-.29.18-.53.06a6.7 6.7 0 0 1-1.97-1.21 7.4 7.4 0 0 1-1.36-1.7c-.14-.24-.02-.37.1-.5.11-.11.25-.28.37-.43.12-.14.16-.24.24-.4.08-.17.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.65.3-.22.25-.86.84-.86 2.05 0 1.2.88 2.37 1 2.53.12.16 1.73 2.64 4.2 3.7.59.26 1.05.41 1.4.52.6.19 1.13.16 1.56.1.47-.07 1.45-.6 1.65-1.17.2-.57.2-1.06.15-1.17-.06-.1-.23-.16-.47-.28Z" />
        </svg>
      </a>
    </div>
  )
}
