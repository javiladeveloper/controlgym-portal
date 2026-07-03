import { FitControlLogo } from '../components/icons.jsx'
import { ROOT_DOMAIN } from '../lib/tenant.js'

// Landing de la PLATAFORMA (fitcorecenter.com): dark premium.
// Tokens: bg #141B2E · surface #1F293D · primary #FF6B35 · muted #8E9AA8 · radius 8px
const APP_URL = `https://app.${ROOT_DOMAIN}`
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

const PLANES = [
  {
    nombre: 'Estudio', precio: 49, popular: false,
    para: 'Yoga, pilates, baile y gimnasios pequeños',
    features: ['1 sede · hasta 100 socios', '2 usuarios del panel', 'Socios, membresías y cobros', 'Clases y check-in', 'Página web con subdominio', 'Reportes básicos'],
    no: ['CRM y captación desde redes', 'App del socio'],
  },
  {
    nombre: 'Crecimiento', precio: 99, popular: true,
    para: 'El gimnasio que quiere captar y crecer',
    features: ['Hasta 3 sedes · 500 socios', 'Usuarios ilimitados', 'Todo lo de Estudio', 'CRM + captación con origen por red', 'Emails automáticos de interesados', 'Promociones aplicadas al cobro', 'Kardex, máquinas y finanzas', 'Personalización total (8 diseños)', 'Reportes en Excel'],
    no: ['App del socio'],
  },
  {
    nombre: 'Cadena', precio: 179, popular: false,
    para: 'Multi-sede, franquicias y gyms completos',
    features: ['Sedes y socios ilimitados', 'Todo lo de Crecimiento', 'App del socio (próximamente)', 'Torniquetes y huella', 'Varias marcas en una cuenta', 'Soporte prioritario por WhatsApp'],
    no: [],
  },
]

export default function PlataformaLanding() {
  return (
    <div className="min-h-screen text-white" style={{ background: C.bg, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur" style={{ background: 'rgba(20,27,46,0.85)', borderBottom: C.border }}>
        <div className="mx-auto flex max-w-[1100px] items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white" style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.25)' }}>
              <FitControlLogo size={26} />
            </div>
            <span className="text-[17px] font-extrabold tracking-[-0.3px]">FitControl</span>
          </div>
          <div className="flex items-center gap-2">
            <a href={`${APP_URL}/login`} className="px-3 py-2 text-[13.5px] font-extrabold transition-colors hover:text-white" style={{ color: C.muted }}>Entrar</a>
            <a href={`${APP_URL}/registro`} className="rounded-lg px-4 py-2.5 text-[13.5px] font-extrabold text-white transition-transform hover:scale-[1.03]" style={{ background: C.primary }}>
              Crear mi gimnasio
            </a>
          </div>
        </div>
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
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.primary }} /> El sistema operativo para gimnasios
            </div>
            <h1 className="text-[44px] font-extrabold leading-[1.06] tracking-[-1.5px]">
              Control total.<br />
              <span style={{ color: C.primary }}>Máxima retención.</span>
            </h1>
            <p className="mt-5 max-w-[480px] text-[16px] font-semibold leading-relaxed" style={{ color: C.muted }}>
              Accesos, cobros, socios y tu página web en una sola plataforma limpia.
              Elimina la fricción administrativa y haz crecer tu membresía sin esfuerzo.
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

      {/* 3 propuestas de valor */}
      <section className="mx-auto max-w-[1100px] px-6 pb-6 pt-4">
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

      {/* Features compactos */}
      <section className="mx-auto max-w-[1100px] px-6 py-16">
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

      {/* Pasos */}
      <section className="py-16" style={{ background: C.surface }}>
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
      <section className="mx-auto max-w-[1100px] px-6 py-18 pt-16">
        <h2 className="text-center text-[28px] font-extrabold tracking-[-0.5px]">Un plan para cada tipo de gimnasio</h2>
        <p className="mt-2 text-center text-[14px] font-semibold" style={{ color: C.muted }}>
          Estudio de yoga, gym de barrio o cadena multi-sede: paga solo por lo que necesitas.
        </p>
        <div className="mx-auto mt-10 grid max-w-[1000px] grid-cols-1 gap-4 md:grid-cols-3">
          {PLANES.map((p) => (
            <div key={p.nombre} className="relative flex flex-col rounded-xl p-7"
              style={{
                background: C.surface,
                border: p.popular ? `2px solid ${C.primary}` : C.border,
                boxShadow: p.popular ? '0 24px 60px rgba(255,107,53,0.18)' : 'none',
              }}>
              {p.popular && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-[10.5px] font-extrabold tracking-[0.5px] text-white" style={{ background: C.primary }}>
                  MÁS POPULAR
                </div>
              )}
              <div className="text-[15px] font-extrabold">{p.nombre}</div>
              <div className="mt-0.5 text-[12px] font-semibold" style={{ color: C.muted }}>{p.para}</div>
              <div className="mt-4 text-[38px] font-extrabold tracking-[-2px]">
                S/ {p.precio}<span className="text-[14px] font-semibold" style={{ color: C.muted }}>/mes</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-[13px] font-semibold" style={{ color: C.muted }}>
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
          ))}
        </div>
        <p className="mt-6 text-center text-[12px] font-semibold" style={{ color: C.muted }}>
          Todos los planes incluyen 1 mes de prueba gratis, sin tarjeta. Cambia de plan cuando quieras.
        </p>
      </section>

      {/* CTA final: panel + app en dispositivos reales */}
      <section className="px-6 pb-20 pt-4">
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

      {/* Footer */}
      <footer className="px-6 py-10" style={{ borderTop: C.border }}>
        <div className="mx-auto flex max-w-[1100px] flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white">
              <FitControlLogo size={22} />
            </div>
            <span className="text-[15px] font-extrabold">FitControl</span>
          </div>
          <div className="text-[12.5px] font-semibold" style={{ color: C.muted }}>El sistema operativo para gimnasios · {ROOT_DOMAIN}</div>
          <div className="text-[11px] font-semibold" style={{ color: 'rgba(142,154,168,0.5)' }}>© 2026 FitControl. Todos los derechos reservados.</div>
        </div>
      </footer>
    </div>
  )
}
